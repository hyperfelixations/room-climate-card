"use strict";

// The colour layer: which palettes exist, how a tier's distance from optimal becomes a
// colour, and in what ORDER a classification is asked for one.
//
// Two things are worth testing hardest. The ORDER, because two of its four steps exist
// only because getting them wrong is invisible — an entity-classified value quietly
// taking a ramp colour it has no relation to, an impossible reading quietly taking one
// because it happens to carry a score — and both would look like a working card. And the
// ANCHORING, because that is what lets a profile and a palette of different reach fit
// together without an option, an error case or a guess.
//
// The characterization at the bottom is the regression proof for the whole colour layer:
// every tier of every built-in profile, against the hex values the card shipped before it
// had palettes at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const { measure } = require("../helpers/color-vision.js");

let palettes;
let pastel;
let vivid;
let signal;
let paletteColor;
let classify;
let registry;

// The palettes themselves, one entry each. The registry is keyed by every WORD that
// reaches a palette, so iterating it directly would measure `color-vision` five times and
// say nothing about the other four.
let shipped;

test.before(async () => {
  palettes = await import("../../src/domain/classification/palettes/registry.js");
  ({ pastel } = await import("../../src/domain/classification/palettes/pastel.js"));
  ({ vivid } = await import("../../src/domain/classification/palettes/vivid.js"));
  ({ signal } = await import("../../src/domain/classification/palettes/signal.js"));
  paletteColor = await import("../../src/domain/classification/palette-color.js");
  classify = await import("../../src/domain/classification/classify.js");
  registry = await import("../../src/domain/classification/registry.js");
  shipped = [...new Set(Object.values(palettes.CLASSIFICATION_PALETTE_REGISTRY))].map((palette) => [palette.id, palette]);
});

// ------------------------------------------------------------- registry ----

test("every shipped palette is complete, and the registry is frozen", () => {
  assert.deepEqual(shipped.map(([id]) => id).sort(), ["color-vision", "pastel", "signal", "vivid"]);
  for (const [id, palette] of shipped) {
    for (const [wing, colors] of [["above", palette.above], ["below", palette.below]]) {
      for (const [index, color] of colors.entries()) {
        assert.match(color, /^#[0-9A-Fa-f]{6}$/, `${id}: ${wing} step ${index + 1}`);
      }
      assert.equal(Object.isFrozen(colors), true, `${id}: ${wing} frozen`);
    }
    assert.match(palette.optimal, /^#[0-9A-Fa-f]{6}$/, `${id}: optimal`);
    assert.match(palette.invalid, /^#[0-9A-Fa-f]{6}$/, `${id}: invalid`);
    assert.ok(palettes.PALETTE_TUNINGS.includes(palette.tunedFor), `${id}: tunedFor`);
    assert.equal(Object.isFrozen(palette), true, `${id}: frozen`);
    assert.equal("aliases" in palette, false, `${id}: which words reach a palette is not part of the palette`);
  }
  assert.equal(Object.isFrozen(palettes.CLASSIFICATION_PALETTE_REGISTRY), true);
  assert.equal(palettes.DEFAULT_PALETTE, palettes.CLASSIFICATION_PALETTE_REGISTRY.pastel);
});

// A user searches by the name of the thing they have. A tritanope writes `tritan`, and
// finding nothing there would be worse than any tidiness gained by insisting on one
// spelling — so several words reach one palette, and every one of them is offered when a
// name does not match.
test("a palette can be reached by several words, and all of them are listed", () => {
  const canonical = palettes.paletteForName("color-vision");
  for (const alias of ["protan-deutan", "protan", "deutan", "tritan"]) {
    assert.equal(palettes.paletteForName(alias), canonical, alias);
  }
  assert.equal(canonical.id, "color-vision", "the palette keeps exactly one id");
  assert.deepEqual(
    palettes.paletteKeys(),
    ["pastel", "vivid", "color-vision", "protan-deutan", "protan", "deutan", "tritan", "signal"]
  );
});

// Both shipped palettes have to be usable by the same profile, or "the profile means the
// same thing under either" is not true.
test("the full-length palettes reach equally far in both directions", () => {
  assert.equal(pastel.above.length, 5);
  assert.equal(pastel.below.length, 5);
  assert.equal(vivid.above.length, pastel.above.length);
  assert.equal(vivid.below.length, pastel.below.length);
  // `signal` is deliberately shorter, which is what makes it the proof that a palette and
  // a profile of different reach fit together without anything being configured.
  assert.equal(signal.above.length, 2);
  assert.equal(signal.below.length, 2);
});

test("an unknown palette name resolves to nothing rather than to a default", () => {
  assert.equal(palettes.paletteForName("nope"), null);
  assert.equal(palettes.paletteForName(""), null);
  assert.equal(palettes.paletteForName(undefined), null);
});

test("assertPalette() refuses every unusable shape, naming the path it was given", () => {
  const ok = { below: ["#111111"], optimal: "#222222", above: ["#333333"] };
  const cases = [
    [null, /my_palette must be an object/],
    [["#111111"], /my_palette must be an object/],
    [{ ...ok, optimal: undefined }, /my_palette\.optimal must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, optimal: "red" }, /my_palette\.optimal must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, above: "#111111" }, /my_palette\.above must be a list of colors/],
    [{ ...ok, above: ["#111111", "nope"] }, /my_palette\.above\[2\] must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, invalid: "red" }, /my_palette\.invalid must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, tunedFor: "midnight" }, /my_palette\.tunedFor must be one of light, dark, any/],
  ];
  for (const [palette, expected] of cases) {
    assert.throws(() => palettes.assertPalette(palette, "my_palette"), expected, JSON.stringify(palette));
  }
  // A wing step is named 1-based, because a wing is addressed by "steps from optimal"
  // everywhere else and an off-by-one here would send a user to the wrong colour.
  assert.throws(() => palettes.assertPalette({ ...ok, below: ["bad"] }, "palette"), /palette\.below\[1\]/);
});

