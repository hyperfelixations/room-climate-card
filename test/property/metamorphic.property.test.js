"use strict";

// The metamorphic property run: derives a second dashboard from a random one by a change of
// known effect, and checks that the difference between the two cards is the one asked for.
// Its boundary: model.property.test.js next door asks whether one card is self-consistent;
// this asks whether a card is consistent with its neighbour. The relations, with their
// preconditions and reasoning, are in ./metamorphic.js; this file runs them.
// The coverage assertion — every relation must apply to a real share of the population — is
// load-bearing. Rationale: see internal dev doc §4 "Die metamorphe Schicht".

const test = require("node:test");
const assert = require("node:assert/strict");

const { SeededRandom } = require("../helpers/seeded-random.js");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { buildScenario } = require("../fixtures/scenario.js");
const { generateDescription } = require("./generators.js");
const { RELATIONS, observe } = require("./metamorphic.js");
const { shrink, sizeOf } = require("./shrink.js");
const { classifyViolations } = require("../known-issues.js");
const { readCount, readSeed, formatSeed, writePropertyReport } = require("./run-config.js");

const DEFAULT_SEED = readSeed("ROOM_CLIMATE_CARD_METAMORPHIC_SEED", 0x5eed1);
const CASES = readCount("ROOM_CLIMATE_CARD_METAMORPHIC_CASES", 300);

// Every relation applies a sequence to ONE card, so a card is built per sequence rather than
// per description — see model.property.test.js for why the loop yields to the event loop.
const YIELD_EVERY = 50;
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

function withQuietConsole(body) {
  const original = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {};
  console.error = () => {};
  try {
    return body();
  } finally {
    Object.assign(console, original);
  }
}

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

// Applies a sequence of built scenarios to one card and observes the last. `refused` means
// the card never got far enough to compare (setConfig refused, or something threw); a
// relation is about two cards that both exist, and a refused configuration is tested elsewhere.
function runSequence(scenarios) {
  let card = null;
  try {
    for (const scenario of scenarios) {
      if (!card) {
        card = env.createCard(scenario.config, scenario.hass);
      } else {
        card.setConfig(scenario.config);
        card.hass = scenario.hass;
      }
    }
    return { refused: false, observation: observe(card._computeViewModel()) };
  } catch {
    return { refused: true, observation: null };
  } finally {
    if (card) env.cleanup(card);
  }
}

// The reference card: the description as written, with nothing derived from it.
function runBase(description) {
  try {
    return runSequence([buildScenario(description)]);
  } catch {
    return { refused: true, observation: null };
  }
}

// One relation against one description. Returns the violations, which is empty both when the
// relation holds and when it did not apply.
function checkRelation(relation, description) {
  const base = runBase(description);
  if (base.refused || !base.observation) return { applied: false, violations: [] };
  // A preservation relation has nothing to say about a card that showed nothing.
  if (relation.needsRenderedBase && base.observation.empty) return { applied: false, violations: [] };

  let sequence;
  try {
    sequence = relation.derive(description, base.observation);
  } catch {
    // The scenario builder refused its own description — a finding for model.property.test.js,
    // not a relation between two cards.
    return { applied: false, violations: [] };
  }
  if (!sequence) return { applied: false, violations: [] };

  const derived = runSequence(sequence);
  if (derived.refused) {
    // These relations only add a room or change a reading, so a derived configuration that
    // setConfig refuses is itself a finding.
    return { applied: true, violations: [`the derived configuration was refused while the original was not`] };
  }
  if (!derived.observation) return { applied: false, violations: [] };
  // `null` from compare() means the relation found out only once both cards existed that it
  // does not apply. Not a vacuous pass, and not counted as one.
  const violations = relation.compare(base.observation, derived.observation);
  if (violations === null) return { applied: false, violations: [] };
  return { applied: true, violations };
}

function report(relation, seed, description, violations) {
  const before = sizeOf(description);
  const wanted = JSON.stringify([...violations].sort());
  const { description: minimal, steps } = shrink(description, (candidate) => {
    const result = withQuietConsole(() => checkRelation(relation, candidate));
    return result.applied && JSON.stringify([...result.violations].sort()) === wanted;
  });
  const after = sizeOf(minimal);
  const still = withQuietConsole(() => checkRelation(relation, minimal));
  return [
    `RELATION VIOLATED: ${relation.name}`,
    `  why it must hold: ${relation.why}`,
    `  seed 0x${seed.toString(16)}`,
    ...violations.map((violation) => `  - ${violation}`),
    `  shrunk in ${steps} steps from ${before.rooms} rooms/${before.configKeys} config keys to ${after.rooms} rooms/${after.configKeys} config keys:`,
    ...still.violations.map((violation) => `  - ${violation}`),
    "  minimal description (paste into buildScenario(…) to reproduce):",
    JSON.stringify(minimal, null, 2),
  ].join("\n");
}

