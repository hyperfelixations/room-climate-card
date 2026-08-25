"use strict";

// WHETHER A PALETTE CAN BE SEEN ON THE BACKGROUND THE CARD IS PAINTED ON — the measurement,
// the reading of the background, and the seam that acts on the answer.
//
// This file replaces surface-detection.test.js, which tested a design that no longer
// exists: palettes used to DECLARE which of two canonical backgrounds they suited
// (`tunedFor`), and the card bucketed its own background into one of the two. Two buckets
// cannot describe a dark blue card-mod card, and a declaration can drift from the colours
// it describes. Both are now measured.
//
// The threshold is not asserted as a number anywhere here. It is asserted through the
// VERDICTS it has to produce, which live in test/fixtures/palette-fit-calibration.js with a
// reason on every row. That is deliberate: a number is not reviewable and a verdict is.
//
// This file is a UNIT test and imports src modules directly. How the card READS the
// background it is painted on is a question about the assembled element, and lives next
// door in test/component/rendering/background-reading.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { VISIBLE, INVISIBLE, BORDERLINE } = require("../../fixtures/palette-fit-calibration.js");

let fit;
let adaptation;
let palettes;
let color;
let oklch;

test.before(async () => {
  fit = await import("../../../src/domain/classification/palette-fit.js");
  adaptation = await import("../../../src/domain/classification/palettes/adaptation.js");
  palettes = await import("../../../src/domain/classification/palettes/registry.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
});

// A one-step palette, so a calibration pair can be judged as a palette without anything
// else in the ramp interfering.
const swatch = (hex) => palettes.completePalette({ id: "swatch", origin: "builtin", optimal: hex, invalid: hex });

// ======================================================== the calibration =====

test("every colour the table calls visible is judged visible", () => {
  for (const [colour, background, why] of VISIBLE) {
    const report = fit.evaluatePaletteFit(swatch(colour), [background]);
    assert.equal(report.fits, true, `${colour} on ${background} — ${why} (${report.worst.distance.toFixed(4)})`);
  }
});

test("every colour the table calls invisible is judged invisible", () => {
  for (const [colour, background, why] of INVISIBLE) {
    const report = fit.evaluatePaletteFit(swatch(colour), [background]);
    assert.equal(report.fits, false, `${colour} on ${background} — ${why} (${report.worst.distance.toFixed(4)})`);
  }
});

test("the two sides of the table do not overlap, and the threshold sits between them", () => {
  // The property that makes the threshold defensible at all: there is a gap, and the number
  // is inside it. If a future change to the instrument closes the gap, this fails before
  // any individual verdict does — which is the more useful place to find out.
  const distanceOf = ([colour, background]) => oklch.screenDistance(colour, background);
  const tightestVisible = Math.min(...VISIBLE.map(distanceOf));
  const widestInvisible = Math.max(...INVISIBLE.map(distanceOf));
  assert.ok(
    widestInvisible < tightestVisible,
    `the labelled sets overlap: invisible reaches ${widestInvisible.toFixed(4)}, visible starts at ${tightestVisible.toFixed(4)}`
  );
  assert.ok(
    fit.VISIBILITY_THRESHOLD > widestInvisible && fit.VISIBILITY_THRESHOLD < tightestVisible,
    `threshold ${fit.VISIBILITY_THRESHOLD} is outside the gap ${widestInvisible.toFixed(4)}..${tightestVisible.toFixed(4)}`
  );
});

test("the borderline cases are the ones nearest the line, and each is labelled", () => {
  // Keeps the list that gets rendered and looked at honest: a "borderline" pair that is
  // nowhere near the line is not worth a swatch, and one that is near the line and NOT on
  // the list would go unlooked-at.
  for (const [colour, background, verdict] of BORDERLINE) {
    const report = fit.evaluatePaletteFit(swatch(colour), [background]);
    assert.equal(report.fits, verdict === "visible", `${colour} on ${background} should be ${verdict}`);
  }
});

// ================================================== the shipped palettes =====

// The behaviour the supervisor asked for, stated as cases rather than as a threshold.
// "keep" means the card leaves the palette exactly as written.
const EXPECTATIONS = [
  // The four shipped ramps, on the two backgrounds every dashboard actually uses.
  ["pastel", "#FFFFFF", "keep"],
  ["pastel", "#1C1C1C", "keep"],
  ["vivid", "#FFFFFF", "keep"],
  ["vivid", "#1C1C1C", "keep"],
  ["signal", "#FFFFFF", "keep"],
  ["signal", "#1C1C1C", "keep"],
  ["color-vision", "#FFFFFF", "keep"],
  ["color-vision", "#1C1C1C", "keep"],
  // And on backgrounds a card-mod user might actually pick.
  ["pastel", "#0A2A4F", "keep"],
  ["vivid", "#113322", "keep"],
  ["signal", "#FAFAFA", "keep"],
  // Mid grey is the one background no mid-light ramp survives, and saying so is correct
  // rather than over-eager: on #808080 these colours genuinely cannot be read.
  ["pastel", "#808080", "adapt"],
  ["vivid", "#808080", "adapt"],
];

test("the shipped palettes are left alone on every background a dashboard really uses", () => {
  for (const [id, background, expected] of EXPECTATIONS) {
    const report = fit.evaluatePaletteFit(palettes.paletteForName(id), [background]);
    assert.equal(
      report.fits ? "keep" : "adapt",
      expected,
      `${id} on ${background}: worst step ${report.worst.key} at ${report.worst.distance.toFixed(3)}`
    );
  }
});

test("a generated palette gives you the colour you asked for wherever it can be seen", () => {
  const cases = [
    ["yellow", "#1C1C1C", "keep", "yellow on a dark card is exactly what palette: yellow is for"],
    ["yellow", "#FFFFFF", "adapt", "its pale wing is invisible on white"],
    ["black", "#FFFFFF", "keep", "black on white"],
    ["black", "#1C1C1C", "adapt", "black on a near-black card"],
    ["navy", "#FFFFFF", "keep", "navy on white"],
    ["navy", "#1C1C1C", "adapt", "the dark-blue-on-dark-mode case"],
    ["white", "#1C1C1C", "keep", "white on a dark card"],
    ["white", "#FFFFFF", "adapt", "white on white"],
    ["teal", "#FFFFFF", "keep", "teal works on both"],
    ["teal", "#1C1C1C", "keep", "teal works on both"],
    ["gray", "#FFFFFF", "keep", "a grey ramp spans enough lightness to survive either"],
    ["gray", "#1C1C1C", "keep", "a grey ramp spans enough lightness to survive either"],
  ];
  for (const [name, background, expected, why] of cases) {
    const report = fit.evaluatePaletteFit(palettes.paletteForColor(name), [background]);
    assert.equal(
      report.fits ? "keep" : "adapt",
      expected,
      `${name} on ${background} — ${why} (worst ${report.worst.key} at ${report.worst.distance.toFixed(3)})`
    );
  }
});

test("a palette painted on its own colour always collides", () => {
  // The degenerate case, and a useful sanity check on the whole instrument: whatever the
  // threshold is, a colour is not visible on itself.
  for (const name of ["red", "teal", "yellow", "navy", "orange"]) {
    const palette = palettes.paletteForColor(name);
    const report = fit.evaluatePaletteFit(palette, [palette.optimal]);
    assert.equal(report.fits, false, name);
  }
});

// ================================================ what the finding says ======

test("the finding names which steps collide, not merely that some do", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForColor("yellow"), ["#FFFFFF"]);
  assert.equal(report.fits, false);
  assert.ok(report.steps.length > 1);
  for (const step of report.steps) {
    assert.match(step.key, /^(optimal|above:\d+|below:\d+)$/);
    assert.match(step.color, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(typeof step.nearest.distance, "number");
    assert.equal(step.fits, step.deficit === 0);
  }
  assert.ok(
    report.steps.some((step) => step.fits),
    "only part of a yellow ramp is invisible on white; a finding that condemned all of it would be wrong"
  );
});