// ONE contract, not one for the card and a stricter one for its users. A missing wing is
// not a broken palette: CO2 has no "too little" to colour, and a single colour is a
// perfectly good way to say "this card is teal".
test("a palette without wings is complete, and a missing wing completes to empty", () => {
  const single = palettes.completePalette(palettes.assertPalette({ id: "one", optimal: "#1DB85D" }, "palette"));
  assert.deepEqual(single.above, []);
  assert.deepEqual(single.below, []);
  assert.equal(single.optimal, "#1DB85D");
  assert.equal(Object.isFrozen(single.above), true);

  const oneSided = palettes.completePalette(palettes.assertPalette({ id: "up", optimal: "#111111", above: ["#222222"] }));
  assert.deepEqual(oneSided.above, ["#222222"]);
  assert.deepEqual(oneSided.below, []);
});

// Recorded now, while the palettes are being designed and the answer is known. Nothing
// reads it yet — see PALETTE_TUNINGS in the registry for why it exists anyway.
test("tunedFor records the card background a palette was designed against", () => {
  assert.equal(palettes.paletteForName("pastel").tunedFor, "dark");
  assert.equal(palettes.paletteForName("vivid").tunedFor, "any");
  assert.equal(palettes.completePalette({ id: "x", optimal: "#111111" }).tunedFor, "any", "a written-out palette says nothing");
});

// The one field a palette may leave out. Nobody should have to invent a colour for a
// state they never see.
test("invalid is optional and completes to a neutral grey", () => {
  const bare = { below: ["#111111"], optimal: "#222222", above: ["#333333"] };
  assert.equal(palettes.completePalette(palettes.assertPalette(bare)).invalid, palettes.NEUTRAL_COLOR);
  assert.equal(palettes.completePalette(palettes.assertPalette({ ...bare, invalid: "#abcdef" })).invalid, "#abcdef");
});

