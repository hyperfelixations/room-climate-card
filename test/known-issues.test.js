"use strict";

// One reproduction per entry in the known-defect register, plus the checks that keep the
// register itself honest.
//
// Read this file to find out what is currently broken in the card and deliberately not yet
// fixed. Each reproduction asserts the behaviour the card SHOULD have, so the day the
// defect is fixed the assertion starts passing — and expectedFailure() turns that into a
// failing run that says so.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KNOWN_ISSUES,
  classifyViolations,
  expectedFailure,
  isExpectedReproductionFailure,
} = require("./known-issues.js");
const { createTestEnvironment } = require("./helpers/load-card.jsdom.js");
const { buildScenario } = require("./fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

// ------------------------------------------------------- the register itself --

test("every registered issue is fully described", () => {
  for (const issue of KNOWN_ISSUES) {
    assert.match(issue.id, /^BUG-\d{2,}$/, `id "${issue.id}"`);
    assert.ok(issue.summary && issue.summary.length > 40, `${issue.id}: summary must say what is wrong`);
    assert.ok(issue.area, `${issue.id}: area`);
    assert.match(issue.discovered, /^\d{4}-\d{2}-\d{2}$/, `${issue.id}: discovered`);
    assert.ok(issue.foundBy, `${issue.id}: foundBy must name the test that turned it up`);
  }
});

test("no id is registered twice", () => {
  const ids = KNOWN_ISSUES.map((issue) => issue.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(", "));
});

test("known-issue classification never hides an unrelated violation", () => {
  const known =
    "everyNumberIsFinite: average.value is -Infinity " +
    "(source room; a finite Fahrenheit entity state overflowed during conversion)";
  const unrelated = "active view is unavailable";
  const classified = classifyViolations([known, unrelated]);
  assert.deepEqual(classified.known.map(({ issue, violation }) => [issue.id, violation]), [["BUG-07", known]]);
  assert.deepEqual(classified.unknown, [unrelated]);
});

test("conversion and finite-input aggregation overflows are attributed to different defects", () => {
  const conversion =
    "everyNumberIsFinite: average.value is -Infinity " +
    "(source room; a finite Fahrenheit entity state overflowed during conversion)";
  const aggregation = "everyNumberIsFinite: average.value is Infinity (source calculated; finite room inputs)";
  const classified = classifyViolations([conversion, aggregation]);
  assert.deepEqual(classified.known.map(({ issue }) => issue.id), ["BUG-07", "BUG-11"]);
  assert.deepEqual(classified.unknown, []);
});

test("every copied view of a Fahrenheit overflow is attributed without hiding other findings", () => {
  const conversionViolations = [
    "everyNumberIsFinite: average.value is -Infinity (source calculated; a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: rooms.visible[0].value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: rooms.chips[0].room.value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: rooms.chipRows[0].chips[0].room.value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: extremes.coolest.value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: roomMarkers[0].value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: spread is Infinity (derived from a finite Fahrenheit entity state that overflowed during conversion)",
  ];
  const unrelated = "everyNumberIsFinite: range.min is Infinity";
  const classified = classifyViolations([...conversionViolations, unrelated]);
  assert.deepEqual(classified.known.map(({ issue }) => issue.id), conversionViolations.map(() => "BUG-07"));
  assert.deepEqual(classified.unknown, [unrelated]);
});

test("known-issue classification attributes each matching violation independently", () => {
  const bug06 = "everyNumberIsFinite: scale.markerPosition is NaN";
  const bug11 = "everyNumberIsFinite: average.value is Infinity (source calculated; finite room inputs)";
  const unrelated = "rooms lost when only the primary went unavailable: sensor.room0";
  const classified = classifyViolations([bug06, bug11, unrelated]);
  assert.deepEqual(classified.known.map(({ issue }) => issue.id), ["BUG-06", "BUG-11"]);
  assert.deepEqual(classified.unknown, [unrelated], "a defect that was fixed no longer absorbs its old signature");
});

test("expected reproductions accept only their identifying assertion", () => {
  const matching = new assert.AssertionError({ message: "the whole card emptied when only the primary went unavailable" });
  const unrelated = new assert.AssertionError({ message: "an unrelated assertion failed" });
  assert.equal(isExpectedReproductionFailure(matching, /whole card emptied/), true);
  assert.equal(isExpectedReproductionFailure(unrelated, /whole card emptied/), false);
  assert.equal(isExpectedReproductionFailure(new Error("whole card emptied"), /whole card emptied/), false);
  assert.equal(isExpectedReproductionFailure(new SyntaxError("known parser failure"), (error) => error.name === "SyntaxError"), true);
});

test("every registered issue has a reproduction in this file", () => {
  // Without this, an entry could be added to the register and quietly never reproduced —
  // a note in a comment wearing a test's clothes.
  const source = require("node:fs").readFileSync(__filename, "utf8");
  for (const issue of KNOWN_ISSUES) {
    assert.ok(
      source.includes(`expectedFailure("${issue.id}"`),
      `${issue.id} is registered but has no expectedFailure() reproduction here`
    );
  }
});

// ------------------------------------------------------------ reproductions --

// BUG-06 — found by the property run, seed 0x99accdd.
//
// An axis whose ends are 1e308 apart in each direction spans 2e308, which is not a double.
// The subtraction overflows to Infinity, a position derived from it divides Infinity by
// Infinity into NaN, and the NaN is written straight into a CSS calc(). In a browser the
// declaration is simply dropped and the marker lands in the wrong place; under jsdom the
// CSS parser rejects `calc(NaN% + 0px)` outright and the render throws.
//
// WHAT REACHES IT is a custom profile whose declared scale spans both extremes. Two entity
// READINGS no longer can: every measurement has a physical floor, so no two valid readings
// are far enough apart for their span to overflow. The arithmetic that overflows is
// untouched, and the card's answer should still be the no-data state it already has for an
// unusable reading — not a card drawn at NaN per cent.
const BUG_06_PROFILE = {
  source: "custom",
  unit: "°C",
  comparison: ">=",
  bands: { comfort: { min: -10, max: 40 }, optimal: { min: 18, max: 24 } },
  scale: { min: -1e308, max: 1e308, step: 5 },
  tiers: [
    { min: 40, score: 1, level: "hot", zone: "outside" },
    { min: 18, score: 0, level: "ok", zone: "optimal" },
    { default: true, score: -1, level: "cold", zone: "outside" },
  ],
};

expectedFailure("BUG-06", (error) =>
  (error && error.name === "SyntaxError" && error.source === "calc(NaN% + 0px)" && /"\)" is expected/.test(error.message)) ||
  (error && error.code === "ERR_ASSERTION" && /spread is Infinity|scale\.markerPositions\..+ is NaN|NaN reached the DOM/.test(error.message)), () => {
  const built = buildScenario({
    metric: "temperature",
    primary: { state: 1e308 },
    config: { classification: BUG_06_PROFILE },
  });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    for (const [name, position] of Object.entries(model.scale.markerPositions)) {
      assert.ok(Number.isFinite(position), `scale.markerPositions.${name} is ${position}`);
    }
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML), "NaN reached the DOM");
  });
});