test("the steps are reported in ramp order, outermost below to outermost above", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#FFFFFF"]);
  const keys = report.steps.map((step) => step.key);
  assert.equal(keys[0], "below:5", "the far end of below comes first");
  assert.equal(keys[5], "optimal", "the middle is in the middle");
  assert.equal(keys[keys.length - 1], "above:5", "and above runs out to the end");
});

test("a collision in the middle is reported as a middle region, not as a broken palette", () => {
  // The case that decides "change the whole ramp or only part of it": a blue-green-red ramp
  // on a green card reaches the background in the MIDDLE and is perfectly legible at both
  // ends. A finding that could not say that would force every method to move everything.
  const blueGreenRed = palettes.completePalette({
    id: "bgr",
    origin: "builtin",
    optimal: "#2E8B57",
    above: ["#B8A33A", "#D08A2E", "#D9532B", "#C62828"],
    below: ["#3FA9A0", "#3E8FC0", "#3D6FD0", "#3A4FD8"],
  });
  const onGreen = fit.evaluatePaletteFit(blueGreenRed, ["#2E8B57"]);
  assert.equal(onGreen.fits, false);
  assert.equal(onGreen.regions.length, 1);
  assert.equal(onGreen.regions[0].where, "middle");
  assert.ok(onGreen.regions[0].length < onGreen.steps.length, "a middle region cannot be the whole ramp");

  // And the same ramp on the backgrounds it was built for is not touched at all.
  for (const background of ["#FFFFFF", "#1C1C1C"]) {
    const report = fit.evaluatePaletteFit(blueGreenRed, [background]);
    assert.equal(report.fits, true, background);
    assert.deepEqual(report.regions, []);
  }
});

