"use strict";

// Whether a palette can be seen on the background the card is painted on: the measurement,
// and the seam (adaptation strategies) that acts on the verdict. The threshold is asserted
// not as a number but through the verdicts in test/fixtures/palette-fit-calibration.js,
// which carry a reason on every row.
// Boundary: a unit test importing src directly; how the assembled element reads its own
// background lives in test/component/rendering/background-reading.test.js.
// Rationale for the fit model: see interne Doku §5 „Ob eine Palette auf diesem Grund
// gesehen werden kann".

const test = require("node:test");
const assert = require("node:assert/strict");

const { VISIBLE, INVISIBLE, BORDERLINE } = require("../../fixtures/palette-fit-calibration.js");
// CIEDE2000, not the Oklab distance the card uses: measuring with the implementation's own
// instrument would only prove it agrees with itself.
const measure = require("../../helpers/color-measurement.js");

let fit;
let adaptation;
let palettes;
let color;
let oklch;
let paintRoles;

test.before(async () => {
  fit = await import("../../../src/domain/classification/palette-fit.js");
  adaptation = await import("../../../src/domain/classification/palettes/adaptation.js");
  palettes = await import("../../../src/domain/classification/palettes/registry.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
  paintRoles = await import("../../../src/domain/classification/paint-roles.js");
});

// A one-step palette, so a calibration pair is judged without the rest of a ramp interfering.
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
  // What makes the threshold defensible: there is a gap between the labelled sets and the
  // number is inside it. A change to the instrument that closes the gap fails here first.
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
  // Keeps the rendered borderline list honest: a pair nowhere near the line is not worth a
  // swatch, and one near the line but off the list goes unlooked-at.
  for (const [colour, background, verdict] of BORDERLINE) {
    const report = fit.evaluatePaletteFit(swatch(colour), [background]);
    assert.equal(report.fits, verdict === "visible", `${colour} on ${background} should be ${verdict}`);
  }
});

// ================================================== the shipped palettes =====

// The intended behaviour stated as cases. "keep" means the card leaves the palette as written.
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
  // Mid grey is the one background no mid-light ramp survives: on #808080 these colours
  // genuinely cannot be read.
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
    ["teal", "#FFFFFF", "keep", "teal on white"],
    // A derived ramp has eleven steps; teal's deep wing needs more room below it than a
    // near-black card leaves, so its outermost deep step lands on #1C1C1C and is repaired.
    ["teal", "#1C1C1C", "adapt", "teal has to move a little on a near-black card"],
    ["gray", "#FFFFFF", "keep", "a grey ramp has room to spare above white"],
    // Same as teal: an eleven-step grey ramp reaches further down than the dark card leaves,
    // so a derived ramp is tuned to the card it is on rather than to both at once.
    ["gray", "#1C1C1C", "adapt", "and rather less below the dark one"],
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
  // The degenerate case: whatever the threshold, a colour is not visible on itself.
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
    assert.equal(typeof step.roles.accent.distance, "number");
    assert.equal(step.fits, step.roles.accent.fits && step.roles.marker.fits);
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
  // Decides "change the whole ramp or only part of it": a blue-green-red ramp on a green card
  // reaches the background in the middle and is legible at both ends.
  const blueGreenRed = palettes.completePalette({
    id: "bgr",
    origin: "builtin",
    optimal: "#2E8B57",
    above: ["#B8A33A", "#D08A2E", "#D9532B", "#C62828"],
    below: ["#3FA9A0", "#3E8FC0", "#3D6FD0", "#3A4FD8"],
  });
  const onGreen = fit.evaluatePaletteFit(blueGreenRed, ["#2E8B57"]);
  assert.equal(onGreen.fits, false);
  assert.equal(onGreen.regions.accent.length, 1);
  const [middle] = onGreen.regions.accent;
  assert.equal(middle.touchesStart, false, "the coldest end is still legible");
  assert.equal(middle.touchesEnd, false, "and so is the hottest");
  assert.ok(middle.length < onGreen.steps.length, "a middle region cannot be the whole ramp");
  assert.deepEqual(middle.keys.length, middle.length, "a region lists the steps it covers");

  // And the same ramp on the backgrounds it was built for is not touched at all.
  for (const background of ["#FFFFFF", "#1C1C1C"]) {
    const report = fit.evaluatePaletteFit(blueGreenRed, [background]);
    assert.equal(report.fits, true, background);
    assert.deepEqual(report.regions.accent, [], background);
    assert.deepEqual(report.regions.marker, [], background);
  }
});

