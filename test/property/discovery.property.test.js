"use strict";

// The browse-path property run: throws randomly described Home Assistant installations at the
// card picker's start configuration and checks every invariant in discovery.js, then renders
// each found configuration in the built card with the same hass. The load-bearing assertion is
// the census — how often the run ends in the template, one, two or three rooms, area or sensor
// names, each measurement, each pass — because a drifted generator would otherwise stay green
// while testing nothing. See internal dev doc §4 "Die Property-Schicht".

const test = require("node:test");
const assert = require("node:assert/strict");

const { SeededRandom } = require("../helpers/seeded-random.js");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { installation } = require("../fixtures/installation.js");
const { generateInstallation, checkDiscovery, shrinkInstallation } = require("./discovery.js");
const { readCount, readSeed, formatSeed, writePropertyReport } = require("./run-config.js");

const SEED = readSeed("ROOM_CLIMATE_CARD_DISCOVERY_SEED", 0xd15c0);
const CASES = readCount("ROOM_CLIMATE_CARD_DISCOVERY_CASES", 400);

let suggestions;
let entityModel;
let env;

test.before(async () => {
  suggestions = await import("../../src/application/model/card-suggestions.js");
  entityModel = await import("../../src/application/model/entity-model.js");
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

const withFrontend = (hass) => ({ ...hass, language: "en", locale: { language: "en" }, callService: () => {} });

// The found configuration, applied the way the picker previews it.
function renderViolations(stub, description, pass) {
  if (!stub.rooms || stub.entity) return [];
  const original = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  let card;
  try {
    card = env.createCard({ type: "custom:room-climate-card", ...stub }, withFrontend(installation(description)));
    const data = card._computeViewModel();
    const violations = [];
    if (pass === "usable") {
      if (data.empty) violations.push("the preview of usable rooms has no value");
      if (data.notices.warnings.length) violations.push(`the preview warns: ${data.notices.warnings.map((warning) => warning.code).join(", ")}`);
    }
    return violations;
  } catch (error) {
    return [`the preview failed: ${error && error.message}`];
  } finally {
    Object.assign(console, original);
    if (card) env.cleanup(card);
  }
}

function runCase(description) {
  const stubFor = (candidate) => suggestions.stubConfigFor(withFrontend(installation(candidate)));
  const isUsable = (hass, entityId) => entityModel.buildEntityModel(hass.states, null, entityId, "room").availability === entityModel.AVAILABILITY.USABLE;
  try {
    const result = checkDiscovery(description, { stubFor, isUsable, template: suggestions.stubConfigFor(undefined) });
    return { ...result, violations: [...result.violations, ...renderViolations(result.stub, description, result.outcome.pass)] };
  } catch (error) {
    return { violations: [`discovery threw: ${error && error.message}`], outcome: { rooms: -1 } };
  }
}

const YIELD_EVERY = 100;
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

test(`every one of ${CASES} generated installations yields a start configuration that keeps every invariant`, async (t) => {
  const rng = new SeededRandom(SEED);
  const census = { rooms: { 0: 0, 1: 0, 2: 0, 3: 0 }, naming: { area: 0, name: 0 }, pass: { usable: 0, declared: 0 }, kind: {} };
  const failures = [];
  for (let index = 0; index < CASES; index++) {
    const caseSeed = rng.int(0, 0x7fffffff);
    const description = generateInstallation(caseSeed);
    const { violations, outcome } = runCase(description);
    if (outcome.rooms in census.rooms) census.rooms[outcome.rooms] += 1;
    if (outcome.naming) census.naming[outcome.naming] += 1;
    if (outcome.pass) census.pass[outcome.pass] += 1;
    if (outcome.kind) census.kind[outcome.kind] = (census.kind[outcome.kind] || 0) + 1;
    if (violations.length && failures.length < 3) {
      const wanted = JSON.stringify([...violations].sort());
      const { description: minimal, steps } = shrinkInstallation(description, (candidate) => JSON.stringify([...runCase(candidate).violations].sort()) === wanted);
      failures.push({ caseSeed: formatSeed(caseSeed), violations, shrinkSteps: steps, minimal });
    }
    if ((index + 1) % YIELD_EVERY === 0) await yieldToEventLoop();
  }

  const share = (hits) => hits / CASES;
  const summary =
    `discovery seed ${formatSeed(SEED)} | template ${census.rooms[0]}, 1 room ${census.rooms[1]}, 2 rooms ${census.rooms[2]}, 3 rooms ${census.rooms[3]}` +
    ` | area names ${census.naming.area}, sensor names ${census.naming.name} | usable ${census.pass.usable}, declared ${census.pass.declared}` +
    ` | ${Object.entries(census.kind).map(([kind, hits]) => `${kind} ${hits}`).join(", ")}`;
  t.diagnostic(summary);
  writePropertyReport("discovery", { seed: formatSeed(SEED), cases: CASES, census, failures });

  assert.deepEqual(failures, [], `discovery invariants violated (seed ${formatSeed(SEED)}):\n${JSON.stringify(failures, null, 2)}`);

  // The population must keep reaching every outcome it claims to test. Bands are about half
  // the shares measured over 400-case runs of several seeds.
  assert.ok(share(census.rooms[0]) >= 0.04, `template ${share(census.rooms[0])}`);
  assert.ok(share(census.rooms[1]) >= 0.15, `one room ${share(census.rooms[1])}`);
  assert.ok(share(census.rooms[2]) >= 0.25, `two rooms ${share(census.rooms[2])}`);
  assert.ok(share(census.rooms[3]) >= 0.05, `three rooms ${share(census.rooms[3])}`);
  assert.ok(share(census.naming.area) >= 0.15, `area names ${share(census.naming.area)}`);
  assert.ok(share(census.naming.name) >= 0.28, `sensor names ${share(census.naming.name)}`);
  assert.ok(census.pass.declared >= 1, "no installation reached the declared-only pass");
  for (const kind of ["temperature", "humidity", "co2", "pm25"]) {
    assert.ok((census.kind[kind] || 0) >= 1, `${kind} was never chosen`);
  }
});