// The neutral grey is not a taste decision, and the number is the point: a card colour is
// foreground on a light background AND a dark one, so the whole grey axis was walked
// against both and this is the value where the two contrasts meet. The one it replaced
// was the pastel palette's own warm grey, wired in where no palette should have had a
// say, and it managed 2.13:1 on a light card.
test("the neutral grey is the best a single grey can do on both backgrounds", () => {
  const { contrastRatio, LIGHT_CARD, DARK_CARD } = require("../helpers/color-vision.js");
  const onLight = contrastRatio(palettes.NEUTRAL_COLOR, LIGHT_CARD);
  const onDark = contrastRatio(palettes.NEUTRAL_COLOR, DARK_CARD);
  assert.ok(onLight >= 4.1, `${onLight.toFixed(2)}:1 on a light card`);
  assert.ok(onDark >= 4.1, `${onDark.toFixed(2)}:1 on a dark card`);
  // No other pure grey does better on its weaker side, which is what "best" has to mean
  // for a value that has to work in both directions at once.
  for (let value = 0; value < 256; value += 1) {
    const grey = `#${value.toString(16).padStart(2, "0").repeat(3)}`;
    const weakest = Math.min(contrastRatio(grey, LIGHT_CARD), contrastRatio(grey, DARK_CARD));
    assert.ok(weakest <= Math.min(onLight, onDark) + 1e-9, `${grey} would be better`);
  }
});

// --------------------------------------------------- the profile's reach ---

test("a profile's reach counts only the tiers that take a palette colour", () => {
  const { deviationSpanOf } = classify;
  assert.deepEqual(deviationSpanOf({ tiers: [{ score: 2 }, { score: 0 }, { score: -3 }] }), { above: 2, below: 3 });
  // One-sided: nothing ever asks the palette's `below` wing for a colour.
  assert.deepEqual(deviationSpanOf({ tiers: [{ score: 5 }, { score: 1 }, { score: 0 }] }), { above: 5, below: 0 });
  // A painted tier is not on the ramp, so its score is not a distance and does not count.
  assert.deepEqual(
    deviationSpanOf({ tiers: [{ score: 99, color: "#ffffff" }, { score: 1 }, { score: 0 }] }),
    { above: 1, below: 0 }
  );
  assert.deepEqual(deviationSpanOf({ tiers: [{ score: 2.5 }] }), { above: 0, below: 0 }, "a non-distance is ignored");
});

// ------------------------------------------------------------- anchoring ---

const WIDE = { below: ["#b1", "#b2", "#b3", "#b4", "#b5"], optimal: "#opt", above: ["#a1", "#a2", "#a3", "#a4", "#a5"] };
const NARROW = { below: ["#lo"], optimal: "#mid", above: ["#hi"] };

test("optimal is the middle, always, whatever the palette or the profile", () => {
  for (const palette of [WIDE, NARROW, pastel, vivid]) {
    assert.equal(paletteColor.rampColorFor(0, { above: 5, below: 5 }, palette), palette.optimal);
    assert.equal(paletteColor.rampColorFor(0, { above: 0, below: 0 }, palette), palette.optimal);
  }
});

test("a profile and a palette of equal reach map one to one", () => {
  const span = { above: 5, below: 5 };
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => paletteColor.rampColorFor(k, span, WIDE)), ["#a1", "#a2", "#a3", "#a4", "#a5"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => paletteColor.rampColorFor(-k, span, WIDE)), ["#b1", "#b2", "#b3", "#b4", "#b5"]);
});

// The case the earlier design could not express at all. A short palette is not a
// configuration error; it is a palette with less resolution.
test("a palette shorter than the profile collapses onto what it has", () => {
  const span = { above: 5, below: 5 };
  for (const k of [1, 2, 3, 4, 5]) {
    assert.equal(paletteColor.rampColorFor(k, span, NARROW), "#hi", `+${k}`);
    assert.equal(paletteColor.rampColorFor(-k, span, NARROW), "#lo", `-${k}`);
  }
});

// And the other direction: three tiers on an eleven-colour ramp should reach that ramp's
// ENDS, not pick three neighbours out of its middle.
test("a profile shorter than the palette reaches the palette's ends", () => {
  const span = { above: 1, below: 1 };
  assert.equal(paletteColor.rampColorFor(1, span, WIDE), "#a5");
  assert.equal(paletteColor.rampColorFor(-1, span, WIDE), "#b5");
  assert.equal(paletteColor.rampColorFor(0, span, WIDE), "#opt");
});