test("a collision at one end is reported as touching that end", () => {
  const yellowOnWhite = fit.evaluatePaletteFit(palettes.paletteForColor("yellow"), ["#FFFFFF"]);
  assert.equal(yellowOnWhite.regions.accent.length, 1);
  assert.equal(yellowOnWhite.regions.accent[0].touchesStart, true, "the pale wing is the start of the ramp");
  assert.equal(yellowOnWhite.regions.accent[0].touchesEnd, false);

  const blackOnDark = fit.evaluatePaletteFit(palettes.paletteForColor("black"), ["#1C1C1C"]);
  assert.equal(blackOnDark.regions.accent[0].touchesEnd, true, "black itself is the far end of that ramp");
  assert.equal(blackOnDark.regions.accent[0].touchesStart, false);
});

test("a one-winged palette is not mislabelled: its middle is not its start", () => {
  // With no `below` wing, `optimal` is the ramp's first element, so a collision there
  // "touches the start" by array position; the report states that without interpreting it.
  const upwardsOnly = palettes.completePalette({
    id: "up",
    origin: "builtin",
    optimal: "#000000",
    above: ["#333333", "#666666"],
  });
  const report = fit.evaluatePaletteFit(upwardsOnly, ["#1C1C1C"]);
  assert.equal(report.fits, false);
  assert.equal(report.palette.counts.below, 0);
  assert.equal(report.palette.optimalIndex, 0, "with no below wing, optimal IS the first step");
  assert.equal(report.regions.accent[0].touchesStart, true);
  assert.deepEqual(
    [...new Set(report.failing.map((entry) => entry.key))],
    report.steps.filter((step) => !step.fits).map((step) => step.key),
    "`failing` is the same set, said plainly — one entry per role that fails"
  );
});

test("the report carries the palette's geometry, so a method need not recompute it", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#808080"]);
  assert.equal(report.palette.counts.total, 11);
  assert.equal(report.palette.optimalIndex, 5);
  assert.equal(report.palette.steps[0].wing, "below");
  assert.equal(report.palette.steps[0].offset, 5, "the far end of below is five steps from optimal");
  assert.equal(report.palette.steps[5].wing, "optimal");
  assert.equal(report.palette.steps[5].offset, 0);
  for (const step of report.steps) {
    assert.equal(typeof step.lightness, "number", `${step.key}: lightness`);
    assert.equal(typeof step.chroma, "number", `${step.key}: chroma`);
    for (const judged of Object.values(step.roles)) {
      assert.equal(judged.fits, judged.deficit === 0, `${step.key}/${judged.role}: deficit`);
      assert.ok(judged.fits ? judged.margin >= 0 : judged.margin === 0, `${step.key}/${judged.role}: margin`);
    }
  }
});

test("a passing step reports how much room it still has", () => {
  // A method that moves the whole ramp needs to know how far a passing step may go before it
  // breaks.
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#1C1C1C"]);
  assert.equal(report.fits, true);
  for (const step of report.steps) {
    for (const role of ["accent", "marker"]) {
      assert.ok(step.roles[role].margin > 0, `${step.key}/${role} fits, so it must report a positive margin`);
      assert.equal(step.roles[role].deficit, 0);
    }
  }
});