test("a collision at one end is reported as an end region", () => {
  const yellowOnWhite = fit.evaluatePaletteFit(palettes.paletteForColor("yellow"), ["#FFFFFF"]);
  assert.equal(yellowOnWhite.regions.length, 1);
  assert.equal(yellowOnWhite.regions[0].where, "start", "the pale wing is the start of the ramp");

  const blackOnDark = fit.evaluatePaletteFit(palettes.paletteForColor("black"), ["#1C1C1C"]);
  assert.equal(blackOnDark.regions[0].where, "end", "black itself is the far end of that ramp");
});

test("the invalid colour is judged, and judged separately from the ramp", () => {
  // It is painted, so it counts; it is not a point on the scale, so it is not part of any
  // region. A method that reshapes the ramp would otherwise leave it behind unnoticed.
  const onGrey = fit.evaluatePaletteFit(palettes.paletteForName("vivid"), ["#7D7D7D"]);
  assert.equal(onGrey.invalid.key, "invalid");
  assert.equal(onGrey.invalid.fits, false, "the shared neutral #7D7D7D cannot be seen on itself");
  for (const region of onGrey.regions) {
    assert.notEqual(region.from, "invalid");
    assert.notEqual(region.to, "invalid");
  }
});

test("the forbidden bands say which lightnesses are unusable, for a method to aim away from", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForColor("black"), ["#1C1C1C"]);
  assert.equal(report.lightness.forbidden.length, 1, "one background, one neighbourhood");
  const [band] = report.lightness.forbidden;
  assert.ok(band.min >= 0 && band.max <= 1);
  assert.ok(band.min < band.max);
  // #1C1C1C sits at Oklab L 0.226, so the unusable band has to contain it.
  const backgroundLightness = oklch.hexToOklch("#1C1C1C").lightness;
  assert.ok(
    band.min <= backgroundLightness && backgroundLightness <= band.max,
    `band ${band.min}..${band.max} does not contain the background at ${backgroundLightness}`
  );
  // And the room above it is where a method would rebuild the ramp.
  assert.ok(report.lightness.largestUsable.min >= band.max);
});