// The rule that makes the first step off optimal visible at every resolution.
test("the first step away from optimal always leaves the middle colour", () => {
  for (const reach of [1, 2, 3, 5, 10, 20]) {
    for (const palette of [WIDE, NARROW, pastel, vivid]) {
      assert.notEqual(paletteColor.rampColorFor(1, { above: reach, below: reach }, palette), palette.optimal, `reach ${reach}`);
      assert.notEqual(paletteColor.rampColorFor(-1, { above: reach, below: reach }, palette), palette.optimal, `reach ${reach}`);
    }
  }
});

test("a long profile is spread monotonically over a shorter palette", () => {
  const span = { above: 10, below: 10 };
  const seen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => paletteColor.rampColorFor(k, span, WIDE));
  assert.deepEqual(seen, ["#a1", "#a1", "#a2", "#a2", "#a3", "#a3", "#a4", "#a4", "#a5", "#a5"]);
  assert.equal(seen[seen.length - 1], "#a5", "the profile's extreme reaches the palette's extreme");
});

// Wings are scaled on their own, so a palette may be finer in one direction than the
// other without that leaking into the opposite side.
test("the two wings are scaled independently", () => {
  const lopsided = { below: ["#b1"], optimal: "#opt", above: ["#a1", "#a2", "#a3"] };
  const span = { above: 3, below: 3 };
  assert.deepEqual([1, 2, 3].map((k) => paletteColor.rampColorFor(k, span, lopsided)), ["#a1", "#a2", "#a3"]);
  assert.deepEqual([1, 2, 3].map((k) => paletteColor.rampColorFor(-k, span, lopsided)), ["#b1", "#b1", "#b1"]);
});

test("a distance that is not a whole number is refused, not rounded", () => {
  for (const deviation of [2.5, -0.5, NaN, null, undefined, "3"]) {
    assert.throws(
      () => paletteColor.rampColorFor(deviation, { above: 5, below: 5 }, WIDE),
      /needs a whole number of steps from optimal/,
      JSON.stringify(String(deviation))
    );
  }
});

// Cannot arise from a validated profile, because the reach IS that profile's extreme.
// Guarded anyway, because reading past the end of a wing would yield `undefined`.
test("a distance beyond the profile's own reach is refused rather than silently clamped", () => {
  assert.throws(
    () => paletteColor.rampColorFor(6, { above: 5, below: 5 }, WIDE, "the profile"),
    /the profile is 6 steps above optimal, which is outside the profile's own range/
  );
  assert.throws(
    () => paletteColor.rampColorFor(-1, { above: 5, below: 0 }, WIDE),
    /1 step below optimal, which is outside the profile's own range/
  );
});

// ---------------------------------------------------- resolution order ----

function classification(overrides) {
  return {
    source: "builtin",
    invalid: false,
    explicitColor: null,
    deviation: 1,
    deviationSpan: { above: 5, below: 5 },
    ...overrides,
  };
}

test("an entity-classified value never takes a ramp colour, whatever score it carries", () => {
  // The trap: an integration supplies value_score but no value_color. That score is a
  // number on the integration's own scale and means nothing in the card's palette.
  assert.equal(paletteColor.resolveClassificationColor(classification({ source: "entity", deviation: null }), WIDE), palettes.NEUTRAL_COLOR);
  // Even if something upstream did hand it a distance, the entity branch comes first.
  assert.equal(paletteColor.resolveClassificationColor(classification({ source: "entity" }), WIDE), palettes.NEUTRAL_COLOR);
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ source: "entity", explicitColor: "#123456" }), WIDE),
    "#123456"
  );
});

test("an invalid reading takes the palette's invalid colour, never the ramp", () => {
  const palette = { ...WIDE, invalid: "#999999" };
  assert.equal(paletteColor.resolveClassificationColor(classification({ invalid: true, deviation: null }), palette), "#999999");
  // A distance present AND invalid: invalid still wins, which is the whole point.
  assert.equal(paletteColor.resolveClassificationColor(classification({ invalid: true }), palette), "#999999");
  // A profile that names its own invalid colour keeps it.
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ invalid: true, explicitColor: "#abcabc" }), palette),
    "#abcabc"
  );
});