test("the invalid colour is judged, and judged separately from the ramp", () => {
  // It is painted, so it counts; it is not a point on the scale, so it is not part of any
  // region, and a method reshaping the ramp must not leave it behind.
  const onGrey = fit.evaluatePaletteFit(palettes.paletteForName("vivid"), ["#7D7D7D"]);
  assert.equal(onGrey.invalid.key, "invalid");
  assert.equal(onGrey.invalid.fits, false, "the shared neutral #7D7D7D cannot be seen on itself");
  for (const perRole of Object.values(onGrey.regions)) {
    for (const region of perRole) {
      assert.notEqual(region.from, "invalid");
      assert.notEqual(region.to, "invalid");
    }
  }
  // It is still named where a method would look for it.
  assert.ok(onGrey.failing.some((entry) => entry.key === "invalid"));
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
  // The defect this locks out: a single min/max over every sample calls the whole lightness
  // range unusable once samples sit at both ends of it, so a method reading it gives up on a
  // palette it could have rebuilt.
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
  // The opposite: when the forbidden bands really do cover the range, `usable` is empty and a
  // method may answer "not achievable" instead of inventing a ramp.
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

test("the whole report is cached on what it was computed from, and never served stale", () => {
  // The card asks this every render, and the answer costs hundreds of perceptual distances.
  // Each ingredient of the memo key is changed here and the answer must move with it.
  const { surfaceOf } = paintRoles;
  const pastel = palettes.paletteForName("pastel");
  const onDark = fit.evaluatePaletteFit(pastel, ["#1C1C1C"]);
  assert.equal(fit.evaluatePaletteFit(pastel, ["#1C1C1C"]), onDark, "the same question gives the same object back");

  // 1 — a different background.
  assert.notEqual(fit.evaluatePaletteFit(pastel, ["#808080"]).fits, onDark.fits);
  // 2 — a different text colour, background unchanged: the track moves, so a marker is
  // painted on something else.
  const light = (text) => fit.evaluatePaletteFit(pastel, surfaceOf(["#FFFFFF"], text));
  assert.notDeepEqual(
    light("#212121").steps.map((step) => step.roles.marker.background),
    light("#727272").steps.map((step) => step.roles.marker.background)
  );
  // 3 — a different palette under the same id (what a derived palette looks like when its
  // colours change). Object identity would miss this; the key is over the values.
  const one = palettes.completePalette({ id: "same", origin: "builtin", optimal: "#000000" });
  const other = palettes.completePalette({ id: "same", origin: "builtin", optimal: "#FFFFFF" });
  assert.equal(fit.evaluatePaletteFit(one, ["#1C1C1C"]).fits, false);
  assert.equal(fit.evaluatePaletteFit(other, ["#1C1C1C"]).fits, true, "same id, different colours, different answer");
  // 4 — a different threshold.
  assert.notEqual(
    fit.evaluatePaletteFit(pastel, ["#1C1C1C"], { threshold: 0.9 }).fits,
    fit.evaluatePaletteFit(pastel, ["#1C1C1C"]).fits
  );
  // 5 — and coming back gives the first answer again.
  assert.deepEqual(fit.evaluatePaletteFit(pastel, ["#1C1C1C"]).fits, onDark.fits);
});

test("a cached report cannot be altered by whoever received it", () => {
  // The same object is handed out next call, so a consumer sorting `failing` in place would
  // change what every later render is told.
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#808080"]);
  for (const list of [report.steps, report.failing, report.selfTintConflicts]) {
    assert.throws(
      () => {
        "use strict";
        list.push({});
      },
      TypeError,
      JSON.stringify(list.length)
    );
  }
  assert.throws(() => {
    "use strict";
    report.fits = true;
  }, TypeError);
});

test("the forbidden bands are cached on the background, and never served stale", () => {
  // The bands depend on the background alone, so they are memoized on it and must change when
  // it changes.
  const black = palettes.paletteForColor("black");
  const onDark = fit.evaluatePaletteFit(black, ["#1C1C1C"]);
  const onGrey = fit.evaluatePaletteFit(black, ["#808080"]);
  const onDarkAgain = fit.evaluatePaletteFit(black, ["#1C1C1C"]);

  assert.notDeepEqual(onDark.lightness.forbidden, onGrey.lightness.forbidden, "a different card forbids a different band");
  assert.deepEqual(onDarkAgain.lightness.forbidden, onDark.lightness.forbidden, "and coming back gives the first answer again");

  // Two palettes on one background share the answer, because it never depended on the palette.
  const white = palettes.paletteForColor("white");
  assert.deepEqual(
    fit.evaluatePaletteFit(white, ["#808080"]).lightness.forbidden,
    fit.evaluatePaletteFit(black, ["#808080"]).lightness.forbidden
  );
});

test("a cached band cannot be altered by whoever received it", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForColor("black"), ["#1C1C1C"]);
  const [band] = report.lightness.forbidden;
  assert.throws(() => {
    "use strict";
    band.min = 0.5;
  }, TypeError);
});

