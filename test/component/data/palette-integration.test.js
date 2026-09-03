"use strict";

// Palette integration: end-to-end colour selection across shipped, written, generated and
// profile-driven palettes. Owns configuration-to-ViewModel wiring through the assembled
// card; pure ramp generation, fitting and classification mapping stay direct domain-unit
// concerns.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { HUMIDITY } = require("../../fixtures/attributes.js");

let env;

test.before(async () => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function temperatureHass(value = 25.5, attributes = {}) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", value, {
      device_class: "temperature",
      unit_of_measurement: "°C",
      ...attributes,
    }),
  });
}

// ---------------------------------------------------------------- palettes --

// The palette option decides the colour; the profile decides where on the ramp a value sits.
function paletteCard(palette, value = 22) {
  return env.createCard({ entity: "sensor.avg", palette }, temperatureHass(value));
}

test("a card shows its configured palette's colour for the same reading", () => {
  const soft = paletteCard(undefined);
  const bold = paletteCard("vivid");
  const softColor = soft._computeViewModel().tone.color;
  const boldColor = bold._computeViewModel().tone.color;
  assert.equal(softColor, "#79A86C", "the default palette is the card's own ramp, unchanged");
  assert.notEqual(boldColor, softColor);
  assert.match(boldColor, /^#[0-9A-Fa-f]{6}$/);
  env.cleanup(soft);
  env.cleanup(bold);
});

test("a palette written out in YAML colours the card from its own ramp", () => {
  // Five colours per wing, matching the indoor profile's reach: a one-to-one mapping.
  const written = {
    below: ["#0B0B0B", "#0C0C0C", "#0D0D0D", "#0E0E0E", "#0F0F0F"],
    optimal: "#060606",
    above: ["#010101", "#020202", "#030303", "#040404", "#050505"],
  };
  const optimal = paletteCard(written, 22);
  assert.equal(optimal._computeViewModel().tone.color, "#060606", "22 °C is optimal for the indoor profile");
  env.cleanup(optimal);
  const warm = paletteCard(written, 23.5);
  assert.equal(warm._computeViewModel().tone.color, "#010101", "one step above optimal");
  env.cleanup(warm);
  const cold = paletteCard(written, 10);
  assert.equal(cold._computeViewModel().tone.color, "#0F0F0F", "as far below as the profile goes");
  env.cleanup(cold);
});

// A palette with less resolution than the profile is legitimate: fewer colours to distinguish.
test("a palette shorter than the profile collapses onto what it has", () => {
  const tiny = { below: ["#0000FF"], optimal: "#00FF00", above: ["#FF0000"] };
  for (const [value, expected] of [[30, "#FF0000"], [23.5, "#FF0000"], [22, "#00FF00"], [20.5, "#0000FF"], [10, "#0000FF"]]) {
    const card = paletteCard(tiny, value);
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }
});

test("an unknown palette name stops the card with a message naming the known ones", () => {
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", palette: "neon" }, temperatureHass()),
    /palette "neon" is neither a palette nor a color — the palettes are "pastel", "vivid", "color-vision", "protan-deutan", "protan", "deutan", "tritan", "signal"/
  );
});