test("an explicit tier colour beats the palette, and only then does the ramp apply", () => {
  assert.equal(paletteColor.resolveClassificationColor(classification({ explicitColor: "#fedcba" }), WIDE), "#fedcba");
  assert.equal(paletteColor.resolveClassificationColor(classification({ deviation: 3 }), WIDE), "#a3");
});

// ---------------------------------------------- built-in characterization --

// The colours the card shipped before palettes existed, keyed by distance from optimal.
// Recorded from the profile sources as they were, so this is evidence rather than a
// restatement of the palette it checks.
const SHIPPED_BY_DEVIATION = {
  [-5]: "#8A88C9",
  [-4]: "#8192C8",
  [-3]: "#76A0C0",
  [-2]: "#67A7AE",
  [-1]: "#69A78B",
  [0]: "#79A86C",
  [1]: "#9DA85A",
  [2]: "#C0A752",
  [3]: "#C98A67",
  [4]: "#C67277",
  [5]: "#B85F67",
};
const SHIPPED_INVALID = "#B4B2A9";

test("every built-in tier keeps exactly the colour it always had", () => {
  let tiers = 0;
  for (const kind of ["temperature", "humidity", "co2", "pm25"]) {
    for (const [id, profile] of Object.entries(registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles)) {
      // A value INSIDE the tier, on the profile's own comparison: an exclusive profile
      // does not admit its own threshold. The open-ended tier is probed just below the
      // one above it rather than at negative infinity, because several profiles call a
      // far-out reading physically invalid — which is a different question from which
      // tier it belongs to.
      const inside = (index) => {
        const tier = profile.tiers[index];
        if (Number.isFinite(tier.min)) return profile.comparison === ">" ? tier.min + 0.001 : tier.min;
        const above = profile.tiers[index - 1];
        return above ? above.min - 0.001 : 0;
      };
      for (const [index, tier] of profile.tiers.entries()) {
        // Probed through the real classifier, not by reading the tier object — the path
        // a rendered value actually takes.
        const probe = inside(index);
        const result = classify.classifyNumericValue(profile, probe);
        assert.equal(result.levelKey, tier.levelKey, `${kind}/${id}: probe ${probe} selects its own tier`);
        assert.equal(
          paletteColor.resolveClassificationColor({ ...result, source: "builtin" }, pastel),
          SHIPPED_BY_DEVIATION[tier.score],
          `${kind}/${id} ${tier.levelKey} (${tier.score} from optimal)`
        );
        tiers++;
      }
      if (profile.invalidWhen) {
        const invalidProbe = kind === "humidity" ? -1 : kind === "co2" ? 0 : -1;
        const result = classify.classifyNumericValue(profile, invalidProbe);
        assert.equal(result.invalid, true, `${kind}/${id}: ${invalidProbe} is invalid`);
        assert.equal(
          paletteColor.resolveClassificationColor({ ...result, source: "builtin" }, pastel),
          SHIPPED_INVALID,
          `${kind}/${id}: invalid colour`
        );
      }
    }
  }
  // 11 + 11 + 11 (temperature) + 11 (humidity) + 6 (CO2) + 6 (PM2.5).
  assert.equal(tiers, 56, "every tier of every built-in profile was checked");
});

