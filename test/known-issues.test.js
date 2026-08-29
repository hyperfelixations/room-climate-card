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
  // The whole point of partitioning violation by violation rather than case by case: a case
  // that reproduces a registered defect and ALSO does something new must report the new
  // thing. One matching violation must never absorb the ones beside it.
  const known = "everyNumberIsFinite: scale.markerPositions.average is NaN";
  const unrelated = ["active view is unavailable", "rooms lost when only the primary went unavailable: sensor.room0"];
  const classified = classifyViolations([known, ...unrelated]);
  assert.deepEqual(classified.known.map(({ issue, violation }) => [issue.id, violation]), [["BUG-06", known]]);
  assert.deepEqual(classified.unknown, unrelated);
});

test("a defect that was fixed no longer absorbs its old signature", () => {
  // These are the exact violation strings BUG-07, BUG-11 and BUG-12 were recognised by while
  // they were open. Each is now a finding nobody has an explanation for, and the run has to
  // say so rather than file it under a defect that no longer exists — which is the failure
  // mode a register like this has: an entry outliving its defect and quietly swallowing the
  // next regression that looks like it.
  const retired = [
    "everyNumberIsFinite: average.value is -Infinity (source room; a finite Fahrenheit entity state overflowed during conversion)",
    "everyNumberIsFinite: average.value is Infinity (source calculated; finite room inputs)",
    "aggregatesStayWithinTheirInputs: average Infinity lies outside its rooms",
    'average moved from {"value":44,"position":50,"source":"room"} to {"value":44,"position":50,"source":"sensor"}',
    "setConfig refused with a message that does not identify itself: Cannot read properties of undefined (reading 'color')",
  ];
  const classified = classifyViolations(retired);
  assert.deepEqual(classified.known, []);
  assert.deepEqual(classified.unknown, retired);
});

