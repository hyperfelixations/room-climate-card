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

const { KNOWN_ISSUES, expectedFailure } = require("./known-issues.js");
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

// BUG-06 — found by the property run, seed 0x99accdd, shrunk to two rooms.
//
// Two rooms whose values are 1e308 and -1e308 have a span of 2e308, which is not a double.
// The subtraction overflows to Infinity, every position derived from it divides by that
// Infinity into NaN, and the NaN is written straight into a CSS calc(). In a browser the
// declaration is simply dropped and the markers land in the wrong place; under jsdom the
// CSS parser rejects `calc(NaN% + 0px)` outright and the render throws.
//
// The threshold is exactly the overflow: ±1e200 is fine (span 2e200), ±1e308 is not. A real
// sensor cannot produce this, but a template sensor dividing by something near zero can,
// and the card's answer should be the no-data state it already has for unusable readings —
// not a card drawn at NaN per cent.
expectedFailure("BUG-06", () => {
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e308 }, { state: -1e308 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(Number.isFinite(model.extremes.warmestPosition), `warmestPosition is ${model.extremes.warmestPosition}`);
    for (const [name, position] of Object.entries(model.scale.markerPositions)) {
      assert.ok(Number.isFinite(position), `scale.markerPositions.${name} is ${position}`);
    }
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML), "NaN reached the DOM");
  });
});

// The neighbouring case that DOES work, so the boundary is recorded and a future fix can be
// checked against something. This is an ordinary test: it passes today and must keep doing so.
test("BUG-06's neighbourhood: a span that fits in a double is handled correctly", () => {
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e200 }, { state: -1e200 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(Number.isFinite(model.extremes.warmestPosition));
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML));
  });
});

// BUG-07 — found by the property run, seed 0x6627f909, shrunk to one room.
//
// One room reporting -1e308 °F. The conversion to Celsius is (F - 32) × 5/9; the
// multiplication by five overflows, and -Infinity is what comes out. The card then displays
// it: the headline reads "∞ °F" and the classification calls the room very cold.
//
// The overflow is specific to the SCALING path — °C and K at the same magnitude come
// through as ordinary (if absurd) numbers, because their conversion never multiplies.
expectedFailure("BUG-07", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: -1e308, unit: { value: "°F" }, deviceClass: null }],
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
    rooms: [{ state: -1e308, unit: { value: "°C" }, deviceClass: null }],
  });
  env.withCard(built.config, built.hass, (card) => {
    assert.ok(Number.isFinite(card._computeViewModel().average.value));
  });
});

// BUG-08 — found while characterising BUG-07.
//
// -274 °C is colder than anything can be. The card accepts it, averages it, classifies it
// and draws it. The same card rejects -1 % humidity, 101 % humidity, 0 ppm CO2 and a
// negative particulate concentration, each through an `invalidWhen` rule on its profile —
// and the temperature profile simply has none.
//
// Whether temperature SHOULD have one is a product decision, not a technical one, and it is
// recorded here as a defect because the card already has an opinion about impossible
// readings and does not apply it consistently.
expectedFailure("BUG-08", () => {
  for (const value of [-273.16, -274, -1000]) {
    const built = buildScenario({ metric: "temperature", primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(
        card._computeViewModel().empty,
        true,
        `${value} °C is below absolute zero and was rendered as data`
      );
    });
  }
});

// BUG-09 — found while working out what the property generator should be allowed to
// write. A key nobody meant to type produces no complaint of any kind.
//
// The card is strict about this everywhere else: `palette: {optimal: …, nonsense: 1}` is
// refused by name, and so is an unknown key in `classification`. Only the top level, which
// is the level a user actually edits, lets a typo through in silence.
expectedFailure("BUG-09", () => {
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

// BUG-10 — found by the metamorphic relations in test/property/metamorphic.property.test.js,
// which compare two cards derived from one description rather than checking one card against
// itself. Every single-card invariant passes on both sides of this: the blank card is
// perfectly self-consistent, it is simply blank for no good reason.
//
// The trigger needs BOTH halves. Rooms that disagree about what they measure, AND a primary
// entity whose state cannot be read. Either alone is handled correctly: uniform rooms keep
// working when the primary goes offline, and a usable primary settles a disagreement.
expectedFailure("BUG-10", () => {
  const humidity = { state: 50, deviceClass: { value: "humidity" }, unit: { value: "%" } };
  const rooms = [{ state: 21 }, { state: 23 }, humidity];

  for (const state of ["unavailable", "unknown", "not a number"]) {
    const built = buildScenario({ metric: "temperature", primary: { state }, rooms });
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      assert.equal(
        model.empty,
        false,
        `the primary reads "${state}", and its device_class still says temperature — the two ` +
          `temperature rooms are usable and the card showed nothing`
      );
      assert.equal((model.roomMarkers || []).length, 2, `two usable temperature rooms, ${state}`);
    });
  }
});

