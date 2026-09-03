"use strict";

// The single-card property run: throws randomly described dashboards at the built card and
// checks every invariant that must hold for any card. Its boundary: the paired metamorphic
// run (metamorphic.property.test.js) covers relations between two cards; the invariants
// themselves live in properties.js and the generators in generators.js.
// The load-bearing assertion is the outcome census — if the share of rendered / empty /
// refused cases leaves its band the run fails, because it is then no longer testing what it
// claims. Rationale: see internal dev doc §4 "Die Property-Schicht".

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

// The card's diagnostics are a feature tested in characterization-diagnostics; here they
// would bury the result, so they are captured rather than printed.
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

// A rendered card stays reachable from jsdom's internal queues until the event loop turns;
// one macrotask between batches releases it. Listeners, timers and frames balance exactly.
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
    // setConfig refused — correct for a broken palette or malformed views list. Not
    // `instanceof Error`: the card runs in its own V8 realm (load-card.jsdom.js), so
    // instanceof is false for an ordinary error; what matters is a readable message.
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

// Which invariants a result violated, without the specifics. Shrinking aims at this
// signature, not at "something is still wrong": a reduction that trades one violation for an
// unrelated one is a different bug, and following it minimises the wrong case.
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
    // A shrinker failure must not replace the finding: keep both the unshrunk reproducer and
    // the shrinker error in the assertion.
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
  // Cases reproducing a defect already in test/known-issues.js: counted, not reported, so a
  // genuinely new finding is not buried under a known one.
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
          // Count generated cases, not the model locations that expose one defect, or the
          // census overstates how often the failing input actually occurs.
          knownDefects.set(issueId, (knownDefects.get(issueId) || 0) + 1);
        }
        if (classified.unknown.length) failures.push({ seed, description, violations: classified.unknown });
      }
    });
    await yieldToEventLoop();
  }

  // Report the census whatever happens: it is the evidence the run tested what it claims.
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
    // One shrunk example per distinct kind of failure, so a run that turns up three bugs
    // reports three.
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

  // The outcome bands. rendered: most invariants live behind a card with data, so a floor
  // keeps them reachable. empty: a real state that must keep appearing but not dominate.
  // refused: broken palettes and view lists must keep reaching setConfig for the atomicity
  // test below.
  assert.ok(
    share("rendered") >= 55,
    `only ${share("rendered").toFixed(1)} % of cases produced a card with data — the invariants are not being reached. ${census}`
  );
  assert.ok(
    share("empty") >= 5 && share("empty") <= 40,
    `no-data cards are ${share("empty").toFixed(1)} % of the run, outside 5–40 %. ${census}`
  );
  assert.ok(
    share("refused") >= 3 && share("refused") <= 30,
    `refused configurations are ${share("refused").toFixed(1)} % of the run, outside 3–30 %. ${census}`
  );
});

// ------------------------------------------------------------------- atomic setConfig --

test("a refused configuration leaves the previous one untouched", () => {
  // Generated rather than hand-picked. The live-dashboard property: a working card must not
  // be left half-configured by an edit that fails.
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
