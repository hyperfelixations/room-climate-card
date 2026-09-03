"use strict";

// The map the palette-fit measurement uses: which elements paint with a palette colour,
// what each puts behind it, and how much separation each needs at its real size. The lime
// group below is the shape it exists for — `palette: lime` on a light dashboard is legible
// as a ramp and unreadable as a status label, because the label paints the colour on a 20%
// tint of itself.
// Boundary: the measurement itself is in palette-fit.test.js. See internal dev doc §5
// "Ermittlung des Kartenhintergrunds" and §5 "Tönungsanpassung von Pille, Icon und Chipmarke".

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let roles;
let fit;
let palettes;
let color;
let oklch;
let styles;

test.before(async () => {
  roles = await import("../../../src/domain/classification/paint-roles.js");
  fit = await import("../../../src/domain/classification/palette-fit.js");
  palettes = await import("../../../src/domain/classification/palettes/registry.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
  styles = await import("../../../src/styles/index.js");
});

const SRC = path.join(__dirname, "..", "..", "..", "src");
const read = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");

// A light dashboard as Home Assistant's own theme paints it.
const LIGHT = () => roles.surfaceOf(["#FFFFFF"], "#212121");
const byId = (id) => roles.PAINT_ROLES.find((role) => role.id === id);

// ============================================ the map matches the stylesheet =====

// Every palette-derived custom property the stylesheet paints with, the role that answers
// for it, and the rules that read it. A property with no entry is an unmeasured place a
// palette colour lands; a property read by an unlisted rule is a place the measurement does
// not know about. The consumers are written out because only the producer half is visible
// from the module that sets the property.
const PROPERTY_OWNERS = {
  "--tone-color": {
    role: "accent",
    readBy: [
      ".rtc-top-line",
      ".rtc-avg-button:focus-visible, .rtc-room-chip:focus-visible, .rtc-extreme-card:focus-visible",
    ],
  },
  // --tone-color where nothing had to be adjusted, a hue-locked variant where the colour
  // could not be read on its own tint — see tone-legibility.js.
  "--tone-ink": { role: "toneLabel and toneIcon", readBy: [".rtc-status-pill", ".rtc-icon-badge ha-icon"] },
  "--tone-soft": { role: "the background of toneLabel and toneIcon", readBy: [".rtc-status-pill", ".rtc-icon-badge"] },
  "--tone-band": { role: "toneBand", readBy: [".rtc-optimal-band"] },
  "--marker-color": { role: "marker", readBy: [".rtc-marker"] },
  "--room-color": { role: "chipMark", readBy: [".rtc-room-mark"] },
  "--room-mark-bg": { role: "the background of chipMark", readBy: [".rtc-room-mark"] },
  "--room-bg": { role: "the chip chipMark is painted over", readBy: [".rtc-room-chip"] },
  // Deliberately unmeasured: a border is decorative, carries no reading, and is painted at a
  // higher alpha than the fill it surrounds.
  "--tone-border": { role: null, readBy: [".rtc-status-pill", ".rtc-icon-badge"] },
  "--room-border": { role: null, readBy: [".rtc-room-chip"] },
  // The marker's halo, a tint of the marker's own colour between bar and track.
  "--marker-shadow": { role: null, readBy: [".rtc-marker"] },
};

// The shipped stylesheet, cut into rules. Read from buildStyles(), not the pinned baseline
// copy, so this examines what the card would serve today.
function shippedRules() {
  const css = styles
    .buildStyles({ keyframes: "", trackAnimationCss: "", viewCount: 1, viewWidthPct: 100 })
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const open = [];
  let buffer = "";
  for (const character of css) {
    if (character === "{") {
      open.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
      continue;
    }
    if (character === "}") {
      // An at-rule keeps no declarations of its own here.
      const selector = open.pop();
      if (selector && !selector.startsWith("@")) rules.push({ selector, declarations: buffer.trim() });
      buffer = "";
      continue;
    }
    buffer += character;
  }
  return rules;
}

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

test("every palette property is read by exactly the rules that answer for it", () => {
  // The other half of the guard above: whether the owner and the stylesheet agree on where a
  // property is read. A new consumer is a new place a palette colour is painted.
  const found = new Map();
  for (const rule of shippedRules()) {
    for (const match of rule.declarations.matchAll(/var\(--((?:tone|room|marker)-[a-z-]+)\)/g)) {
      const property = `--${match[1]}`;
      if (!found.has(property)) found.set(property, new Set());
      found.get(property).add(rule.selector);
    }
  }
  assert.ok(found.size > 0, "the stylesheet was not parsed into rules");

  for (const [property, entry] of Object.entries(PROPERTY_OWNERS)) {
    assert.deepEqual(
      [...(found.get(property) || [])].sort(),
      [...entry.readBy].sort(),
      `${property} is read by different rules than the ones listed beside it`
    );
  }
});

// The ink of each place that paints text in a palette colour on a tint of itself. Both
// halves come from one recipe (tone-legibility.js); neither may reach past it to the
// palette colour.
const INK_PROPERTIES = { ".rtc-status-pill": "--tone-ink", ".rtc-icon-badge ha-icon": "--tone-ink", ".rtc-room-mark": "--room-color" };

test("a colour painted on a tint of itself is painted in its ink, never in the palette colour", () => {
  // Forbids the class of defect, not one instance: a property can be produced and measured
  // correctly while the rule that draws the text reads the neighbouring property. The
  // measurement asks the producer, so this asks the stylesheet what the rule paints text in.
  const colourOf = (declarations) => {
    const match = declarations.match(/(?:^|\n)\s*color:\s*([^;]+);/);
    return match ? match[1].trim() : null;
  };

  const rules = shippedRules();
  for (const [selector, ink] of Object.entries(INK_PROPERTIES)) {
    const rule = rules.find((candidate) => candidate.selector === selector);
    assert.ok(rule, `${selector} is no longer in the stylesheet`);
    assert.equal(colourOf(rule.declarations), `var(${ink})`, `${selector} has to paint its text in ${ink}`);
  }

  // Nowhere else is a palette property used as a text colour: the two inks are the only ones
  // that carry an adjusted colour, and text in any other is text painted in what it sits on.
  const inks = new Set(Object.values(INK_PROPERTIES));
  for (const rule of rules) {
    const painted = colourOf(rule.declarations);
    const match = painted && painted.match(/^var\(--((?:tone|room|marker)-[a-z-]+)\)$/);
    if (!match) continue;
    assert.ok(inks.has(`--${match[1]}`), `${rule.selector} paints its text in --${match[1]}, which is not an ink`);
  }
});

test("the tint weights are the ones the card really applies", () => {
  // The roles composite these by hand; read from the modules that own them, not restated, so
  // a source change that did not reach here fails.
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

  // For a palette role neither side of the comparison is derived from the colour, so moving
  // the colour moves the separation at full leverage; for a self-tinted role one side
  // follows the colour. Which side differs — the pill tints its background, the band its
  // foreground — so both are checked.
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

test("the header icon is the status pill measured once, not twice", () => {
  // The icon and the pill both paint the colour at full strength on the same 20% tint of
  // itself and ask for the same separation, so the icon declares that it mirrors the pill
  // rather than re-running the arithmetic. Both names are kept because a stylesheet change
  // could part them.
  const icon = byId("toneIcon");
  assert.equal(icon.mirrors, "toneLabel", "the icon says whose measurement it shares");
  assert.equal(icon.background, undefined, "and therefore brings no background of its own");
  assert.equal(icon.foreground, undefined);
  assert.equal(icon.factor, byId("toneLabel").factor);

  const surfaces = [["#FFFFFF", "#212121"], ["#1C1C1C", "#E1E1E1"], ["#808080", null], ["#C8B400", null], ["#FA8072", null]];
  let compared = 0;
  for (const id of ["pastel", "vivid", "color-vision", "signal"]) {
    for (const [card, text] of surfaces) {
      const report = fit.evaluatePaletteFit(palettes.paletteForName(id), roles.surfaceOf([card], text));
      for (const step of [...report.steps, report.invalid]) {
        const strip = (judged) => ({ ...judged, role: null });
        assert.deepEqual(strip(step.roles.toneIcon), strip(step.roles.toneLabel), id + " on " + card + ", " + step.key);
        compared += 1;
      }
    }
  }
  assert.ok(compared > 200, "only " + compared + " pairs compared");
});

test("every role states what it is and needs a defensible amount of separation", () => {
  for (const role of roles.PAINT_ROLES) {
    assert.match(role.id, /^[a-zA-Z]+$/);
    assert.ok(role.what.length > 20, `${role.id}: say what it is`);
    assert.ok(role.factor > 0 && role.factor <= 2, `${role.id}: factor ${role.factor}`);
    // Either its own recipe or the name of the role it shares one with — neither would
    // measure against undefined.
    const hasOwnRecipe = typeof role.background === "function" || typeof role.backgrounds === "function";
    assert.equal(hasOwnRecipe || typeof role.mirrors === "string", true, role.id);
    assert.equal(hasOwnRecipe && typeof role.mirrors === "string", false, role.id + ": a mirror does not also bring its own");
  }
  // The ordering the rendered cards support: a large area fill is the easiest thing to see,
  // small text on a tint of itself the hardest. The pill and the chip mark are not separated.
  const factorOf = (id) => byId(id).factor;
  assert.ok(factorOf("toneBand") < factorOf("accent"), "a large band needs less than a mark on the card");
  for (const id of ["toneLabel", "toneIcon", "chipMark", "metricCard"]) {
    assert.ok(factorOf(id) > factorOf("accent"), `${id}: text on its own tint is harder than the colour on the card`);
  }
  assert.ok(factorOf("metricCard") < factorOf("toneLabel"), "17px/800 is easier than 12px/900");
});

test("the chip mark is judged against both chips a room can sit in", () => {
  // A room outside the comfort band gets a 10% tint of its own colour, one inside the neutral
  // chip; the mark must be readable in both, so the role reports the worse.
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
  // The scale markers can be read; the "Optimal" pill and the header icon cannot, because
  // both paint the colour on a 20% tint of itself.
  const lime = palettes.completePalette(palettes.paletteForColor("lime"));
  const report = fit.evaluatePaletteFit(lime, LIGHT());

  const optimal = report.steps.find((step) => step.key === "optimal");
  assert.equal(optimal.roles.accent.fits, true, "lime's middle is perfectly visible on the card itself");
  assert.equal(optimal.roles.marker.fits, true, "and as a marker on the scale");
  assert.equal(optimal.roles.toneLabel.fits, false, "and unreadable as the status pill");
  assert.equal(optimal.roles.toneIcon.fits, false, "and unreadable as the header icon");

  // The point: the palette itself is not what needs changing here.
  assert.equal(optimal.fits, true, "so the PALETTE verdict on lime's middle is `keep`");
  assert.equal(optimal.selfTintFits, false, "and the conflict is reported on its own axis");
  assert.ok(
    report.selfTintConflicts.some((entry) => entry.key === "optimal" && entry.role === "toneLabel"),
    JSON.stringify(report.selfTintConflicts.map((entry) => `${entry.key}/${entry.role}`))
  );
});

test("the two verdicts are reported apart and never added together", () => {
  // One number would rewrite a palette that is fine as a palette over a recipe it does not
  // control — the over-steering this separation prevents.
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
  // The control: when the palette really is the problem, both verdicts agree.
  const white = palettes.completePalette(palettes.paletteForColor("white"));
  const report = fit.evaluatePaletteFit(white, LIGHT());
  assert.equal(report.fits, false);
  assert.equal(report.selfTintFits, false);
  const optimal = report.steps.find((step) => step.key === "optimal");
  for (const judged of Object.values(optimal.roles)) {
    assert.equal(judged.fits, false, `${judged.role} should fail for white on white`);
  }
});

test("each verdict summarises its own roles, and never the other side's", () => {
  // Each axis summarises only its own roles. If `margin` were computed over all roles, a
  // self-tinted role failing almost everywhere would zero it on steps that are comfortably
  // fine, and "how far may I move this" would have no answer.
  const lime = fit.evaluatePaletteFit(palettes.paletteForColor("lime"), LIGHT());
  for (const step of lime.steps) {
    assert.ok(
      roles.PALETTE_ROLES.some((role) => role.id === step.worstRole),
      step.key + ": " + step.worstRole + " is not a palette role"
    );
    const worst = step.roles[step.worstRole];
    for (const role of roles.PALETTE_ROLES) {
      assert.ok(step.roles[role.id].deficit <= worst.deficit + 1e-12, step.key + ": " + role.id + " is worse than " + step.worstRole);
    }

    assert.ok(
      roles.SELF_TINTED_ROLES.some((role) => role.id === step.worstSelfTintRole),
      step.key + ": " + step.worstSelfTintRole + " is not a self-tinted role"
    );
    const worstTint = step.roles[step.worstSelfTintRole];
    for (const role of roles.SELF_TINTED_ROLES) {
      assert.ok(step.roles[role.id].deficit <= worstTint.deficit + 1e-12, step.key + ": " + role.id + " is worse than " + step.worstSelfTintRole);
    }

    assert.equal(step.fits, step.deficit === 0, step.key + ": fits and deficit are one statement");
    assert.equal(step.selfTintFits, step.selfTintDeficit === 0, step.key + ": and so are their counterparts");
  }
});

test("a passing step reports the room it still has, even while its own pill fails", () => {
  // On white every pastel step passes the palette question while some fail the recipe. The
  // palette-axis margin still has to be a real number, since it says how far the ramp may
  // travel before it breaks something that works today.
  const onWhite = fit.evaluatePaletteFit(palettes.paletteForName("pastel"), LIGHT());
  assert.equal(onWhite.fits, true);
  assert.equal(onWhite.selfTintFits, false, "some of its steps really are unreadable as a chip mark");
  for (const step of onWhite.steps) {
    assert.equal(step.deficit, 0, step.key);
    assert.ok(step.margin > 0, step.key + ": a passing step must say how much room is left");
  }
  const failing = onWhite.steps.filter((step) => !step.selfTintFits);
  assert.ok(failing.length > 0);
  for (const step of failing) assert.ok(step.selfTintDeficit > 0, step.key);
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
  // The compositions a live card produces: the track is 8% of the text colour over the card,
  // the band and the pill 20% tints of the tone colour, a chip's mark an 18% tint over the
  // chip's own 10% tint. Restated here so a change to any of them fails.
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
  // Each row was looked at on a card rendered at 400px, light theme. Stated as distances
  // rather than colours, so a change to the instrument shows up here.
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
  // A role only scales the threshold; it never brings its own measure. Otherwise the
  // calibration table in palette-fit-calibration.js would say nothing about the roles.
  assert.equal(byId("accent").factor, 1, "the accent role IS the baseline");
  const swatch = palettes.completePalette({ id: "s", origin: "builtin", optimal: "#575757" });
  const report = fit.evaluatePaletteFit(swatch, ["#1C1C1C"]);
  assert.equal(
    report.steps[0].roles.accent.distance,
    oklch.screenDistance("#575757", "#1C1C1C"),
    "the accent role reports screenDistance itself, unmodified"
  );
});
