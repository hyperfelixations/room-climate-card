"use strict";

// One reproduction per open entry in the known-defect register (test/known-issues.js), plus
// the checks that keep the register honest. Each reproduction asserts the behaviour the card
// should have, so a fix flips it to passing and expectedFailure() turns that into a failing
// run demanding the entry be retired. Fixed BUG-07..BUG-14 stay here as ordinary regression
// tests; their history is in the RCC Changelog.

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

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
  // Partitioning is per violation, not per case: a matching violation must not absorb an
  // unrelated one from the same generated case.
  const known = "everyNumberIsFinite: scale.markerPositions.average is NaN";
  const unrelated = ["active view is unavailable", "rooms lost when only the primary went unavailable: sensor.room0"];
  const classified = classifyViolations([known, ...unrelated]);
  assert.deepEqual(classified.known.map(({ issue, violation }) => [issue.id, violation]), [["BUG-06", known]]);
  assert.deepEqual(classified.unknown, unrelated);
});

test("a defect that was fixed no longer absorbs its old signature", () => {
  // The exact violation strings BUG-07, BUG-11 and BUG-12 were recognised by while open.
  // With those entries gone, each must now come through as unknown, not be filed under a
  // defect that no longer exists.
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
  // Both of BUG-06's symptoms plus a third string that only resembles them; order and count
  // are asserted so an over-broad matcher shows up here.
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
  // A registered entry with no expectedFailure() here would be a note wearing a test's
  // clothes.
  const source = require("node:fs").readFileSync(__filename, "utf8");
  for (const issue of KNOWN_ISSUES) {
    assert.ok(
      source.includes(`expectedFailure("${issue.id}"`),
      `${issue.id} is registered but has no expectedFailure() reproduction here`
    );
  }
});

// ------------------------------------------------------------ reproductions --

// BUG-06 (open). A custom profile whose declared scale spans both extremes (±1e308) gives a
// span that overflows to Infinity; a derived position becomes NaN and reaches the DOM as
// `calc(NaN% + 0px)` (dropped in a browser, a hard throw under jsdom). Expected: an
// unusable computed span reaches the no-data state, like any unusable reading. Full analysis
// in RCC Backlog BUG-06.
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

// The neighbouring span that fits in a double: records the boundary, must keep passing.
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
  // The route the defect was found on, closed by the metric physical floors. Recorded so a
  // metric added without a floor is known to reopen it.
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e308 }, { state: -273.15 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML));
  });
});

// BUG-07 regression: a °F reading whose conversion to Celsius overflows is not a reading;
// the card refuses it and, with no other source, lands in no-data. The overflow is specific
// to the scaling path — the next test holds that °C and K at the same magnitude come
// through as ordinary numbers.
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

// BUG-11 regression: finite room readings whose intermediate sum overflows still average to
// their true finite mean (the aggregate divides before it would overflow).
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
  // The case the scaled mean exists for: summing first gives Infinity - Infinity = NaN,
  // dividing by the larger magnitude first gives the expected 0.
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