test("two far-apart samples forbid two separate bands, never one merged one", () => {
  // The defect this locks out: a single min/max over every sample says the WHOLE lightness
  // range is unusable as soon as the samples sit at both ends of it. Measured on a ramp that
  // reaches both ends over a white-to-black gradient, the merged answer was 0.000..1.000
  // while 0.40..0.83 was in fact free — so a method reading it would conclude there was
  // nowhere to move to and give up on a palette it could easily have rebuilt.
  const wide = palettes.completePalette({
    id: "w",
    origin: "builtin",
    optimal: "#808080",
    above: ["#B0B0B0", "#E8E8E8", "#FDFDFD"],
    below: ["#505050", "#181818", "#020202"],
  });
  const report = fit.evaluatePaletteFit(wide, ["#FFFFFF", "#000000"]);
  assert.equal(report.fits, false);

  assert.ok(Array.isArray(report.lightness.forbidden), "the forbidden set is a list of bands");
  assert.equal(report.lightness.forbidden.length, 2, "one band per end, not one spanning everything");
  for (const band of report.lightness.forbidden) {
    assert.ok(band.min <= band.max);
    assert.ok(band.max - band.min < 0.5, `a band covering ${(band.max - band.min).toFixed(2)} of the range is the merge bug`);
  }

  // And the complement is what a method actually needs: somewhere to aim.
  assert.ok(report.lightness.usable.length >= 1, "there is room between the two bands");
  const largest = report.lightness.largestUsable;
  assert.ok(largest && largest.max - largest.min > 0.3, JSON.stringify(largest));
  // Independently probed: a neutral colour is visible against both ends between 0.40 and 0.83.
  assert.ok(largest.min < 0.45 && largest.max > 0.78, JSON.stringify(largest));
});

test("a gradient containing every lightness leaves nowhere to go, and says so", () => {
  // The honest opposite: when the forbidden bands really do cover the range, `usable` is
  // empty. A method may then answer "not achievable" instead of inventing a ramp.
  const wide = palettes.completePalette({
    id: "w",
    origin: "builtin",
    optimal: "#808080",
    above: ["#B0B0B0"],
    below: ["#505050"],
  });
  const everyLightness = Array.from({ length: 11 }, (_, index) => {
    const channel = Math.round((index / 10) * 255).toString(16).padStart(2, "0");
    return `#${channel}${channel}${channel}`;
  });
  const report = fit.evaluatePaletteFit(wide, everyLightness);
  assert.equal(report.fits, false);
  assert.deepEqual(report.lightness.usable, [], "nothing is left, and the report says nothing is left");
  assert.equal(report.lightness.largestUsable, null);
});

test("a palette that fits reports no regions and forbids nothing", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#1C1C1C"]);
  assert.equal(report.fits, true);
  assert.deepEqual(report.regions, []);
  assert.deepEqual(report.lightness.forbidden, [], "nothing is in the way");
  assert.deepEqual(report.lightness.usable, [{ min: 0, max: 1 }], "so everything is available");
});

test("with nothing to measure against, nothing is claimed", () => {
  for (const samples of [[], null, undefined]) {
    const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), samples);
    assert.equal(report.fits, true, "no background means no reason to change the user's palette");
    assert.deepEqual(report.steps, []);
  }
});

// ================================================ several samples ============

test("a palette has to survive every sample, not merely the first", () => {
  const black = palettes.paletteForColor("black");
  assert.equal(fit.evaluatePaletteFit(black, ["#FFFFFF"]).fits, true);
  assert.equal(fit.evaluatePaletteFit(black, ["#1C1C1C"]).fits, false);
  assert.equal(
    fit.evaluatePaletteFit(black, ["#FFFFFF", "#1C1C1C"]).fits,
    false,
    "a gradient running from white to the dark card contains the collision"
  );
});

test("a gradient is sampled through its interior, not only at its stops", () => {
  // The trap: `linear-gradient(#FFF, #000)` has white and black at its ends and mid grey
  // through the middle, and mid grey is where every mid-light ramp dies. Reading only the
  // stops would have called that gradient harmless.
  const samples = color.gradientSamples("linear-gradient(rgb(255,255,255), rgb(0,0,0))");
  assert.ok(samples.length > 2, `only ${samples.length} samples — the interior is not being read`);
  assert.equal(
    fit.evaluatePaletteFit(palettes.paletteForName("pastel"), samples).fits,
    false,
    "pastel is unreadable somewhere over a white-to-black gradient"
  );
});

// ================================================ the origin gate ============

