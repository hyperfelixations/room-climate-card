"use strict";

// THE PROPERTY RUN. Throw a randomly described dashboard at the card and check what it
// does with it — the way a person tries things in the sandbox, except several hundred
// times and with the results actually inspected.
//
// The shape is deliberately the same as manual testing: a YAML configuration and a set of
// entities go in, a card comes out, and every statement that must be true of ANY card is
// checked against it. What makes it worth running is combinations nobody would write by
// hand: a primary entity that is unavailable while three rooms report °C, % and K; a
// device_class whose ATTRIBUTE NAME is misspelled; a value of 1e308.
//
// THE ASSERTION THAT MATTERS MOST IS THE DISTRIBUTION.
//
// The previous version of this file ran five hundred iterations, passed every time, and
// checked essentially nothing: its entities carried a device_class but no
// unit_of_measurement, so the entity model rejected all of them and 100 % of the generated
// cards landed in the no-data state — where every one of its real invariants sat behind an
// `if (!data.empty)` that never ran. Measured, the figure was exactly 100 %.
//
// So this file asserts what its own inputs look like. If the share of no-data cards leaves
// its band, the run fails even though nothing else is wrong — because at that point the
// run is no longer testing what it claims to test. That is the check that would have
// caught the old defect on the day it was introduced.

const test = require("node:test");
const assert = require("node:assert/strict");

const { SeededRandom } = require("../helpers/seeded-random.js");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { buildScenario } = require("../fixtures/scenario.js");
const { generateDescription } = require("./generators.js");
const { checkModel, checkRendered } = require("./properties.js");
const { shrink, sizeOf } = require("./shrink.js");
const { classifyViolations } = require("../known-issues.js");
const { readCount, readSeed, formatSeed, writePropertyReport } = require("./run-config.js");

const DEFAULT_SEED = readSeed("ROOM_CLIMATE_CARD_FUZZ_SEED", 0xc1a6e);
// Small and deterministic for the ordinary run; a big run is one environment variable away
// and belongs in a scheduled job, not in everyone's pre-commit loop.
const CASES = readCount("ROOM_CLIMATE_CARD_FUZZ_CASES", 400);

// The card is talkative about bad configuration, and that talk is a FEATURE tested
// elsewhere (characterization-diagnostics). Here it would bury the result, so it is
// captured rather than printed — and counted, because "the card said nothing at all about
// a broken configuration" would itself be worth knowing.
function withQuietConsole(body) {
  const original = { warn: console.warn, error: console.error, log: console.log };
  const captured = [];
  console.warn = (...args) => captured.push(args.join(" "));
  console.error = (...args) => captured.push(args.join(" "));
  try {
    return body(captured);
  } finally {
    Object.assign(console, original);
  }
}

// Lets jsdom's queues drain.
//
// A card that has rendered stays reachable from the environment's internal queues until
// the event loop turns — measured at about 850 KB apiece, which runs a 20 000-case run out
// of a 4 GB heap. Nothing is wrong with the card: the same loop with one macrotask between
// iterations releases every byte, and the card's listeners, timers and animation frames all
// balance exactly (200 visibilitychange listeners added, 200 removed; 400 frames requested,
// 400 cancelled). It is the price of driving a browser environment synchronously.
const YIELD_EVERY = 100;
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

// Runs one described case and returns what happened. Never throws for a card-level
// outcome: a refused configuration is a legitimate result with its own invariants, not an
// error in the run.
function runCase(description) {
  let scenario;
  try {
    scenario = buildScenario(description);
  } catch (error) {
    return { outcome: "unbuildable", violations: [`the scenario builder refused its own description: ${error.message}`] };
  }

  let card;
  try {
    card = env.createCard(scenario.config, scenario.hass);
  } catch (error) {
    // setConfig refused. That is correct behaviour for a broken palette or a malformed
    // views list, and the message is the card's contract with the user.
    // NOT `instanceof Error`. The card runs in its own V8 realm (see load-card.jsdom.js),
    // so the Error it throws has that realm's Error.prototype and instanceof is false for
    // a perfectly ordinary error. What matters to a user is that the refusal carries a
    // readable message, and that is what this checks.
    const message = error && typeof error.message === "string" ? error.message.trim() : "";
    const violations = [];
    if (!message) {
      violations.push(`setConfig refused with something that carries no message: ${String(error)}`);
    } else if (!/^Invalid configuration:|^Room Climate Card/.test(message)) {
      violations.push(`setConfig refused with a message that does not identify itself: ${message}`);
    }
    return { outcome: "refused", violations, message };
  }

  try {
    const model = card._computeViewModel();
    const violations = checkModel(model, { states: scenario.states });
    const html = card.shadowRoot ? card.shadowRoot.innerHTML : "";
    violations.push(...checkRendered(card.shadowRoot, html));
    return { outcome: model.empty ? "empty" : "rendered", violations, model };
  } catch (error) {
    return { outcome: "threw", violations: [`computing or rendering the card threw: ${error && error.message}`] };
  } finally {
    env.cleanup(card);
  }
}