// The neighbouring case that DOES work, so the boundary is recorded and a future fix can be
// checked against something. This is an ordinary test: it passes today and must keep doing so.
test("BUG-06's neighbourhood: a span that fits in a double is handled correctly", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: { state: 1e200 },
    config: { classification: { ...BUG_06_PROFILE, scale: { min: -1e200, max: 1e200, step: 5 } } },
  });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    for (const position of Object.values(model.scale.markerPositions)) assert.ok(Number.isFinite(position));
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML));
  });
});

test("BUG-06's neighbourhood: two readings can no longer be far enough apart to overflow", () => {
  // The route the defect was found on, closed by the physical floors rather than by any
  // change to the arithmetic. Recorded so that a measurement added without a floor is
  // known to reopen it.
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e308 }, { state: -273.15 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML));
  });
});

// BUG-07 — found by the property run, seed 0x6627f909, shrunk to one room.
//
// One room reporting 1e308 °F. The conversion to Celsius is (F - 32) × 5/9; the
// multiplication by five overflows, and Infinity is what comes out. The card then displays
// it: the headline reads "∞ °F".
//
// The overflow is specific to the SCALING path — °C and K at the same magnitude come
// through as ordinary (if absurd) numbers, because their conversion never multiplies.
//
// ONE DIRECTION IS LEFT. An overflow to -Infinity lands below absolute zero, which the
// temperature profile now refuses as an impossible reading — the right answer arrived at
// for the wrong reason, and it leaves the overflow itself exactly where it was.
expectedFailure("BUG-07", /average\.value is -?Infinity|an infinity sign is shown as a reading/, () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: 1e308, unit: { value: "°F" }, deviceClass: null }],
  });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.average.value), `average.value is ${model.average.value}`);
    assert.ok(!/[∞]/.test(card.shadowRoot.textContent), "an infinity sign is shown as a reading");
  });
});

test("BUG-07's neighbourhood: the same magnitude in Celsius does not overflow", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: 1e308, unit: { value: "°C" }, deviceClass: null }],
  });
  env.withCard(built.config, built.hass, (card) => {
    assert.ok(Number.isFinite(card._computeViewModel().average.value));
  });
});