// A single word: colour name vs palette name.
test("a colour name gives a ramp in that colour, and a palette name still wins", () => {
  const teal = env.createCard({ entity: "sensor.avg", palette: "teal" }, temperatureHass(22));
  // Monochrome palette: name a colour, get it. 22 °C is optimal, so the ramp's middle, #008080.
  assert.equal(teal._computeViewModel().tone.color, "#008080");
  env.cleanup(teal);

  const hex = env.createCard({ entity: "sensor.avg", palette: "#3366CC" }, temperatureHass(22));
  assert.match(hex._computeViewModel().tone.color, /^#[0-9A-F]{6}$/, "a hex base works the same way");
  env.cleanup(hex);

  const shipped = env.createCard({ entity: "sensor.avg", palette: "pastel" }, temperatureHass(22));
  assert.equal(shipped._computeViewModel().tone.color, "#79A86C");
  env.cleanup(shipped);
});

test("a custom profile without tier colours takes them from the palette", () => {
  const colourless = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 1, level: "Warm", zone: "outside" },
      { min: 20, score: 0, level: "Ok", zone: "optimal" },
      { default: true, score: -1, level: "Cold", zone: "outside" },
    ],
  };
  // Three tiers on an 11-colour ramp: the ends reach the ramp's ends, optimal its middle.
  for (const [value, expected] of [[25, "#B85F67"], [22, "#79A86C"], [10, "#8A88C9"]]) {
    const card = env.createCard({ entity: "sensor.avg", classification: colourless }, temperatureHass(value));
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }

  // And the same profile under the other palette moves with it.
  const bold = env.createCard({ entity: "sensor.avg", classification: colourless, palette: "vivid" }, temperatureHass(25));
  assert.equal(bold._computeViewModel().tone.color, "#CC2B2B");
  env.cleanup(bold);

  // A tier that names its own colour keeps it, whatever the palette is.
  const painted = env.createCard(
    {
      entity: "sensor.avg",
      palette: "vivid",
      classification: { ...colourless, tiers: colourless.tiers.map((tier) => ({ ...tier, color: "#ABCDEF" })) },
    },
    temperatureHass(22)
  );
  assert.equal(painted._computeViewModel().tone.color, "#ABCDEF");
  env.cleanup(painted);
});

test("entity mode without a value_color stays neutral, and never borrows a ramp colour", () => {
  const card = env.createCard(
    { entity: "sensor.avg", classification: "entity", palette: "vivid" },
    temperatureHass(22, { value_score: 1, value_level: "From the integration" })
  );
  assert.equal(card._computeViewModel().tone.color, "#7D7D7D");
  env.cleanup(card);
});

// A physically impossible reading never reaches the classifier from a rendered card: it is
// filtered upstream and shown as no data in either palette. The classifier's own invalid
// branch is covered in classification-palettes.test.js.
test("a physically impossible reading is no data, not a colour from the ramp", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 120, HUMIDITY),
  });
  for (const palette of [undefined, "vivid"]) {
    const card = env.createCard({ entity: "sensor.avg", palette }, hass);
    assert.equal(card._computeViewModel().tone.color, "#7F8792", String(palette));
    env.cleanup(card);
  }
});

// A profile reaching further than the palette needs no declaration: both anchor at optimal, wings scale.
test("a profile reaching further than the palette is spread across it", () => {
  const twenty = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 10, level: "Top", zone: "outside" },
      { min: 20, score: 0, level: "Middle", zone: "optimal" },
      { default: true, score: -10, level: "Bottom", zone: "outside" },
    ],
  };
  const cases = [[26, "#B85F67"], [22, "#79A86C"], [10, "#8A88C9"]];
  for (const [value, expected] of cases) {
    const card = env.createCard({ entity: "sensor.avg", classification: twenty }, temperatureHass(value));
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }
});

// A semantically broken ramp stops the card rather than rendering a misleading colour —
// a setConfig() error with the exact path, like any meaning-changing classification mistake.
test("a profile whose scores contradict its thresholds is refused by the card", () => {
  const broken = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 1, level: "Warm", zone: "outside" },
      { min: 20, score: 5, level: "Ok", zone: "optimal" },
      { default: true, score: -1, level: "Cold", zone: "outside" },
    ],
  };
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", classification: broken }, temperatureHass(22)),
    /classification\.tiers\[1\]\.score is 5, which is not below the 1 of classification\.tiers\[0\]/
  );

  // The same profile with a coherent ramp renders, and renders the middle colour.
  const fixed = { ...broken, tiers: [{ ...broken.tiers[0] }, { ...broken.tiers[1], score: 0 }, { ...broken.tiers[2] }] };
  const card = env.createCard({ entity: "sensor.avg", classification: fixed, palette: "pastel" }, temperatureHass(22));
  assert.equal(card._computeViewModel().tone.color, "#79A86C");
  env.cleanup(card);
});