// Which invariants a result violated, without the specifics. Shrinking has to aim at THIS
// rather than at "something is still wrong": a reduction that trades a NaN position for an
// unrelated refusal is not a smaller version of the same bug, it is a different bug, and
// following it produces a minimal case that does not demonstrate what was found. The first
// large run did exactly that.
function violationSignature(violations) {
  return JSON.stringify([...violations].sort());
}

function unknownViolations(result) {
  return classifyViolations(result.violations).unknown;
}

function describeFailure(seed, description, violations) {
  // Shrink before reporting: a twelve-room card with six configuration keys tells nobody
  // anything, and the minimised description is a fixture that can be pasted into a test.
  const before = sizeOf(description);
  const wanted = violationSignature(violations);
  let minimal;
  let steps;
  try {
    ({ description: minimal, steps } = shrink(description, (candidate) => {
      const result = withQuietConsole(() => runCase(candidate));
      return violationSignature(unknownViolations(result)) === wanted;
    }));
  } catch (error) {
    // Reporting must never replace the finding with a secondary infrastructure error. The
    // unshrunk JSON is still a deterministic reproducer and the shrinker failure is evidence
    // to fix, so preserve both in the assertion that the developer will actually see.
    return [
      `seed 0x${seed.toString(16)} violated ${violations.length} invariant(s):`,
      ...violations.map((violation) => `  - ${violation}`),
      `shrinking failed after a ${before.rooms}-room/${before.configKeys}-key input: ${error && error.message}`,
      "unshrunk description (paste into scenario(…) to reproduce):",
      JSON.stringify(description, null, 2),
    ].join("\n");
  }
  const after = sizeOf(minimal);
  const stillFailing = unknownViolations(withQuietConsole(() => runCase(minimal)));
  return [
    `seed 0x${seed.toString(16)} violated ${violations.length} invariant(s):`,
    ...violations.map((violation) => `  - ${violation}`),
    `shrunk in ${steps} steps from ${before.rooms} rooms/${before.configKeys} config keys` +
      ` to ${after.rooms} rooms/${after.configKeys} config keys:`,
    `  - ${stillFailing.join("\n  - ")}`,
    "minimal description (paste into scenario(…) to reproduce):",
    JSON.stringify(minimal, null, 2),
  ].join("\n");
}