// BUG-11 — found by the property run, seed 0x3382a0c6, and reduced to two rooms.
//
// Every entity value is a finite JavaScript number and the true mean is 1e308, also finite.
// The room-consensus path nevertheless adds first: 1e308 + 1e308 becomes Infinity, and
// dividing that intermediate result by two leaves Infinity as the headline. This is not
// BUG-07's unit conversion and not BUG-06's min/max span: both inputs and their span are
// finite, and only the aggregate's intermediate sum overflows.
expectedFailure("BUG-11", /room consensus average is Infinity although both room inputs are finite/, () => {
  const built = buildScenario({ metric: "temperature", primary: null, rooms: [{ state: 1e308 }, { state: 1e308 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.equal(model.roomMarkers.length, 2, "the reproduction must exercise a two-room consensus");
    for (const room of model.roomMarkers) {
      assert.ok(Number.isFinite(room.value), `input ${room.entity} is unexpectedly ${room.value}`);
    }
    assert.ok(
      Number.isFinite(model.average.value),
      `room consensus average is ${model.average.value} although both room inputs are finite`
    );
  });
});

test("BUG-11's neighbourhood: a smaller same-sign consensus remains finite", () => {
  const built = buildScenario({ metric: "temperature", primary: null, rooms: [{ state: 1e307 }, { state: 1e307 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.equal(model.average.source, "calculated");
    assert.ok(Number.isFinite(model.average.value));
    assert.equal(model.average.value, 1e307);
  });
});

// What BUG-08 was, kept as an ordinary test now that it holds: -274 °C is colder than
// anything can be, and the card refuses it the way it refuses every other impossible
// reading. The three values straddle the limit from just past it to absurdly past it.
test("a temperature below absolute zero is refused rather than drawn", () => {
  for (const value of [-273.16, -274, -1000]) {
    const built = buildScenario({ metric: "temperature", primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${value} °C is below absolute zero`);
    });
  }
});

// BUG-09 — found while working out what the property generator should be allowed to
// write. A key nobody meant to type produces no complaint of any kind.
//
// The card is strict about this everywhere else: `palette: {optimal: …, nonsense: 1}` is
// refused by name, and so is an unknown key in `classification`. Only the top level, which
// is the level a user actually edits, lets a typo through in silence.
expectedFailure("BUG-09", /was accepted without a word about it/, () => {
  const built = buildScenario({ rooms: [{}] });
  for (const key of ["pallete", "subtitel", "roomz", "entiy"]) {
    const messages = [];
    const original = { warn: console.warn, error: console.error };
    console.warn = (...args) => messages.push(args.join(" "));
    console.error = (...args) => messages.push(args.join(" "));
    let refused = false;
    try {
      env.withCard({ ...built.config, [key]: "vivid" }, built.hass, () => {});
    } catch {
      refused = true;
    } finally {
      Object.assign(console, original);
    }
    assert.ok(refused || messages.length > 0, `"${key}" was accepted without a word about it`);
  }
});

// What BUG-10 was, kept as an ordinary test now that it holds. The metamorphic relations
// found it: every single-card invariant passed on both sides, because the blank card was
// perfectly self-consistent — it was simply blank for no good reason.
//
// The trigger needed BOTH halves: rooms that disagree about what they measure, AND a primary
// entity whose state cannot be read. The primary's device_class outlives the outage and says
// which kind is the card's, so the rooms of that kind carry it.
test("an unreadable primary still says what the card is about", () => {
  const humidity = { state: 50, deviceClass: { value: "humidity" }, unit: { value: "%" } };
  const rooms = [{ state: 21 }, { state: 23 }, humidity];

  for (const state of ["unavailable", "unknown", "not a number"]) {
    const built = buildScenario({ metric: "temperature", primary: { state }, rooms });
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      assert.equal(model.empty, false, `the primary reads "${state}" and still declares temperature`);
      assert.equal((model.roomMarkers || []).length, 2, `two usable temperature rooms, ${state}`);
      assert.equal(model.average.value, 22, state);
    });
  }
});

test("each half of that trigger on its own is handled correctly", () => {
  const humidity = { state: 50, deviceClass: { value: "humidity" }, unit: { value: "%" } };

  // Uniform rooms and an unusable primary: the rooms carry the card, which is right.
  const uniform = buildScenario({
    metric: "temperature",
    primary: { state: "unavailable" },
    rooms: [{ state: 21 }, { state: 23 }],
  });
  env.withCard(uniform.config, uniform.hass, (card) => {
    const model = card._computeViewModel();
    assert.equal(model.empty, false, "uniform rooms survive an unavailable primary");
    assert.equal(model.roomMarkers.length, 2);
  });

  // Rooms that disagree and a primary that can be read: the primary settles it, exactly as
  // it does above when it can only declare and not report.
  const arbitrated = buildScenario({
    metric: "temperature",
    primary: { state: 22 },
    rooms: [{ state: 21 }, { state: 23 }, humidity],
  });
  env.withCard(arbitrated.config, arbitrated.hass, (card) => {
    const model = card._computeViewModel();
    assert.equal(model.empty, false);
    assert.equal(model.roomMarkers.length, 2, "the humidity room is ignored and the others are not");
  });

  // And with nobody able to arbitrate, giving up is correct. Three ways to have nobody:
  // no primary at all, one Home Assistant has never heard of, and one that reports neither
  // a device_class nor a unit. An id absent from hass.states is a typo, not an outage.
  const noArbiter = [
    { primary: null },
    { primary: { present: false } },
    { primary: { state: "unavailable", deviceClass: null, unit: null } },
  ];
  for (const [index, description] of noArbiter.entries()) {
    const built = buildScenario({ metric: "temperature", rooms: [{ state: 21 }, humidity], ...description });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `nobody can say which metric the card is about (${index})`);
    });
  }
});

test("BUG-09's neighbourhood: the same mistake one level down IS refused by name", () => {
  const built = buildScenario({ rooms: [{}] });
  assert.throws(
    () => env.withCard({ ...built.config, palette: { optimal: "#3D9970", nonsense: 1 } }, built.hass, () => {}),
    /nonsense/,
    "a nested unknown key is named in the error, which is what the top level should also do"
  );
});

test("every metric refuses what it cannot be, and accepts the limit itself", () => {
  const impossible = [
    ["temperature", -273.16],
    ["humidity", -1],
    ["humidity", 101],
    ["humidity", 800],
    ["co2", -500],
    ["pm25", -1],
  ];
  for (const [metric, value] of impossible) {
    const built = buildScenario({ metric, primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${metric} ${value} should be rejected`);
    });
  }

  // The other half of the same rule, and the one that keeps it from being a rounding trap.
  for (const [metric, value] of [["temperature", -273.15], ["humidity", 0], ["humidity", 100], ["co2", 0], ["pm25", 0]]) {
    const built = buildScenario({ metric, primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, false, `${metric} ${value} is the limit itself and is a reading`);
    });
  }
});

// BUG-12 — found by the metamorphic relation "a room the card cannot use changes nothing
// else", which adds a room reporting a different metric to a card that was already showing
// something and asks what moved.
//
// Nothing about the NUMBER moves: the value and its position on the scale are identical on
// both sides. What moves is who the card says the number belongs to, and the caption and tap
// target that follow from it.
//
// The two rooms below are deliberately different kinds of unusable. `sensor.room1` does not
// exist at all, and the topology already ignores it — which is right, and is what keeps a
// card stable while Home Assistant is still publishing states. `sensor.foreign` exists and
// reports a temperature on a humidity card, so it can never contribute; the topology counts
// it all the same.
expectedFailure("BUG-12", /caption|single-room card/, () => {
  const description = {
    metric: "humidity",
    primary: { state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } },
    rooms: [
      { id: "sensor.avg", state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } },
      { id: "sensor.room1", present: false, state: 50 },
    ],
  };
  const withForeign = {
    ...description,
    rooms: [...description.rooms, { id: "sensor.foreign", state: 21, deviceClass: { value: "temperature" }, unit: { value: "°C" } }],
  };

  const sourceOf = (built) => {
    let answer;
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      answer = { source: model.average.source, label: model.average.label, value: model.average.value };
    });
    return answer;
  };

  const before = sourceOf(buildScenario(description));
  const after = sourceOf(buildScenario(withForeign));
  assert.equal(before.source, "room", "the card refers to exactly one usable entity, and it is a room");
  assert.equal(
    after.source,
    "room",
    "a room the card can never use must not turn a single-room card into a whole-home card, " +
      `but the caption moved from "${before.label}" to "${after.label}"`
  );
});

test("BUG-12's neighbourhood: a room that does not exist at all is already ignored", () => {
  // The half that behaves correctly, and the one the fix must not disturb: a configured room
  // Home Assistant has never heard of leaves the card's identity alone.
  const alone = buildScenario({
    metric: "humidity",
    primary: { state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } },
    rooms: [{ id: "sensor.avg", state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } }],
  });
  const withMissing = buildScenario({
    metric: "humidity",
    primary: { state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } },
    rooms: [
      { id: "sensor.avg", state: 44, deviceClass: { value: "humidity" }, unit: { value: "%" } },
      { id: "sensor.nowhere", present: false, state: 50 },
    ],
  });
  const sourceOf = (built) => {
    let answer;
    env.withCard(built.config, built.hass, (card) => {
      answer = card._computeViewModel().average.source;
    });
    return answer;
  };
  assert.equal(sourceOf(alone), "room");
  assert.equal(sourceOf(withMissing), "room", "an entity that does not exist does not change what the card is about");
});