test("a palette that fits reports no regions and forbids nothing", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), ["#1C1C1C"]);
  assert.equal(report.fits, true);
  for (const [role, perRole] of Object.entries(report.regions)) assert.deepEqual(perRole, [], role);
  assert.deepEqual(report.failing, []);
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
  // A written-out palette is a series of decisions somebody typed; the card does not move
  // those colours.
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
  // What matters is where the colours came from: `palette: deeppink` names a colour and asks
  // the card to build a ramp, so the ramp is adaptable.
  const derived = palettes.paletteForColor("deeppink");
  assert.equal(derived.origin, "derived");
  assert.equal(adaptation.isAdaptable(derived), true);
});

// ================================================ the strategy contract ======

// Everything an adaptation strategy owes, run against every registered one. The subjects
// cover the shapes that break things: a wing with nowhere paler to go, a ramp whose middle is
// the card's colour, a hand-designed ramp that must move as a whole, an interpolated ramp,
// and a one-winged ramp.
const SUBJECTS = () => [
  ["yellow on white", palettes.paletteForColor("yellow"), ["#FFFFFF"]],
  ["black on the dark card", palettes.paletteForColor("black"), ["#1C1C1C"]],
  ["white on white", palettes.paletteForColor("white"), ["#FFFFFF"]],
  ["teal on mid grey", palettes.paletteForColor("teal"), ["#808080"]],
  ["pastel on mid grey", palettes.paletteForName("pastel"), ["#808080"]],
  ["vivid on salmon", palettes.paletteForName("vivid"), ["#FA8072"]],
  ["color-vision on mid grey", palettes.paletteForName("color-vision"), ["#808080"]],
  ["signal on mid yellow", palettes.paletteForName("signal"), ["#C8B400"]],
  ["blue-green-red on mid grey", palettes.paletteForGradient("blue-green-red"), ["#808080"]],
  ["a one-winged ramp on the dark card", palettes.completePalette({ id: "up", origin: "builtin", optimal: "#000000", above: ["#333333", "#666666"] }), ["#1C1C1C"]],
];

const rampOf = (palette) => [...palette.below].reverse().concat([palette.optimal], palette.above);

