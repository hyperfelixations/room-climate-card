"use strict";

// Which background the card is painted on, and what a palette does about it.
//
// The naive answer is `hass.themes.darkMode`, and it is wrong often enough to matter: it
// describes the THEME, not this card. card-mod and its relatives restyle individual
// cards, a user's own theme is classified nowhere, and a dashboard can put one card on a
// surface nothing else shares. So the card measures its own rendered background and only
// falls back to the theme flag when the browser will not answer.
//
// The adaptation itself is deliberately empty in this round — see
// transformPaletteForSurface(). What is tested here is everything AROUND it: the reading,
// the fallbacks, the derivation of what a palette was made for, and the decision. That is
// what has to be right before a transformation can be trusted to run at the right moment.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkHass, mkState } = require("../helpers/hass-fixtures.js");
const { contrastRatio: measuredContrast, LIGHT_CARD, DARK_CARD } = require("../helpers/color-measurement.js");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };

let env;
let surface;
let palettes;
let color;
let signatures;

test.before(async () => {
  env = createTestEnvironment();
  surface = await import("../../src/domain/classification/surface.js");
  palettes = await import("../../src/domain/classification/palettes/registry.js");
  color = await import("../../src/core/color.js");
  signatures = await import("../../src/controllers/render/render-signatures.js");
});
test.after(() => env.cleanupAll());

function card(overrides = {}, hass) {
  return env.createCard(
    { entity: "sensor.avg", ...overrides },
    hass || mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMP) })
  );
}

// ------------------------------------------------------- reading a colour ----

// getComputedStyle hands back `rgb()`/`rgba()` for a resolved background-color, but a
// custom property comes back exactly as the theme author wrote it — so hex and names have
// to be readable too.
test("a background is read in every form the CSSOM can hand back", () => {
  const cases = [
    ["rgb(255, 255, 255)", "light"],
    ["rgb(28, 28, 28)", "dark"],
    ["rgba(28, 28, 28, 1)", "dark"],
    ["rgb(28 28 28 / 0.9)", "dark", "the modern space-separated form"],
    ["  #1C1C1C  ", "dark", "a theme that wrote a hex"],
    ["#FFF", "light"],
    ["teal", "dark", "and one that wrote a name — teal really is a dark background"],
  ];
  for (const [value, expected, why] of cases) {
    assert.equal(surface.surfaceForBackgroundColor(value), expected, why || value);
  }
  // Nothing painted is not an answer: what shows through is whatever is behind it.
  for (const nothing of ["rgba(0, 0, 0, 0)", "transparent", "", "   ", "inherit", null, undefined, 5]) {
    assert.equal(surface.surfaceForBackgroundColor(nothing), null, JSON.stringify(nothing));
  }
});

// The split is derived, not chosen: black text on a background of luminance Y reaches
// (Y+0.05)/0.05 and white text reaches 1.05/(Y+0.05), and those cross at Y = 0.179. Above
// it dark text wins, below it light text does, which is exactly what "light" and "dark"
// mean for a surface.
test("the light/dark split sits where the two text colours change places", () => {
  assert.equal(surface.surfaceForLuminance(0.18), "light");
  assert.equal(surface.surfaceForLuminance(0.17), "dark");
  assert.equal(surface.surfaceForLuminance(0), "dark");
  assert.equal(surface.surfaceForLuminance(1), "light");
  assert.equal(surface.surfaceForLuminance(Number.NaN), "light", "an unreadable value is not a dark one");
});

test("the two card backgrounds land on the side they are named after", () => {
  assert.equal(surface.surfaceForBackground(surface.SURFACE_BACKGROUNDS.light), "light");
  assert.equal(surface.surfaceForBackground(surface.SURFACE_BACKGROUNDS.dark), "dark");
  assert.deepEqual(surface.SURFACES, ["light", "dark"]);
});

// The card's own contrast maths and the measuring instrument's are two implementations on
// purpose — an instrument that shared code with the thing it measures could not disagree
// with it. They still have to agree, and that is checkable.
test("the card measures contrast the same way the instrument does", () => {
  for (const hex of ["#FFFFFF", "#000000", "#7D7D7D", "#1DB85D", "#4B0082", "#FFFF00"]) {
    for (const background of [LIGHT_CARD, DARK_CARD]) {
      assert.ok(
        Math.abs(surface.contrastRatio(hex, background) - measuredContrast(hex, background)) < 1e-9,
        `${hex} on ${background}`
      );
    }
  }
});

// ------------------------------------------- what a colour was made for ----