test("the card adapts palettes it built itself and never one written out in YAML", () => {
  // A written-out palette is a series of decisions somebody typed. Quietly moving those
  // colours would overrule a person who was perfectly explicit, so the card does not.
  const written = palettes.completePalette({
    id: "custom",
    optimal: "#000000",
    above: ["#0C0C0C"],
    below: ["#161616"],
  });
  assert.equal(written.origin, "custom");
  assert.equal(fit.evaluatePaletteFit(written, ["#1C1C1C"]).fits, false, "it really is unreadable");
  assert.equal(adaptation.isAdaptable(written), false);
  assert.equal(adaptation.adaptPalette(written, ["#1C1C1C"]), written, "and it is handed back untouched anyway");

  for (const palette of [palettes.paletteForName("pastel"), palettes.paletteForColor("black")]) {
    assert.equal(adaptation.isAdaptable(palette), true, palette.id);
  }
});

test("naming a CSS colour after `palette:` is still an automated palette", () => {
  // The line is where the colours came from, not how they were spelled. `palette: deeppink`
  // names a COLOUR and asks the card to build a ramp; the same word inside a written-out
  // palette is a chosen step.
  const derived = palettes.paletteForColor("deeppink");
  assert.equal(derived.origin, "derived");
  assert.equal(adaptation.isAdaptable(derived), true);
});

// ================================================ the strategy contract ======

// Run against EVERY registered strategy, so a method added later inherits the whole
// contract without anyone remembering to write these again.
test("every registered strategy keeps a palette's shape, order, determinism and idempotence", async () => {
  const { ADAPTATION_STRATEGIES, adaptPalette } = adaptation;
  const subjects = [
    [palettes.paletteForColor("yellow"), ["#FFFFFF"]],
    [palettes.paletteForColor("black"), ["#1C1C1C"]],
    [palettes.paletteForName("pastel"), ["#808080"]],
    [palettes.paletteForName("vivid"), ["#FFFFFF"]],
  ];

  for (const strategyId of Object.keys(ADAPTATION_STRATEGIES)) {
    for (const [palette, background] of subjects) {
      const once = adaptPalette(palette, background, strategyId);

      // 1 — shape
      assert.equal(once.id, palette.id, `${strategyId}: id`);
      assert.equal(once.above.length, palette.above.length, `${strategyId}: above length`);
      assert.equal(once.below.length, palette.below.length, `${strategyId}: below length`);
      for (const hex of [once.optimal, ...once.above, ...once.below, once.invalid]) {
        assert.match(hex, /^#[0-9A-Fa-f]{3,8}$/, `${strategyId}: ${hex}`);
      }

      // 5 — determinism
      assert.deepEqual(adaptPalette(palette, background, strategyId), once, `${strategyId}: deterministic`);

      // 3 — idempotence
      assert.deepEqual(adaptPalette(once, background, strategyId), once, `${strategyId}: idempotent`);
    }

    // 3 — a palette that already fits is returned untouched, by identity and not just by
    // value: the cheapest possible proof that nothing was rebuilt.
    const fine = palettes.paletteForName("pastel");
    assert.equal(adaptPalette(fine, ["#1C1C1C"], strategyId), fine, `${strategyId}: a fitting palette is untouched`);
  }
});

test("an unknown strategy name falls back to the default rather than throwing", () => {
  const palette = palettes.paletteForColor("black");
  assert.deepEqual(
    adaptation.adaptPalette(palette, ["#1C1C1C"], "no-such-strategy"),
    adaptation.adaptPalette(palette, ["#1C1C1C"]),
    "a card must render even if something asked for a method that does not exist"
  );
});

test("the verdict changes exactly once as a background sweeps from white to black", () => {
  // Stability without hysteresis. The measurement is monotone in background lightness for a
  // fixed colour, so a background drifting across the threshold flips the answer once and
  // stays there — no state, no flapping, and nothing to tune.
  const palette = palettes.paletteForColor("black");
  let flips = 0;
  let previous = null;
  for (let step = 0; step <= 255; step += 1) {
    const channel = (255 - step).toString(16).padStart(2, "0");
    const verdict = fit.evaluatePaletteFit(palette, [`#${channel}${channel}${channel}`]).fits;
    if (previous !== null && verdict !== previous) flips += 1;
    previous = verdict;
  }
  assert.equal(flips, 1, `the verdict changed ${flips} times sweeping white to black`);
});