test("every violation is judged on its own, not on the company it keeps", () => {
  // Both of BUG-06's two symptoms, and a third string that merely resembles them. Ordering
  // and count are asserted, so a matcher that started swallowing everything would show up
  // here rather than as a quietly green sweep.
  const span = "everyNumberIsFinite: spread is Infinity";
  const position = "everyNumberIsFinite: roomMarkers[0].position is NaN";
  const other = "everyNumberIsFinite: range.min is Infinity";
  const classified = classifyViolations([span, other, position]);
  assert.deepEqual(classified.known.map(({ issue, violation }) => [issue.id, violation]), [
    ["BUG-06", span],
    ["BUG-06", position],
  ]);
  assert.deepEqual(classified.unknown, [other]);
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

// What BUG-07 was, kept as an ordinary test now that it holds. One room reporting 1e308 °F:
// the conversion to Celsius is (F - 32) × 5/9, the multiplication by five overflows, and the
// card used to display what came out — the headline read "∞ °F".
//
// A conversion result that is not a number is not a reading, so the card refuses it the way
// it refuses 800 % humidity, and the whole card lands in the no-data state because that room
// was its only source.
//
// The overflow is specific to the SCALING path, which is what the neighbouring test holds:
// °C and K at the same magnitude come through as ordinary (if absurd) numbers, because their
// conversion never multiplies.
test("a reading that overflows on the way into the canonical unit is not a reading", () => {
  for (const value of [1e308, -1e308]) {
    const built = buildScenario({
      metric: "temperature",
      primary: null,
      rooms: [{ state: value, unit: { value: "°F" }, deviceClass: null }],
    });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${value} °F`);
      assert.ok(!/[∞]/.test(card.shadowRoot.textContent), "an infinity sign is shown as a reading");
    });
  }
});

test("the same magnitude in a unit that does not scale is still a reading", () => {
  for (const unit of ["°C", "K"]) {
    const built = buildScenario({
      metric: "temperature",
      primary: null,
      rooms: [{ state: 1e308, unit: { value: unit }, deviceClass: null }],
    });
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      assert.equal(model.empty, false, unit);
      assert.ok(Number.isFinite(model.average.value), unit);
    });
  }
});

// What BUG-11 was, kept as an ordinary test now that it holds. Every entity value is a
// finite JavaScript number and the true mean is 1e308, also finite — but the room-consensus
// path added first, 1e308 + 1e308 became Infinity, and dividing that intermediate result by
// two left Infinity as the headline. Not BUG-07's unit conversion and not BUG-06's min/max
// span: both inputs and their span are finite, and only the aggregate's own sum overflowed.
test("a room consensus is the mean of its rooms even when their sum is not a number", () => {
  const built = buildScenario({ metric: "temperature", primary: null, rooms: [{ state: 1e308 }, { state: 1e308 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.equal(model.roomMarkers.length, 2, "the case must exercise a two-room consensus");
    for (const room of model.roomMarkers) {
      assert.ok(Number.isFinite(room.value), `input ${room.entity} is unexpectedly ${room.value}`);
    }
    assert.equal(model.average.source, "calculated");
    assert.equal(model.average.value, 1e308, "the mean of two equal readings is that reading");
  });
});

test("and the two ends of the number line still average to nothing in particular", () => {
  // The case the scaled path exists for: summing first gives Infinity - Infinity, which is
  // NaN, while dividing by the larger magnitude first gives the 0 a person would write down.
  const built = buildScenario({ metric: "temperature", primary: null, rooms: [{ state: 1e308 }, { state: -273.15 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.average.value), `average is ${model.average.value}`);
    assert.equal(model.average.value, (1e308 + -273.15) / 2);
  });
});

test("a smaller same-sign consensus is unchanged, to the last digit", () => {
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

// What BUG-09 was, kept as an ordinary test now that it holds. A key nobody meant to type
// used to produce no complaint of any kind — no error, no warning, no diagnostic — while the
// same mistake one level down was refused by name, because every nested object goes through
// assertAllowedKeys(). The top level, which is the level a person actually edits, was the
// one place that let a typo through in silence.
//
// It warns rather than refusing: an option that does not apply is cosmetic, while a card
// that stops loading after an update is not. The nested behaviour is unchanged and is
// asserted below.
function warningsFor(config, hass) {
  const messages = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => messages.push(args.join(" "));
  console.error = (...args) => messages.push(args.join(" "));
  try {
    env.withCard(config, hass, () => {});
  } finally {
    Object.assign(console, original);
  }
  return messages;
}

test("a misspelled top-level key is named, with the option it was probably meant to be", () => {
  const built = buildScenario({ rooms: [{}] });
  const meantToBe = { pallete: "palette", subtitel: "subtitle", roomz: "rooms", entiy: "entity" };
  for (const [written, intended] of Object.entries(meantToBe)) {
    const messages = warningsFor({ ...built.config, [written]: "vivid" }, built.hass);
    const named = messages.filter((message) => message.includes(written));
    assert.equal(named.length, 1, `"${written}" produced ${messages.length} message(s): ${messages.join(" | ")}`);
    assert.match(named[0], new RegExp(`did you mean "${intended}"`), named[0]);
  }
});

test("a key that resembles nothing is still named, without inventing a suggestion", () => {
  const built = buildScenario({ rooms: [{}] });
  const messages = warningsFor({ ...built.config, wibble_wobble: 1 }, built.hass);
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.match(messages[0], /wibble_wobble: ignoring an unknown top-level option$/);
});

test("what Home Assistant writes onto every card configuration is not a typo", () => {
  // The frontend attaches its own bookkeeping to every card it lays out, and card-mod adds
  // one more. None of it is the card's, and complaining about it would be a false alarm on
  // an ordinary dashboard.
  const built = buildScenario({ rooms: [{}] });
  const framework = {
    type: "custom:room-climate-card",
    index: 2,
    view_index: 0,
    view_layout: { position: "sidebar" },
    layout_options: { grid_columns: 6 },
    grid_options: { columns: 12, rows: 4 },
    visibility: [{ condition: "user", users: ["abc"] }],
    disabled: false,
    card_mod: { style: ".rtc-card { border: none; }" },
  };
  assert.deepEqual(warningsFor({ ...built.config, ...framework }, built.hass), []);
});

test("a start_view naming no view says so and opens on the first one instead", () => {
  const built = buildScenario({ rooms: [{}, {}] });
  const messages = warningsFor({ ...built.config, start_view: "sclae" }, built.hass);
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.match(messages[0], /^Room Climate Card: start_view: expected one of range, range_scale, scale, extremes, got "sclae"/);
  // And a real one stays silent, so the check is about the value rather than about the key.
  assert.deepEqual(warningsFor({ ...built.config, start_view: "scale" }, built.hass), []);
});

test("the same mistake one level down is still REFUSED by name, not warned about", () => {
  const built = buildScenario({ rooms: [{}] });
  assert.throws(
    () => env.withCard({ ...built.config, palette: { optimal: "#3D9970", nonsense: 1 } }, built.hass, () => {}),
    /nonsense/,
    "a nested unknown key is named in the error, which is what the top level should also do"
  );
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

// What BUG-12 was, kept as an ordinary test now that it holds. The metamorphic relation "a
// room the card cannot use changes nothing else" found it: nothing about the NUMBER moved —
// the value and its position on the scale were identical on both sides — but who the card
// said the number belonged to did, and the caption and tap target moved with it.
//
// The two rooms below are deliberately different kinds of "not a source". `sensor.room1` does
// not exist at all, which the topology has always ignored — that is what keeps a card stable
// while Home Assistant is still publishing states. `sensor.foreign` exists and reports a
// temperature on a humidity card, so it can never contribute, and the topology used to count
// it all the same.
test("a room the card can never use does not change what the headline is", () => {
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
  // The caption and the number too, because the caption is what the defect actually moved
  // and the number is what stayed put while it did.
  assert.equal(after.label, before.label);
  assert.equal(after.value, before.value);
});

test("the other half of that: a room that does not exist at all is ignored too", () => {
  // The half that always behaved correctly, and the one the fix had to leave alone: a
  // configured room Home Assistant has never heard of leaves the card's identity alone.
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

// What BUG-13 was, kept as an ordinary test now that it holds. `comparison: ">"` asks
// whether a reading is strictly ABOVE a tier's threshold, and the final tier's threshold is
// -Infinity. Nothing is strictly above -Infinity, so a reading that had reached -Infinity
// matched no tier at all, the classifier read `.color` off the undefined it got back,
// setConfig() threw, and Home Assistant painted the card red.
//
// TWO ANSWERS NOW STAND BETWEEN THAT AND THE SCREEN, and this case only ever reaches the
// first. The reading got there through the Fahrenheit conversion of BUG-07, which is now
// refused before anything classifies it — so the card is empty rather than red. The second
// is in classifyNumericValue() itself, which no longer needs a tier to exist; that half is
// asserted directly in unit/domain/domain-services-modules.test.js, because nothing
// reachable through a configuration gets to it any more.
test("a reading no tier covers empties the card rather than throwing", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: -1e308, unit: { value: "°F" } }],
    config: {
      classification: {
        source: "custom",
        unit: "°C",
        comparison: ">",
        bands: { comfort: { min: 20, max: 80 }, optimal: { min: 40, max: 60 } },
        scale: { min: 0, max: 100, step: 5 },
        tiers: [
          { min: 40, score: 1, level: "high", zone: "outside" },
          { default: true, score: 0, level: "ok", zone: "optimal" },
        ],
      },
    },
  });
  env.withCard(built.config, built.hass, (card) => {
    assert.equal(card._computeViewModel().empty, true, "a reading that classifies as nothing is not data");
  });
});

test("the same profile with >= reaches the same answer by the other road", () => {
  // The boundary, and the reason the defect was about the comparison rather than about the
  // value: `>=` admits -Infinity into the open-ended tier, so the classifier always had one
  // here. The reading is refused earlier either way now, so both profiles agree — which is
  // the point, since they always described the same card.
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: -1e308, unit: { value: "°F" } }],
    config: {
      classification: {
        source: "custom",
        unit: "°C",
        comparison: ">=",
        bands: { comfort: { min: 20, max: 80 }, optimal: { min: 40, max: 60 } },
        scale: { min: 0, max: 100, step: 5 },
        tiers: [
          { min: 40, score: 1, level: "high", zone: "outside" },
          { default: true, score: 0, level: "ok", zone: "optimal" },
        ],
      },
    },
  });
  env.withCard(built.config, built.hass, (card) => {
    assert.equal(card._computeViewModel().empty, true, "a reading that is not a number is not data");
  });
});