// The supervisor's own example, and the reason this is derived rather than listed: yellow
// is a colour for dark dashboards and says so, without anyone maintaining a table.
test("a colour states which background it suits, measured from itself", () => {
  const { CSS_COLOR_NAMES } = color;
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.yellow), "dark");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.gold), "dark");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.white), "dark");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.darkblue), "light");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.navy), "light");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.black), "light");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.teal), "any");
  assert.equal(surface.tuningForColor(CSS_COLOR_NAMES.gray), "any");

  // The whole table, so the answer is always one of the three and the split is sane.
  const counts = { light: 0, dark: 0, any: 0 };
  for (const hex of Object.values(CSS_COLOR_NAMES)) {
    const tuning = surface.tuningForColor(hex);
    assert.ok(tuning in counts, `${hex} produced ${tuning}`);
    counts[tuning] += 1;
  }
  assert.equal(counts.light + counts.dark + counts.any, 148);
  assert.ok(counts.any > 40, "a fair share of colours really do work on both");
  assert.ok(counts.light > 10 && counts.dark > 10, "and both extremes are represented");
});

// A generated palette carries the answer with it, computed once while it is built rather
// than swept over the colour table on every render.
test("a generated palette states what its base colour suits", () => {
  assert.equal(palettes.paletteForColor("yellow").tunedFor, "dark");
  assert.equal(palettes.paletteForColor("navy").tunedFor, "light");
  assert.equal(palettes.paletteForColor("teal").tunedFor, "any");
  assert.equal(palettes.paletteForColor("#FFFF00").tunedFor, "dark", "a hex nobody could have listed");
});

// ------------------------------------------------------- the decision ----

test("a palette is adapted only when it does not suit the surface", () => {
  const anywhere = palettes.completePalette({ id: "a", optimal: "#111111", tunedFor: "any" });
  const forDark = palettes.completePalette({ id: "d", optimal: "#111111", tunedFor: "dark" });
  const forLight = palettes.completePalette({ id: "l", optimal: "#111111", tunedFor: "light" });

  for (const where of ["light", "dark"]) {
    assert.equal(palettes.adaptPaletteToSurface(anywhere, where), anywhere, `any on ${where} is untouched`);
  }
  assert.equal(palettes.adaptPaletteToSurface(forDark, "dark"), forDark);
  assert.equal(palettes.adaptPaletteToSurface(forLight, "light"), forLight);

  // The mismatched cases go through the transformation, which this round leaves as the
  // identity — so the card looks exactly as it did, and the goldens prove it.
  assert.equal(palettes.adaptPaletteToSurface(forDark, "light"), palettes.transformPaletteForSurface(forDark, "light"));
  assert.equal(palettes.adaptPaletteToSurface(forLight, "dark"), palettes.transformPaletteForSurface(forLight, "dark"));
  assert.deepEqual(palettes.transformPaletteForSurface(forDark, "light"), forDark);

  // Total, because it sits in the render path: a missing palette is not a crash.
  assert.equal(palettes.adaptPaletteToSurface(null, "light"), null);
});

// ------------------------------------------------------- through a card ----

// jsdom hands back a computed style that does not follow a later inline change, so each
// case gets its own card and reads once. That a LIVE change is followed is a question
// about a real CSSOM and is answered in test/browser/surface.spec.js.
function surfaceOf({ background = null, darkMode = undefined } = {}) {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMP) });
  if (darkMode !== undefined) hass.themes = { darkMode };
  const el = card({}, hass);
  if (background) el.shadowRoot.querySelector(".rtc-card").style.backgroundColor = background;
  const result = el._surface();
  env.cleanup(el);
  return result;
}

test("the card reads the background it is actually painted on", () => {
  // What card-mod does: a background set on the card itself, which no theme flag knows
  // about. The card follows the paint.
  assert.equal(surfaceOf({ background: "rgb(20, 20, 20)" }), "dark");
  assert.equal(surfaceOf({ background: "rgb(250, 250, 250)" }), "light");
});

test("the theme flag is the fallback, never the first answer", () => {
  // Nothing painted: hass decides, and Home Assistant's own default is a light theme.
  assert.equal(surfaceOf({}), "light");
  assert.equal(surfaceOf({ darkMode: true }), "dark");
  assert.equal(surfaceOf({ darkMode: false }), "light");

  // A painted background outranks it. A dark theme with one card styled light is a real
  // dashboard, and the card is what the user looks at.
  assert.equal(surfaceOf({ darkMode: true, background: "rgb(255, 255, 255)" }), "light");
  assert.equal(surfaceOf({ darkMode: false, background: "rgb(10, 10, 10)" }), "dark");
});

// A theme switch changes no entity and no configuration. Without the surface in the data
// signature the card would decide nothing had happened and keep the colours of the
// background it is no longer on.
test("the surface is part of what makes the card re-render", () => {
  const inputs = { config: { rooms: [], entity: null }, states: {}, language: "en", activeViewIndex: 0 };
  const onLight = signatures.entityDataSignature({ ...inputs, surface: "light" });
  const onDark = signatures.entityDataSignature({ ...inputs, surface: "dark" });
  assert.notEqual(onLight, onDark);
  assert.match(onLight, /surface:light/);
});