test("the same profiles under the second palette differ everywhere and stay coherent", () => {
  const profile = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor;
  const seen = new Set();
  for (const tier of profile.tiers) {
    const result = classify.classifyNumericValue(profile, Number.isFinite(tier.min) ? tier.min : -1e6);
    const bold = paletteColor.resolveClassificationColor({ ...result, source: "builtin" }, vivid);
    const soft = paletteColor.resolveClassificationColor({ ...result, source: "builtin" }, pastel);
    assert.notEqual(bold, soft, `${tier.score} from optimal must actually change`);
    assert.match(bold, /^#[0-9A-Fa-f]{6}$/);
    seen.add(bold);
  }
  assert.equal(seen.size, profile.tiers.length, "eleven tiers, eleven distinct colours");
});

// ------------------------------------------- the colour-blind palettes ------

// These two exist to be USABLE by someone who cannot see the default ramp, and that is a
// measurable claim rather than a design intention. The instrument is
// test/helpers/color-vision.js, and it verifies itself first in color-vision-tool.test.js
// — without that, these numbers would only be self-consistent.
//
// What is checked is the JUDGEMENT the colour carries: how far each end sits from the
// middle, how far the two ends sit from each other, and that every step outwards is
// further out than the last. Not checked, and deliberately not claimed: that all eleven
// steps are individually distinguishable. With one hue axis gone and 25 L* to work in —
// the colours are foreground on a light card and a dark one — that is not reachable, and
// the level text is what carries the fine detail.
// Measured with the Brettel 1997 simulation, under every way of seeing, and written as
// floors just under what the palette actually reaches. The neighbour gap is here because
// reach alone does not make a ramp readable: `pastel` spans a long distance under
// deuteranopia and still has two adjacent steps dE00 1,9 apart.
const CVD_LIMITS = { wing: 30, ends: 48, step: 4 };

// ONE palette for all three deficiencies, and that is a measurement rather than a
// convenience. Protan and deutan were always going to share a design — they confuse the
// same colours. Tritan was expected to need its own, and does not: a search over 36 hue
// pairs crossed with lightness and chroma schedules picked the same winner for both
// targets independently. So the claim under test is the strong one: this ramp holds up
// under EVERY way of seeing, not only the one it is named for.
test("the colour-vision palette works for all three deficiencies, not only one", () => {
  const palette = palettes.paletteForName("color-vision");
  for (const deficiency of ["normal", "protan", "deutan", "tritan"]) {
    const seen = measure(palette, deficiency);
    assert.equal(seen.monotone, true, `${deficiency}: every step out is further from the middle`);
    assert.ok(seen.lowWing >= CVD_LIMITS.wing, `${deficiency}: middle to coldest is ${seen.lowWing.toFixed(1)}`);
    assert.ok(seen.highWing >= CVD_LIMITS.wing, `${deficiency}: middle to hottest is ${seen.highWing.toFixed(1)}`);
    assert.ok(seen.ends >= CVD_LIMITS.ends, `${deficiency}: end to end is ${seen.ends.toFixed(1)}`);
    assert.ok(seen.minStep >= CVD_LIMITS.step, `${deficiency}: nearest neighbours are ${seen.minStep.toFixed(1)} apart`);
  }
});

// Contrast measured on the colours as they are SEEN, not as they are written. A palette
// for people who see colour differently that was only ever checked against normal vision
// would be checking the one case it is not for.
test("the colour-vision palette stays readable under the simulation, not just on paper", () => {
  const palette = palettes.paletteForName("color-vision");
  for (const deficiency of ["normal", "protan", "deutan", "tritan"]) {
    const seen = measure(palette, deficiency);
    assert.ok(seen.onLight >= 2.4, `${deficiency}: ${seen.onLight.toFixed(2)}:1 on a light card`);
    assert.ok(seen.onDark >= 2.6, `${deficiency}: ${seen.onDark.toFixed(2)}:1 on a dark card`);
  }
});

// The comparison that says this palette is needed at all. Under red-green deficiency the
// default ramp's own two ends — green and red — are the pair that disappears.
test("the colour-vision palette beats the default ramp for every deficiency", () => {
  const weakest = (m) => Math.min(m.lowWing, m.highWing);
  for (const deficiency of ["protan", "deutan", "tritan"]) {
    const theirs = weakest(measure(palettes.paletteForName("color-vision"), deficiency));
    const defaults = weakest(measure(pastel, deficiency));
    assert.ok(theirs > defaults, `under ${deficiency}: ${theirs.toFixed(0)} must beat the default's ${defaults.toFixed(0)}`);
  }
});

// Every palette the card ships has to be readable on both card backgrounds, whatever it
// was designed around — a palette that vanished in dark mode would have traded one group
// of users for another.
test("every shipped palette carries usable contrast on both backgrounds", () => {
  for (const [id, palette] of shipped) {
    const seen = measure(palette, "normal");
    assert.ok(seen.onLight >= 2.0, `${id}: ${seen.onLight.toFixed(2)}:1 on a light card`);
    assert.ok(seen.onDark >= 2.6, `${id}: ${seen.onDark.toFixed(2)}:1 on a dark card`);
  }
});

// A palette meant for one deficiency need not serve the others, but every palette must
// still be a ramp for everyone: each step further out has to look further out.
test("every shipped palette still reads as a ramp for normal vision", () => {
  for (const [id, palette] of shipped) {
    const seen = measure(palette, "normal");
    assert.equal(seen.monotone, true, `${id}: monotone from the middle out`);
    assert.ok(Math.min(seen.lowWing, seen.highWing) >= 25, `${id}: the weaker wing reaches ${Math.min(seen.lowWing, seen.highWing).toFixed(0)}`);
  }
});

// Whether the two DIRECTIONS are told apart is a separate question, and one palette
// answers it deliberately differently. Pinned by name rather than as a blanket rule, so
// that `signal` staying symmetric is a recorded decision and pastel losing its two ends
// would still be a failure.
test("three palettes distinguish too little from too much, and signal deliberately does not", () => {
  for (const id of ["pastel", "vivid", "color-vision"]) {
    assert.ok(measure(palettes.paletteForName(id), "normal").ends >= 25, `${id}: the two ends are far apart`);
  }
  assert.equal(measure(signal, "normal").ends, 0, "signal says HOW FAR from optimal, not which way");
});

// The short palette exists to be this test. A profile that reaches five steps, a palette
// that carries two: every deviation has to land somewhere sensible, without an option and
// without an error.
test("a five-step profile on the two-step signal palette collapses onto what it has", () => {
  const span = { above: 5, below: 5 };
  const seen = [1, 2, 3, 4, 5].map((k) => paletteColor.rampColorFor(k, span, signal));
  assert.deepEqual(seen, ["#FD9808", "#FD9808", "#EE2046", "#EE2046", "#EE2046"]);
  assert.equal(paletteColor.rampColorFor(0, span, signal), "#1DB85D", "and the middle is still the middle");
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((k) => paletteColor.rampColorFor(-k, span, signal)),
    seen,
    "both wings carry the same pair, so distance reads the same in either direction"
  );
});