// BUG-08 regression: a temperature below absolute zero is refused like any impossible
// reading. The three values straddle the limit from just past it to absurdly past.
test("a temperature below absolute zero is refused rather than drawn", () => {
  for (const value of [-273.16, -274, -1000]) {
    const built = buildScenario({ metric: "temperature", primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${value} °C is below absolute zero`);
    });
  }
});

// BUG-09 regression: a misspelled top-level config key is named in a console warning (not
// refused — an inapplicable option is cosmetic, a card that stops loading is not). The
// stricter nested behaviour is asserted below.
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
  // Home Assistant and card-mod attach their own bookkeeping to every card; warning about
  // it would be a false alarm on an ordinary dashboard.
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

// BUG-10 regression. Trigger needs both halves: rooms that disagree about what they measure,
// and a primary whose state cannot be read. The primary's device_class outlives the outage
// and says which kind is the card's, so the rooms of that kind carry it.
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

// BUG-12 regression: a room the card can never use must not change the headline's source,
// caption or tap target. The two extra rooms are different kinds of "not a source":
// `sensor.room1` does not exist at all; `sensor.foreign` exists but reports temperature on a
// humidity card.
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
  // Caption and number too: the caption is what moved, the number is what stayed put.
  assert.equal(after.label, before.label);
  assert.equal(after.value, before.value);
});

test("the other half of that: a room that does not exist at all is ignored too", () => {
  // The half that always behaved correctly: a configured room Home Assistant has never heard
  // of leaves the card's identity alone.
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

// BUG-13 regression: a reading that matches no tier empties the card instead of throwing.
// This case reaches the first of two guards — the reading is refused at the BUG-07
// Fahrenheit conversion before it classifies. The second guard (the classifier no longer
// needing a tier to exist) is asserted in unit/domain/domain-services-modules.test.js.
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
  // The boundary: `>=` admits -Infinity into the open-ended tier, `>` does not. The reading
  // is refused earlier either way now, so both profiles agree.
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

// BUG-14 regression. resolveOptimalLabelPosition() centres the optimal-band label on its
// band, clamped between the min/max edge labels. When a huge reading makes the max edge
// label wide and no non-overlapping slot is left, the fallback caps the label to the free
// span between the edge labels and fills it gap-clear, truncating in place — it must not
// detach at bar centre or collapse to width 0. Widths below are measured from Chromium; the
// browser-side check is test/browser/geometry/optimal-label-anchored-huge-reading.spec.js.

// long === short so resolveLabelForm() measures exactly once; center ≈ 0 is the
// optimal band (20–24) on an axis of [10, reading + 1], checked against buildScaleAxis().
const OPTIMAL_LABEL_CONTENT = {
  optimalLabel: { long: "20–24 °C optimal", short: "20–24 °C optimal", center: 6e-5, visible: true },
};
const OPTIMAL_LABEL_GAP_PX = 4; // LABEL_GAP_PX

function buildOptimalLabelContainer({ barWidth, minWidth, centerWidth, maxWidth }) {
  const container = new JSDOM("<!doctype html><div id='c'></div>").window.document.getElementById("c");
  container.innerHTML =
    '<div class="rtc-scale-bar"></div>' +
    '<div class="rtc-scale-labels">' +
    '<span class="rtc-scale-label-min">10 °C</span>' +
    '<span class="rtc-scale-label-center">20–24 °C optimal</span>' +
    '<span class="rtc-scale-label-max">200,000,001 °C</span>' +
    "</div>";
  const stub = (selector, width) => {
    const el = container.querySelector(selector);
    el.getBoundingClientRect = () => ({ width, height: 12, top: 0, left: 0, right: width, bottom: 12, x: 0, y: 0 });
    return el;
  };
  stub(".rtc-scale-bar", barWidth);
  stub(".rtc-scale-label-min", minWidth);
  stub(".rtc-scale-label-max", maxWidth);
  return { container, centerEl: stub(".rtc-scale-label-center", centerWidth) };
}

test("a huge reading keeps the optimal label in the free span, not detached at the bar centre", async () => {
  const { resolveOptimalLabelPosition } = await import("../src/render/layout/optimal-label.js");
  // bar 145, min 22, center 76, max 76 -> lowLimit 64 > highLimit 27: no natural slot.
  const barWidth = 145;
  const minWidth = 22;
  const maxWidth = 76;
  const { container, centerEl } = buildOptimalLabelContainer({ barWidth, minWidth, centerWidth: 76, maxWidth });

  resolveOptimalLabelPosition(container, OPTIMAL_LABEL_CONTENT);

  const left = Number.parseFloat(centerEl.style.left);
  const spanWidth = barWidth - minWidth - maxWidth - 2 * OPTIMAL_LABEL_GAP_PX; // 39: the free room between the edge labels
  assert.equal(
    centerEl.style.maxWidth,
    `${spanWidth}px`,
    "the label is capped to the free span — neither collapsed to 0 nor left at its natural width"
  );
  assert.ok(
    Math.abs(left - (minWidth + OPTIMAL_LABEL_GAP_PX + spanWidth / 2)) < 1e-9,
    `left=${left}px should fill the span from the min label, not sit at bar centre ${barWidth / 2}px`
  );
  assert.ok(left < barWidth / 2, `left=${left}px must stay on the band's (left) side of the bar centre`);
  assert.ok(left - spanWidth / 2 >= minWidth + OPTIMAL_LABEL_GAP_PX - 1e-9, "left edge stays gap-clear of the min label");
  assert.ok(
    left + spanWidth / 2 <= barWidth - maxWidth - OPTIMAL_LABEL_GAP_PX + 1e-9,
    "right edge stays gap-clear of the max label"
  );
});

test("with room for the label it still centres on its band, pinned to the near edge", async () => {
  // Wider card: a non-overlapping slot exists, so the fits branch clamps the band-at-0%
  // label to lowLimit — pinned left, full width, no cap. The standard path, untouched by
  // the fallback change.
  const { resolveOptimalLabelPosition } = await import("../src/render/layout/optimal-label.js");
  const minWidth = 22;
  const centerWidth = 76;
  const { container, centerEl } = buildOptimalLabelContainer({ barWidth: 227, minWidth, centerWidth, maxWidth: 62 });

  resolveOptimalLabelPosition(container, OPTIMAL_LABEL_CONTENT);

  const left = Number.parseFloat(centerEl.style.left);
  const lowLimit = minWidth + OPTIMAL_LABEL_GAP_PX + centerWidth / 2;
  assert.ok(Math.abs(left - lowLimit) <= 1, `left=${left}px should be lowLimit≈${lowLimit}px`);
  assert.equal(centerEl.style.maxWidth, "", "no width cap when the label fits");
});