test("BUG-10's neighbourhood: each half of the trigger on its own is handled correctly", () => {
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

  // Rooms that disagree and a primary that can be read: the primary settles it, which is
  // also right — and is exactly the arbitration the defect above fails to reach for.
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

  // And with no primary configured at all there genuinely is nobody to arbitrate, so giving
  // up is correct. This is the case the fix must NOT change.
  const noArbiter = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: 21 }, humidity],
  });
  env.withCard(noArbiter.config, noArbiter.hass, (card) => {
    assert.equal(card._computeViewModel().empty, true, "nobody can say which metric the card is about");
  });
});

// BUG-11 — found by the metamorphic relations once the generator learned to configure one
// sensor in two roles at once, which is a thing people write: the sensor that gives the house
// average is also one of the rooms.
//
// Nothing about the reading changes. The card keeps showing 1600 ppm at the same place on the
// scale; it just stops calling it "Room 0" and starts calling it "Home avg." — because a
// second room appeared, and the second room is one it cannot use and does not show.
expectedFailure("BUG-11", () => {
  const co2 = (state, id) => ({
    state,
    deviceClass: { value: "carbon_dioxide" },
    unit: { value: "ppm" },
    ...(id ? { id } : {}),
  });
  const shared = co2(1600, "sensor.avg");
  const ignored = { id: "sensor.foreign", state: 22, deviceClass: { value: "temperature" }, unit: { value: "°C" } };

  const captionOf = (rooms) => {
    const built = buildScenario({ metric: "co2", primary: co2(800), rooms });
    let caption;
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      caption = { label: model.average.label, value: model.average.value, source: model.average.source };
    });
    return caption;
  };

  const alone = captionOf([shared]);
  const withIgnored = captionOf([shared, ignored]);
  assert.equal(withIgnored.value, alone.value, "the reading is the same either way");
  assert.equal(
    withIgnored.label,
    alone.label,
    `a room the card ignores changed the headline from "${alone.label}" to "${withIgnored.label}"`
  );
});

test("BUG-11's neighbourhood: with two distinct sensors the caption does not move", () => {
  // The ordinary configuration, where the primary entity and the rooms are different sensors.
  // Adding a room the card cannot use changes nothing at all — which is what makes the case
  // above a defect rather than a rule.
  const co2 = (state) => ({ state, deviceClass: { value: "carbon_dioxide" }, unit: { value: "ppm" } });
  const ignored = { id: "sensor.foreign", state: 22, deviceClass: { value: "temperature" }, unit: { value: "°C" } };
  const captionOf = (rooms) => {
    const built = buildScenario({ metric: "co2", primary: co2(800), rooms });
    let caption;
    env.withCard(built.config, built.hass, (card) => {
      const model = card._computeViewModel();
      caption = { label: model.average.label, value: model.average.value };
    });
    return caption;
  };
  assert.deepEqual(captionOf([co2(1600), ignored]), captionOf([co2(1600)]));
});

test("BUG-09's neighbourhood: the same mistake one level down IS refused by name", () => {
  const built = buildScenario({ rooms: [{}] });
  assert.throws(
    () => env.withCard({ ...built.config, palette: { optimal: "#3D9970", nonsense: 1 } }, built.hass, () => {}),
    /nonsense/,
    "a nested unknown key is named in the error, which is what the top level should also do"
  );
});

test("BUG-08's neighbourhood: the other three metrics do reject their impossible readings", () => {
  const impossible = [
    ["humidity", -1],
    ["humidity", 101],
    ["humidity", 800],
    ["co2", 0],
    ["co2", -500],
    ["pm25", -1],
  ];
  for (const [metric, value] of impossible) {
    const built = buildScenario({ metric, primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${metric} ${value} should be rejected`);
    });
  }
});