test(`the card survives ${CASES} randomly described dashboards`, async (t) => {
  const seedRng = new SeededRandom(DEFAULT_SEED);
  const outcomes = { rendered: 0, empty: 0, refused: 0, threw: 0, unbuildable: 0 };
  const failures = [];
  // Cases that reproduce a defect already registered in test/known-issues.js. They are
  // counted, not reported: the register holds a deterministic reproduction of each one, so
  // repeating it here would only bury a genuinely new finding under a known one.
  const knownDefects = new Map();

  for (let start = 0; start < CASES; start += YIELD_EVERY) {
    withQuietConsole(() => {
      for (let index = start; index < Math.min(start + YIELD_EVERY, CASES); index++) {
        const seed = seedRng.int(0, 0x7fffffff);
        const description = generateDescription(seed);
        const result = runCase(description);
        outcomes[result.outcome] += 1;
        if (!result.violations.length) continue;
        const classified = classifyViolations(result.violations);
        for (const issueId of new Set(classified.known.map(({ issue }) => issue.id))) {
          // Count generated CASES, not the several model locations that may expose one
          // defect. Otherwise a copied room value makes the census look more frequent than
          // the actual failing input population.
          knownDefects.set(issueId, (knownDefects.get(issueId) || 0) + 1);
        }
        if (classified.unknown.length) failures.push({ seed, description, violations: classified.unknown });
      }
    });
    await yieldToEventLoop();
  }

  // Report the census whatever happens: it is the evidence that the run tested what it
  // says it tested, and it is the first thing to look at when a number moves.
  const census =
    Object.entries(outcomes)
      .map(([name, count]) => `${name} ${count} (${((100 * count) / CASES).toFixed(1)} %)`)
      .join(", ") +
    (knownDefects.size
      ? ` | known defects reproduced: ${[...knownDefects].map(([id, count]) => `${id}×${count}`).join(", ")}`
      : "");
  t.diagnostic(`property seed ${formatSeed(DEFAULT_SEED)} | ${census}`);
  writePropertyReport("model", {
    seed: DEFAULT_SEED,
    seedHex: formatSeed(DEFAULT_SEED),
    cases: CASES,
    outcomes,
    knownDefects: Object.fromEntries(knownDefects),
    unknownFailureCount: failures.length,
  });

  if (failures.length) {
    // One shrunk example PER DISTINCT KIND of failure, not just the first one found. A run
    // that turns up three different bugs should report three, or the second and third stay
    // hidden until the first is fixed.
    const byKind = new Map();
    for (const failure of failures) {
      const signature = violationSignature(failure.violations);
      if (!byKind.has(signature)) byKind.set(signature, failure);
    }
    const reports = [...byKind.values()].map((failure) =>
      describeFailure(failure.seed, failure.description, failure.violations)
    );
    assert.fail(
      `${failures.length}/${CASES} randomly described dashboards violated an invariant, ` +
        `in ${byKind.size} distinct kind(s).\n` +
        `outcomes: ${census}\n\n` +
        reports.join("\n\n----------------------------------------\n\n")
    );
  }

  assert.equal(outcomes.threw, 0, `outcomes: ${census}`);
  assert.equal(outcomes.unbuildable, 0, `outcomes: ${census}`);
  const share = (name) => (100 * outcomes[name]) / CASES;

  // THE BANDS, and why each one is where it is.
  //
  // rendered: the run's whole purpose. Most invariants live behind a card that actually
  // has data, so if this falls the run quietly stops checking them. Its floor is the
  // lesson of the previous version, which sat at zero.
  assert.ok(
    share("rendered") >= 55,
    `only ${share("rendered").toFixed(1)} % of cases produced a card with data — the invariants are not being reached. ${census}`
  );
  // empty: the no-data card is a real, reachable, valuable state and must keep appearing —
  // but it is cheap to check, so it must not dominate.
  assert.ok(
    share("empty") >= 5 && share("empty") <= 40,
    `no-data cards are ${share("empty").toFixed(1)} % of the run, outside 5–40 %. ${census}`
  );
  // refused: broken palettes and malformed view lists must keep reaching setConfig, or the
  // atomicity path below stops being exercised.
  assert.ok(
    share("refused") >= 3 && share("refused") <= 30,
    `refused configurations are ${share("refused").toFixed(1)} % of the run, outside 3–30 %. ${census}`
  );
});

// ------------------------------------------------------------------- atomic setConfig --

test("a refused configuration leaves the previous one untouched", () => {
  // Generated rather than hand-picked: whatever the generator has learned to break, this
  // sees. The property is the one that matters in a live dashboard — a card that has been
  // working must not be left half-configured by an edit that fails.
  const seedRng = new SeededRandom(DEFAULT_SEED ^ 0x5eed);
  const good = buildScenario({ metric: "temperature", rooms: [{}, {}] });
  let checked = 0;

  withQuietConsole(() => {
    for (let index = 0; index < CASES && checked < 25; index++) {
      const candidate = buildScenario(generateDescription(seedRng.int(0, 0x7fffffff)));
      const card = env.createCard(good.config, good.hass);
      const before = JSON.stringify(card._computeViewModel());
      try {
        card.setConfig(candidate.config);
      } catch {
        checked += 1;
        const after = JSON.stringify(card._computeViewModel());
        assert.equal(after, before, "a refused setConfig must not change the rendered model");
      } finally {
        env.cleanup(card);
      }
    }
  });

  assert.ok(checked > 0, "no configuration was refused, so atomicity was never exercised");
});