test(`every metamorphic relation holds across ${CASES} randomly described dashboards`, async (t) => {
  const seedRng = new SeededRandom(DEFAULT_SEED);
  const applied = new Map(RELATIONS.map((relation) => [relation.name, 0]));
  const failures = [];
  // Violations reproducing a defect already in test/known-issues.js: counted, not reported,
  // as in model.property.test.js.
  const knownDefects = new Map();

  for (let start = 0; start < CASES; start += YIELD_EVERY) {
    withQuietConsole(() => {
      for (let index = start; index < Math.min(start + YIELD_EVERY, CASES); index++) {
        const seed = seedRng.int(0, 0x7fffffff);
        const description = generateDescription(seed);
        for (const relation of RELATIONS) {
          const result = checkRelation(relation, description);
          if (!result.applied) continue;
          applied.set(relation.name, applied.get(relation.name) + 1);
          // One report per relation is enough to act on, and a hundred of the same one buries
          // everything else.
          if (!result.violations.length) continue;
          const classified = classifyViolations(result.violations);
          for (const { issue } of classified.known) {
            knownDefects.set(issue.id, (knownDefects.get(issue.id) || 0) + 1);
          }
          if (classified.unknown.length && !failures.some((failure) => failure.relation === relation)) {
            failures.push({ relation, seed, description, violations: classified.unknown });
          }
        }
      }
    });
    await yieldToEventLoop();
  }

  const appliedCounts = Object.fromEntries(applied);
  const appliedSummary = [...applied].map(([name, count]) => `${name}: ${count}`).join(" | ");
  t.diagnostic(`metamorphic seed ${formatSeed(DEFAULT_SEED)} | ${appliedSummary}`);
  writePropertyReport("metamorphic", {
    seed: DEFAULT_SEED,
    seedHex: formatSeed(DEFAULT_SEED),
    cases: CASES,
    applied: appliedCounts,
    knownDefects: Object.fromEntries(knownDefects),
    unknownFailureCount: failures.length,
  });

  if (failures.length) {
    const text = failures.map((failure) => withQuietConsole(() => report(failure.relation, failure.seed, failure.description, failure.violations)));
    assert.fail(`${failures.length} of ${RELATIONS.length} relations were violated.\n\n${text.join("\n\n")}`);
  }

  // The coverage assertion: a relation nobody exercised proves nothing, and a precondition
  // that excludes everything looks exactly like a passing run.
  const never = [...applied].filter(([, count]) => count === 0).map(([name]) => name);
  assert.deepEqual(never, [], `these relations never applied to any generated case, so they tested nothing: ${never.join("; ")}`);
  const minimumApplications = Math.max(2, Math.floor(CASES * 0.005));
  const starved = [...applied].filter(([, count]) => count < minimumApplications);
  assert.deepEqual(
    starved,
    [],
    `relations below the minimum population of ${minimumApplications}: ${starved.map(([name, count]) => `${name}=${count}`).join("; ")}`
  );

  // BUG-10, which this file was built to reach, is fixed; the coverage assertion above
  // replaced the reproduce-the-defect guard.
});

// ------------------------------------------------------------ the relations themselves --

// A relation that cannot fail is not a test: each is shown here noticing a card that really
// differs, so the run above means something when it passes.
test("each relation notices a difference that is real", () => {
  const base = {
    metric: "temperature",
    primary: { state: 22 },
    rooms: [{ state: 19 }, { state: 24 }],
  };
  const { observe: observeModel } = require("./metamorphic.js");
  assert.equal(typeof observeModel, "function");

  const one = withQuietConsole(() => runBase(base));
  assert.ok(one.observation, "the reference card has to render for any of this to mean anything");

  // Two cards that really do differ: one room fewer.
  const fewer = withQuietConsole(() => runBase({ ...base, rooms: [{ state: 19 }] }));
  assert.ok(fewer.observation);

  for (const relation of RELATIONS) {
    const violations = relation.compare(one.observation, fewer.observation);
    assert.ok(
      violations.length > 0,
      `"${relation.name}" saw no difference between a two-room card and a one-room card, so it cannot fail`
    );
  }
});

test("a relation that does not apply says so rather than asserting anyway", () => {
  // The unit-equivalence relation has nothing to say about a CO2 card and must not pretend
  // otherwise.
  const rendered = (description) => withQuietConsole(() => runBase(description)).observation;
  const units = RELATIONS.find((relation) => relation.name.includes("another unit"));
  const co2 = { metric: "co2", primary: { state: 700 }, rooms: [{ state: 650 }] };
  const warm = { metric: "temperature", primary: { state: 22 }, rooms: [{ state: 19 }] };
  assert.equal(units.derive(co2, rendered(co2)), null);
  assert.ok(units.derive(warm, rendered(warm)));

  // The unusable-room relation needs an arbiter; without one the added room legitimately
  // changes what the card is about.
  const unusable = RELATIONS.find((relation) => relation.name.includes("cannot use"));
  const noPrimary = { metric: "temperature", primary: null, rooms: [{ state: 19 }] };
  const noRooms = { metric: "temperature", primary: { state: 22 }, rooms: [] };
  assert.equal(unusable.derive(noPrimary, rendered(noPrimary)), null);
  assert.equal(unusable.derive(noRooms, rendered(noRooms)), null);
  assert.ok(unusable.derive(warm, rendered(warm)));
});

test("every relation is fully described", () => {
  const names = new Set();
  for (const relation of RELATIONS) {
    assert.ok(relation.name && relation.name.length > 15, `a relation needs a name that states it: "${relation.name}"`);
    assert.ok(relation.why && relation.why.length > 60, `${relation.name}: say why it must hold`);
    assert.equal(typeof relation.derive, "function", relation.name);
    assert.equal(typeof relation.compare, "function", relation.name);
    assert.equal(names.has(relation.name), false, `two relations are called "${relation.name}"`);
    names.add(relation.name);
  }
  assert.ok(RELATIONS.length >= 5, `only ${RELATIONS.length} relations`);
});