test("every registered strategy keeps a palette's shape, determinism and idempotence", () => {
  const { ADAPTATION_STRATEGIES, adaptPalette } = adaptation;

  for (const strategyId of Object.keys(ADAPTATION_STRATEGIES)) {
    for (const [why, palette, background] of SUBJECTS()) {
      const once = adaptPalette(palette, background, strategyId);
      const label = strategyId + ", " + why;

      // 1 — shape: the id survives (documentation, diagnostics and golden screenshots name a
      // palette by it), a wing that carried steps still does, and every colour is still a colour.
      assert.equal(once.id, palette.id, label + ": id");
      assert.equal(once.below.length > 0, palette.below.length > 0, label + ": below is still a wing");
      assert.equal(once.above.length > 0, palette.above.length > 0, label + ": above is still a wing");
      for (const hex of [once.optimal, ...once.above, ...once.below, once.invalid]) {
        assert.match(hex, /^#[0-9A-Fa-f]{6}$/, label + ": " + hex);
      }

      // 2 — determinism.
      assert.deepEqual(adaptPalette(palette, background, strategyId), once, label + ": deterministic");

      // 3 — idempotence: applying it again changes nothing, so the result is a fixed point.
      assert.deepEqual(adaptPalette(once, background, strategyId), once, label + ": idempotent");
    }

    // 4 — a palette that already fits is returned untouched by identity, not merely by value.
    const fine = palettes.paletteForName("pastel");
    assert.equal(adaptPalette(fine, ["#1C1C1C"], strategyId), fine, strategyId + ": a fitting palette is untouched");
  }
});

// The tightest neighbour pair the card already ships, in CIEDE2000: `palette: black` puts
// #0C0C0C beside #000000 and reads 1.9. No repair may produce anything tighter.
const TIGHTEST_SHIPPED = 1.9;

test("every registered strategy leaves every pair of steps distinguishable", () => {
  // Stops a repair from buying contrast against the card and paying for it between the steps.
  // Measured with CIEDE2000 — neither the Oklab distance the generators use nor the screen
  // distance the repair checks with. An absolute floor only: a moved ramp compresses (a
  // relative floor would claim a property the card does not have), so all that can be
  // promised is that no pair ends up tighter than one the card already ships.
  const { ADAPTATION_STRATEGIES, adaptPalette } = adaptation;
  for (const strategyId of Object.keys(ADAPTATION_STRATEGIES)) {
    for (const [why, palette, background] of SUBJECTS()) {
      const adapted = adaptPalette(palette, background, strategyId);
      const before = measure.smallestNeighbourStep(rampOf(palette));
      const after = measure.smallestNeighbourStep(rampOf(adapted));
      const label = strategyId + ", " + why + ": the tightest pair went from " + before.toFixed(2) + " to " + after.toFixed(2);
      assert.ok(after >= Math.min(before, TIGHTEST_SHIPPED) - 0.001, label);
    }
  }
});

test("no repair leaves a pair of steps tighter than the palette already had them", () => {
  // The measured claim behind the bar above, over every palette and background the card can
  // really meet rather than the ten subjects. "Not worse" rather than a fixed floor: some
  // ramps arrive already degenerate (`palette: black` has nothing deeper than black), and a
  // repair that leaves such a wing as it was has taken nothing away.
  const palettes3 = [
    ...["pastel", "vivid", "color-vision", "signal"].map((id) => palettes.paletteForName(id)),
    ...["yellow", "lime", "teal", "navy", "black", "white", "snow", "gray", "gold", "orange", "cyan"].map((name) =>
      palettes.paletteForColor(name)
    ),
    ...["blue-red", "blue-green-red", "teal-orange"].map((spelling) => palettes.paletteForGradient(spelling)),
  ];
  const backgrounds = [["#FFFFFF"], ["#1C1C1C"], ["#808080"], ["#C8B400"], ["#ADD8E6"], ["#FA8072"], ["#0A2A4F"], ["#113322"], ["#2A1B3D"], ["#000000"]];
  let checked = 0;
  let worst = { loss: -Infinity };
  for (const palette of palettes3) {
    for (const background of backgrounds) {
      if (fit.evaluatePaletteFit(palette, background).fits) continue;
      const adapted = adaptation.adaptPalette(palette, background);
      const before = measure.smallestNeighbourStep(rampOf(palette));
      const after = measure.smallestNeighbourStep(rampOf(adapted));
      const bar = Math.min(before, TIGHTEST_SHIPPED);
      if (bar - after > worst.loss) worst = { loss: bar - after, before, after, where: palette.id + " on " + background[0] };
      checked += 1;
    }
  }
  assert.ok(checked > 60, "only " + checked + " repairs were measured");
  assert.ok(
    worst.loss <= 0.001,
    worst.where + ": the tightest pair went from " + worst.before.toFixed(2) + " to " + worst.after.toFixed(2)
  );
});

test("every registered strategy either delivers a readable palette or says it cannot", () => {
  // The postcondition, written as a disjunction: `identity` never repairs anything and
  // satisfies this only by handing the user's own palette back. A method that claims to have
  // repaired something has to have repaired it.
  const { ADAPTATION_STRATEGIES, adaptPalette } = adaptation;
  for (const strategyId of Object.keys(ADAPTATION_STRATEGIES)) {
    for (const [why, palette, background] of SUBJECTS()) {
      const adapted = adaptPalette(palette, background, strategyId);
      const repaired = adapted !== palette;
      if (!repaired) continue;
      assert.equal(
        fit.evaluatePaletteFit(adapted, background).fits,
        true,
        strategyId + ", " + why + ": it changed the palette and the result still cannot be read"
      );
    }
  }
});

test("the shipped method reaches every background a card can really have, and says so when it cannot", () => {
  // The coverage claim. The one case it does not reach has no answer: a background running
  // from white to black contains every lightness, and no fixed ramp is legible over all of it.
  const backgrounds = [
    ["white", ["#FFFFFF"]],
    ["the dark card", ["#1C1C1C"]],
    ["mid grey", ["#808080"]],
    ["mid yellow", ["#C8B400"]],
    ["light blue", ["#ADD8E6"]],
    ["salmon", ["#FA8072"]],
    ["a dark blue card-mod sheet", ["#0A2A4F"]],
    ["dark green", ["#113322"]],
    ["dark purple", ["#2A1B3D"]],
    ["pure black", ["#000000"]],
  ];
  const subjects = [
    ...["pastel", "vivid", "color-vision", "signal"].map((id) => [id, palettes.paletteForName(id)]),
    ...["yellow", "lime", "teal", "navy", "black", "white", "snow", "gray", "darkslategray", "gold", "deeppink", "orange", "cyan"].map(
      (name) => ["palette: " + name, palettes.paletteForColor(name)]
    ),
    ...["blue-red", "blue-green-red", "teal-orange"].map((spelling) => ["palette: " + spelling, palettes.paletteForGradient(spelling)]),
  ];

  // The three it cannot reach: a grey ramp on a mid grey card must fit eleven steps into the
  // lightness left once the background's neighbourhood is removed, and there is not enough on
  // either side. The card keeps what the user asked for.
  const OUT_OF_REACH = new Set([
    "palette: teal on mid grey",
    "palette: gray on mid grey",
    "palette: darkslategray on mid grey",
  ]);

  let repaired = 0;
  for (const [label, palette] of subjects) {
    for (const [where, background] of backgrounds) {
      if (fit.evaluatePaletteFit(palette, background).fits) continue;
      const adapted = adaptation.adaptPalette(palette, background);
      if (OUT_OF_REACH.has(label + " on " + where)) {
        assert.equal(adapted, palette, label + " on " + where + ": expected to be out of reach");
        continue;
      }
      assert.notEqual(adapted, palette, label + " on " + where + ": nothing was done about it");
      assert.equal(fit.evaluatePaletteFit(adapted, background).fits, true, label + " on " + where);
      repaired += 1;
    }
  }
  // A floor, not an equality: a palette that starts fitting somewhere is not a regression,
  // but a drop to a handful would mean this test had stopped exercising the method.
  assert.ok(repaired >= 70, "only " + repaired + " palettes needed repairing, so this is not exercising much");
});

test("nothing the golden suite renders is touched on either theme", () => {
  // The pixel guarantee, checkable in a millisecond instead of a browser: every palette the
  // visual suite renders, on both shipped backgrounds, comes back by identity, so the golden
  // images cannot move. "Leaves a fitting palette alone" vs "rebuilds it to the same colours"
  // is invisible in a screenshot and visible in a diff, so it is pinned here.
  const rendered = [
    ...["pastel", "vivid", "color-vision", "signal"].map((id) => [id, palettes.paletteForName(id)]),
    ["palette: blue", palettes.paletteForColor("blue")],
    ["palette: blue-red", palettes.paletteForGradient("blue-red")],
    ["palette: blue-green-red", palettes.paletteForGradient("blue-green-red")],
    // A written-out single-colour palette is `custom` and never touched at all.
    ["a palette written out in YAML", palettes.completePalette({ optimal: "#1DB85D" })],
  ];
  // The one that is touched: `palette: blue` has eleven steps and its deep wing reaches
  // further down than a near-black card leaves, so on the dark theme the card tunes it. On
  // the light theme nothing moves.
  const TUNED = new Set(["palette: blue on the dark theme"]);

  for (const [label, palette] of rendered) {
    for (const [theme, surface] of [
      ["the light theme", paintRoles.surfaceOf(["#FFFFFF"], "#212121")],
      ["the dark theme", paintRoles.surfaceOf(["#1C1C1C"], "#E1E1E1")],
    ]) {
      const adapted = adaptation.adaptPalette(palette, surface);
      if (TUNED.has(label + " on " + theme)) {
        assert.notEqual(adapted, palette, label + " on " + theme + ": expected to be tuned");
        assert.equal(fit.evaluatePaletteFit(adapted, surface).fits, true, label + " on " + theme);
        continue;
      }
      assert.equal(adapted, palette, label + " on " + theme);
    }
  }
});

test("a background that contains every lightness has no answer, and the card keeps what it was given", () => {
  const everyLightness = Array.from({ length: 11 }, (_, index) => {
    const channel = Math.round((index / 10) * 255).toString(16).padStart(2, "0").toUpperCase();
    return "#" + channel + channel + channel;
  });
  for (const palette of [palettes.paletteForName("pastel"), palettes.paletteForColor("teal"), palettes.paletteForGradient("blue-red")]) {
    assert.equal(fit.evaluatePaletteFit(palette, everyLightness).fits, false, palette.id);
    assert.equal(
      adaptation.adaptPalette(palette, everyLightness),
      palette,
      palette.id + ": there is nothing to be done, so the user's own palette is what stays"
    );
  }
});

// ================================================ what the method promises ===

// One 8-bit channel step in Oklab lightness. Two colours closer than this are the same hex.
const QUANTISATION = 0.005;

test("a built-in ramp keeps the order it was written in", () => {
  // Pastel has no seed, so its finished steps are moved by a monotone map on lightness:
  // whatever the ramp said about which step is lighter than which, it still says.
  for (const id of ["pastel", "vivid", "color-vision", "signal"]) {
    for (const background of [["#808080"], ["#C8B400"], ["#FA8072"], ["#ADD8E6"]]) {
      const palette = palettes.paletteForName(id);
      if (fit.evaluatePaletteFit(palette, background).fits) continue;
      const adapted = adaptation.adaptPalette(palette, background);
      const before = rampOf(palette).map((hex) => oklch.hexToOklch(hex).lightness);
      const after = rampOf(adapted).map((hex) => oklch.hexToOklch(hex).lightness);
      assert.equal(before.length, after.length, id);
      for (let a = 0; a < before.length; a += 1) {
        for (let b = 0; b < before.length; b += 1) {
          // A pair whose lightnesses differ by less than an 8-bit channel had no order to
          // preserve (pastel's two coldest steps sit 0.001 apart); QUANTISATION is that
          // tolerance.
          if (before[a] >= before[b] - QUANTISATION) continue;
          assert.ok(
            after[a] <= after[b] + QUANTISATION,
            id + " on " + background[0] + ": step " + a + " was lighter than " + b + " and no longer is"
          );
        }
      }
    }
  }
});

test("a ramp derived from one colour is still that colour, to the hue", () => {
  // Every step of `palette: yellow` is yellow wherever the card puts it. Achromatic seeds are
  // exempt because their hue angle is rounding noise.
  for (const name of ["yellow", "lime", "teal", "navy", "gold", "deeppink", "orange", "cyan"]) {
    const palette = palettes.paletteForColor(name);
    const seedHue = oklch.hexToOklch(palette.source.color).hue;
    for (const background of [["#FFFFFF"], ["#1C1C1C"], ["#808080"], ["#C8B400"], ["#FA8072"]]) {
      if (fit.evaluatePaletteFit(palette, background).fits) continue;
      const adapted = adaptation.adaptPalette(palette, background);
      for (const hex of rampOf(adapted)) {
        const { chroma, hue } = oklch.hexToOklch(hex);
        if (chroma < 0.04) continue;
        const gap = Math.abs(hue - seedHue) % 360;
        assert.ok(
          Math.min(gap, 360 - gap) < 2,
          "palette: " + name + " on " + background[0] + ": " + hex + " is at hue " + hue.toFixed(1) + ", not " + seedHue.toFixed(1)
        );
      }
    }
  }
});

test("the named colour stays exactly itself while it can be seen, and moves the least it can when it cannot", () => {
  // Two cases. `palette: lime` on white has a middle visible on the card, so only the pale
  // wing is rebuilt. `palette: snow` on white does not, so it moves — in lightness, never to
  // another colour.
  const lime = palettes.paletteForColor("lime");
  assert.equal(fit.evaluatePaletteFit(lime, ["#FFFFFF"]).fits, false);
  assert.equal(
    adaptation.adaptPalette(lime, ["#FFFFFF"]).optimal,
    lime.optimal,
    "lime itself is legible on white, so the middle is left alone"
  );

  const snow = palettes.paletteForColor("snow");
  const adapted = adaptation.adaptPalette(snow, ["#FFFFFF"]);
  assert.notEqual(adapted.optimal, snow.optimal, "snow on white cannot stay snow");
  const was = oklch.hexToOklch(snow.optimal);
  const now = oklch.hexToOklch(adapted.optimal);
  assert.ok(now.lightness < was.lightness, "and it went darker: " + adapted.optimal);
  assert.ok(now.chroma < 0.04 && was.chroma < 0.04, "a near-white stays a near-neutral rather than acquiring a colour");
});

test("the invalid colour is carried along, and is not treated as part of the ramp", () => {
  // Painted, so a repair leaving it behind leaves the "no reading" colour unreadable; not on
  // the scale, so it has no neighbours to stay ordered with and is corrected on its own.
  const palette = palettes.paletteForName("pastel");
  const adapted = adaptation.adaptPalette(palette, ["#B4B2A9"]);
  assert.notEqual(adapted.invalid, palette.invalid, "the shared neutral cannot be seen on itself");
  assert.equal(fit.evaluatePaletteFit(adapted, ["#B4B2A9"]).invalid.fits, true);
});

test("the answer is memoized on the question, so a searching method is not paid for twice", () => {
  // A strategy searches (builds candidate ramps and measures them), leaving the palette-fit.js
  // memo holding the last candidate, not the card's starting palette; without a memo here
  // every render pays for the whole search again.
  const palette = palettes.paletteForColor("lime");
  const first = adaptation.adaptPalette(palette, ["#FFFFFF"]);
  assert.equal(adaptation.adaptPalette(palette, ["#FFFFFF"]), first, "the same question gives the same object back");

  // The key is over the VALUES, because a derived palette is rebuilt on every call and would
  // never hit an identity check.
  assert.equal(adaptation.adaptPalette(palettes.paletteForColor("lime"), ["#FFFFFF"]), first);

  // One slot, evicted by a second question: a card has one palette on one surface at a time
  // and asks the same question every render. The memo must never answer the wrong question,
  // so the answer changes when the background does and is right again on the way back.
  const elsewhere = adaptation.adaptPalette(palette, ["#1C1C1C"]);
  assert.notEqual(elsewhere, first, "a different background is a different question");
  assert.notDeepEqual(elsewhere, first, "and a different answer");
  assert.deepEqual(adaptation.adaptPalette(palette, ["#FFFFFF"]), first, "coming back gives the first answer again");
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
  // Stability without hysteresis: the measurement is monotone in background lightness for a
  // fixed colour, so a background crossing the threshold flips the answer once and stays there.
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