// A palette may say nothing about a direction — `palette: {optimal: …}` is a card in one
// colour, and a generated ramp on `white` has nowhere paler to go. Neither is an error.
test("a wing with no colours in it answers with the middle", () => {
  const single = palettes.completePalette({ id: "one", optimal: "#1DB85D" });
  for (const deviation of [-5, -1, 0, 1, 5]) {
    assert.equal(paletteColor.rampColorFor(deviation, { above: 5, below: 5 }, single), "#1DB85D", String(deviation));
  }
  // Still not a place where a malformed deviation goes unnoticed.
  assert.throws(() => paletteColor.rampColorFor(1.5, { above: 5, below: 5 }, single), /whole number of steps/);
});

// The rule the configuration layer enforces on user profiles, turned on the card's own.
// A built-in profile is not normalized through that layer, so nothing else would notice
// if a future one broke the contract every custom profile is held to.
test("every built-in profile obeys the ramp contract it imposes on custom ones", () => {
  for (const kind of ["temperature", "humidity", "co2", "pm25"]) {
    for (const [id, profile] of Object.entries(registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles)) {
      let previous = null;
      for (const [index, tier] of profile.tiers.entries()) {
        if (tier.color) continue;
        assert.ok(Number.isInteger(tier.score), `${kind}/${id}[${index}]: ${tier.score} is not a whole number`);
        if (previous !== null) {
          assert.ok(tier.score < previous, `${kind}/${id}[${index}]: ${tier.score} does not fall below ${previous}`);
        }
        previous = tier.score;
        if (tier.zone === "optimal") assert.equal(tier.score, 0, `${kind}/${id}[${index}]: the optimal tier must sit at 0`);
      }
      assert.notEqual(previous, null, `${kind}/${id}: a profile with no palette-driven tier would colour nothing`);
    }
  }
});
