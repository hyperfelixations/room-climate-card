"use strict";

// WHERE A PALETTE COLOUR IS ACTUALLY PAINTED, and what that costs it.
//
// The measurement itself lives next door in palette-fit.test.js. This file is about the MAP
// that measurement uses: which elements paint with a palette colour, what each of them puts
// behind it, and how much separation each needs at its real size.
//
// THE CASE THAT MADE THIS NECESSARY is the lime group below. `palette: lime` on a light
// dashboard is legible as a ramp and unreadable as a status label, because the label paints
// the colour on a 20% tint of ITSELF. A check that only ever asked about the card background
// could not express that difference, and the wrong repair — moving lime's middle colour,
// which is fine where it is painted on the card — is exactly what it would have invited.
//
// THE NUMBERS WERE LOOKED AT. Each factor is bracketed by cards rendered at real size, and
// the cases are named in the comment beside it in src/domain/classification/paint-roles.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let roles;
let fit;
let palettes;
let color;
let oklch;

test.before(async () => {
  roles = await import("../../../src/domain/classification/paint-roles.js");
  fit = await import("../../../src/domain/classification/palette-fit.js");
  palettes = await import("../../../src/domain/classification/palettes/registry.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
});

const SRC = path.join(__dirname, "..", "..", "..", "src");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");

// A light dashboard as Home Assistant's own theme paints it.
const LIGHT = () => roles.surfaceOf(["#FFFFFF"], "#212121");
const byId = (id) => roles.PAINT_ROLES.find((role) => role.id === id);

// ============================================ the map matches the stylesheet =====

// Every palette-derived custom property the stylesheet paints with, and the role that
// answers for it. A property with no entry here is a place a palette colour lands that
// nothing is measuring, which is the failure this guard exists to prevent.
const PROPERTY_OWNERS = {
  "--tone-color": "accent, toneLabel and toneIcon",
  "--tone-soft": "the background of toneLabel and toneIcon",
  "--tone-band": "toneBand",
  "--marker-color": "marker",
  "--room-color": "chipMark",
  "--room-mark-bg": "the background of chipMark",
  "--room-bg": "the chip chipMark is painted over",
  // Deliberately unmeasured, each with its reason. A border is decorative: it outlines a
  // shape that is already there, carries no reading, and is painted at a HIGHER alpha than
  // the fill it surrounds, so it is the more visible half of its own element.
  "--tone-border": null,
  "--room-border": null,
  // The marker's halo, a tint of the marker's own colour lying between the bar and the
  // track — see the note on the marker role.
  "--marker-shadow": null,
};

test("every palette colour the stylesheet paints with is either measured or excused", () => {
  const stylesheets = fs.readdirSync(path.join(SRC, "styles")).filter((name) => name.endsWith(".js"));
  const used = new Set();
  for (const name of stylesheets) {
    for (const match of read(path.join("styles", name)).matchAll(/var\(--(?:tone|room|marker)-[a-z-]+\)/g)) {
      used.add(match[0].slice(4, -1));
    }
  }
  assert.ok(used.size > 0, "the scan found nothing, so it is not scanning");
  for (const property of used) {
    assert.ok(
      property in PROPERTY_OWNERS,
      `${property} is painted with a palette colour and no paint role answers for it — add a role, or list it here with the reason it needs none`
    );
  }
  for (const property of Object.keys(PROPERTY_OWNERS)) {
    assert.ok(used.has(property), `${property} is listed here but the stylesheet no longer paints with it`);
  }
});

test("the tint weights are the ones the card really applies", () => {
  // The roles composite these by hand, so a change at the source that did not reach here
  // would leave the measurement judging a background nothing paints. Read from the modules
  // that own them rather than restated.
  const alphaIn = (file, name) => {
    const match = read(file).match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
    assert.ok(match, `${name} not found in ${file}`);
    return Number(match[1]);
  };
  const { TINT_ALPHAS } = roles;
  assert.equal(TINT_ALPHAS.toneSoft, alphaIn("presentation/view-model/tone.js", "TONE_SOFT_ALPHA"));
  assert.equal(TINT_ALPHAS.toneBand, alphaIn("presentation/view-model/tone.js", "TONE_BAND_ALPHA"));
  assert.equal(TINT_ALPHAS.chipMark, alphaIn("presentation/view-model/room-layout.js", "CHIP_MARK_ALPHA"));
  assert.equal(TINT_ALPHAS.chipOutBackground, alphaIn("presentation/view-model/room-layout.js", "CHIP_OUT_BG_ALPHA"));
  assert.equal(TINT_ALPHAS.metricCardBackground, alphaIn("presentation/view-model/metric-card.js", "CARD_BG_ALPHA"));
  // These two are written as percentages in CSS rather than as constants.
  assert.match(read("styles/scale-bar.js"), new RegExp(`${TINT_ALPHAS.scaleTrackText * 100}%`));
  assert.match(read("styles/tokens.js"), new RegExp(`${TINT_ALPHAS.chipBackgroundText * 100}%`));
});

// ============================================ the two kinds of role ==============

test("a role is either painted on something it cannot influence, or on a tint of itself", () => {
  const { PAINT_ROLES, PALETTE_ROLES, SELF_TINTED_ROLES } = roles;
  assert.equal(PALETTE_ROLES.length + SELF_TINTED_ROLES.length, PAINT_ROLES.length, "every role is on exactly one side");
  assert.deepEqual(
    PALETTE_ROLES.map((role) => role.id),
    ["accent", "marker"]
  );

  // The distinction is not a label. For a palette role NEITHER side of the comparison is
  // derived from the colour, so moving the colour moves the separation at full leverage; for
  // a self-tinted role one of the two follows the colour, and some of that leverage is lost.
  //
  // Which side it is differs: the pill tints its BACKGROUND, the optimal band tints its
  // FOREGROUND and sits on the track. Both count, so both are checked.
  const point = roles.pointOf("#FFFFFF", "#212121");
  for (const role of PAINT_ROLES) {
    const derived = (colour) => [roles.foregroundFor(role, colour, point), ...roles.backgroundsFor(role, colour, point)];
    const one = derived("#2E8B57");
    const other = derived("#C62828");
    // Index 0 is the foreground and always differs; the question is whether anything else does.
    const followsColour = one.slice(1).some((value, index) => value !== other.slice(1)[index]) || one[0] !== "#2E8B57";
    assert.equal(followsColour, role.selfTinted === true, `${role.id}: selfTinted claims ${role.selfTinted === true}`);
  }
});

test("every role states what it is and needs a defensible amount of separation", () => {
  for (const role of roles.PAINT_ROLES) {
    assert.match(role.id, /^[a-zA-Z]+$/);
    assert.ok(role.what.length > 20, `${role.id}: say what it is`);
    assert.ok(role.factor > 0 && role.factor <= 2, `${role.id}: factor ${role.factor}`);
    assert.equal(typeof role.background === "function" || typeof role.backgrounds === "function", true, role.id);
  }
  // The ordering the rendered cards actually support, and no more. A large area fill is the
  // easiest thing on the card to see; small text on a tint of itself is the hardest. Nothing
  // that was looked at separates the pill from the chip mark, so nothing here claims to.
  const factorOf = (id) => byId(id).factor;
  assert.ok(factorOf("toneBand") < factorOf("accent"), "a large band needs less than a mark on the card");
  for (const id of ["toneLabel", "toneIcon", "chipMark", "metricCard"]) {
    assert.ok(factorOf(id) > factorOf("accent"), `${id}: text on its own tint is harder than the colour on the card`);
  }
  assert.ok(factorOf("metricCard") < factorOf("toneLabel"), "17px/800 is easier than 12px/900");
});

test("the chip mark is judged against both chips a room can sit in", () => {
  // A room outside the comfort band gets a 10% tint of its own colour; one inside gets the
  // neutral chip. The mark has to be readable in both, so the role reports the worse.
  const point = roles.pointOf("#FFFFFF", "#212121");
  const backgrounds = roles.backgroundsFor(byId("chipMark"), "#67A7AE", point);
  assert.equal(backgrounds.length, 2, "two chips, two backgrounds");
  assert.notEqual(backgrounds[0], backgrounds[1]);
});

test("with no text colour the tinted backgrounds fall back to the card, never to a guess", () => {
  const known = roles.pointOf("#FFFFFF", "#212121");
  const unknown = roles.pointOf("#FFFFFF", null);
  assert.equal(byId("marker").background("#2E8B57", unknown), "#FFFFFF", "the track falls back to what it is painted over");
  assert.notEqual(byId("marker").background("#2E8B57", known), "#FFFFFF", "and uses the text colour when there is one");
  for (const role of roles.PAINT_ROLES) {
    for (const background of roles.backgroundsFor(role, "#2E8B57", unknown)) {
      assert.match(background, /^#[0-9A-Fa-f]{6}$/i, `${role.id}: ${background}`);
    }
  }
});

// ============================================ the lime case ======================

test("lime on a light dashboard is a legible ramp and an unreadable label", () => {
  // The supervisor's screenshot, stated as a test. The scale markers can be read; the
  // "Optimal" pill in the top right and the icon in the top left cannot, because both paint
  // the colour on a 20% tint of itself.
  const lime = palettes.completePalette(palettes.paletteForColor("lime"));
  const report = fit.evaluatePaletteFit(lime, LIGHT());

  const optimal = report.steps.find((step) => step.key === "optimal");
  assert.equal(optimal.roles.accent.fits, true, "lime's middle is perfectly visible on the card itself");
  assert.equal(optimal.roles.marker.fits, true, "and as a marker on the scale");
  assert.equal(optimal.roles.toneLabel.fits, false, "and unreadable as the status pill");
  assert.equal(optimal.roles.toneIcon.fits, false, "and unreadable as the header icon");

  // Which is the whole point: the palette itself is not what needs changing here.
  assert.equal(optimal.fits, true, "so the PALETTE verdict on lime's middle is `keep`");
  assert.equal(optimal.selfTintFits, false, "and the conflict is reported on its own axis");
  assert.ok(
    report.selfTintConflicts.some((entry) => entry.key === "optimal" && entry.role === "toneLabel"),
    JSON.stringify(report.selfTintConflicts.map((entry) => `${entry.key}/${entry.role}`))
  );
});

test("the two verdicts are reported apart and never added together", () => {
  // If they were one number, a palette that is fine as a palette would be rewritten because
  // of a recipe it does not control — the over-steering this separation exists to prevent.
  const report = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), LIGHT());
  assert.equal(report.fits, true, "pastel on white is a shipped, designed palette and stays as written");
  assert.equal(report.selfTintFits, false, "and its palest wing still cannot be read as a chip mark");
  assert.deepEqual(report.failing, [], "`failing` carries palette-role failures only");
  assert.ok(report.selfTintConflicts.length > 0);
  for (const entry of report.selfTintConflicts) {
    assert.ok(entry.deficit > 0, JSON.stringify(entry));
    assert.match(entry.color, /^#[0-9A-Fa-f]{6}$/i);
    assert.match(entry.background, /^#[0-9A-Fa-f]{6}$/i);
    assert.ok(
      roles.SELF_TINTED_ROLES.some((role) => role.id === entry.role),
      `${entry.role} is not a self-tinted role`
    );
  }
});

test("a colour on a card it cannot be seen on fails in every role at once", () => {
  // The control for the case above: when the palette really is the problem, both verdicts
  // agree, and nothing about the separation makes the card any more forgiving.
  const white = palettes.completePalette(palettes.paletteForColor("white"));
  const report = fit.evaluatePaletteFit(white, LIGHT());
  assert.equal(report.fits, false);
  assert.equal(report.selfTintFits, false);
  const optimal = report.steps.find((step) => step.key === "optimal");
  for (const judged of Object.values(optimal.roles)) {
    assert.equal(judged.fits, false, `${judged.role} should fail for white on white`);
  }
});

test("a step's worst role is the one a method would have to fix first", () => {
  const report = fit.evaluatePaletteFit(palettes.paletteForColor("lime"), LIGHT());
  for (const step of report.steps) {
    const worst = step.roles[step.worstRole];
    for (const judged of Object.values(step.roles)) {
      assert.ok(judged.deficit <= worst.deficit + 1e-12, `${step.key}: ${judged.role} is worse than ${step.worstRole}`);
    }
  }
});

test("a role reports the worst point of a gradient, not the first", () => {
  const lime = palettes.paletteForColor("lime");
  const onWhite = fit.evaluatePaletteFit(lime, roles.surfaceOf(["#FFFFFF"], "#212121"));
  const onBoth = fit.evaluatePaletteFit(lime, roles.surfaceOf(["#1C1C1C", "#FFFFFF"], "#212121"));
  const optimalOn = (report) => report.steps.find((step) => step.key === "optimal").roles.accent.distance;
  assert.ok(optimalOn(onBoth) <= optimalOn(onWhite), "adding a sample can only make the answer worse or equal");
});

// ============================================ against the live card ==============

test("the backgrounds the roles compute are the ones a live card composites", () => {
  // Measured from a card rendered at 400px on a white theme: the track is 8% of the text
  // colour over the card, the band and the pill are 20% tints of the tone colour, and a room
  // chip's mark is an 18% tint over the chip's own 10% tint. Restated here so that a change
  // to any of those compositions fails in a file that says what it was checked against.
  const point = roles.pointOf("#FFFFFF", "#212121");
  const tone = "#79A86C";
  const track = color.compositeOver("#212121", 0.08, "#FFFFFF");
  assert.equal(track.toLowerCase(), "#ededed", "the scale track as the browser computed it");

  assert.equal(byId("marker").background(tone, point).toLowerCase(), track.toLowerCase());
  assert.equal(byId("toneLabel").background(tone, point).toLowerCase(), color.compositeOver(tone, 0.2, "#FFFFFF").toLowerCase());
  assert.equal(
    roles.foregroundFor(byId("toneBand"), tone, point).toLowerCase(),
    color.compositeOver(tone, 0.2, track).toLowerCase()
  );

  const chip = "#67A7AE";
  const outChip = color.compositeOver(chip, 0.1, "#FFFFFF");
  assert.ok(
    roles
      .backgroundsFor(byId("chipMark"), chip, point)
      .map((hex) => hex.toLowerCase())
      .includes(color.compositeOver(chip, 0.18, outChip).toLowerCase()),
    "the mark on a room outside the comfort band"
  );
});

test("the bracketed calibration cases still fall on the sides they were seen to fall on", () => {
  // Each row was looked at on a card rendered at 400px, light theme — see the comments beside
  // the factors. They are stated as distances rather than as colours so that the record is
  // about what was SEEN, and so a change to the instrument shows up here rather than in a
  // verdict somewhere downstream.
  const CASES = [
    ["toneBand", 0.012, false, "palette: white paints no band at all"],
    ["toneBand", 0.021, false, "#AADDCC is barely a tint, and a band you have to hunt for is not a band"],
    ["toneBand", 0.031, true, "#77EEDD is plainly a band"],
    ["toneBand", 0.055, true, "pastel's own optimal band is unmistakable"],
    ["toneLabel", 0.218, false, "lime's Optimal pill cannot be read"],
    ["toneLabel", 0.259, true, "pastel's can"],
    ["chipMark", 0.191, false, "lime's chip mark cannot be read"],
    ["chipMark", 0.238, true, "pastel's can, with effort"],
  ];
  for (const [id, distance, visible, why] of CASES) {
    const required = fit.VISIBILITY_THRESHOLD * byId(id).factor;
    assert.equal(distance >= required, visible, `${id} at ${distance} — ${why} (the bar is ${required.toFixed(3)})`);
  }
});

test("the instrument is the same one the baseline threshold was calibrated with", () => {
  // A role only ever scales the threshold; it never brings its own measure. If that stopped
  // being true, the calibration table in palette-fit-calibration.js would no longer say
  // anything about what the roles decide.
  assert.equal(byId("accent").factor, 1, "the accent role IS the baseline");
  const swatch = palettes.completePalette({ id: "s", origin: "builtin", optimal: "#575757" });
  const report = fit.evaluatePaletteFit(swatch, ["#1C1C1C"]);
  assert.equal(
    report.steps[0].roles.accent.distance,
    oklch.screenDistance("#575757", "#1C1C1C"),
    "the accent role reports screenDistance itself, unmodified"
  );
});
