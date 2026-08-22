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

let palettes;
let pastel;
let vivid;
let paletteColor;
let classify;
let registry;

test.before(async () => {
  palettes = await import("../../src/domain/classification/palettes/registry.js");
  ({ pastel } = await import("../../src/domain/classification/palettes/pastel.js"));
  ({ vivid } = await import("../../src/domain/classification/palettes/vivid.js"));
  paletteColor = await import("../../src/domain/classification/palette-color.js");
  classify = await import("../../src/domain/classification/classify.js");
  registry = await import("../../src/domain/classification/registry.js");
});

// ------------------------------------------------------------- registry ----

test("every shipped palette is complete, and the registry is frozen", () => {
  const ids = Object.keys(palettes.CLASSIFICATION_PALETTE_REGISTRY);
  assert.deepEqual(ids.sort(), ["pastel", "vivid"]);
  for (const id of ids) {
    const palette = palettes.CLASSIFICATION_PALETTE_REGISTRY[id];
    for (const [wing, colors] of [["above", palette.above], ["below", palette.below]]) {
      assert.ok(colors.length > 0, `${id}: ${wing} is non-empty`);
      for (const [index, color] of colors.entries()) {
        assert.match(color, /^#[0-9A-Fa-f]{6}$/, `${id}: ${wing} step ${index + 1}`);
      }
      assert.equal(Object.isFrozen(colors), true, `${id}: ${wing} frozen`);
    }
    assert.match(palette.optimal, /^#[0-9A-Fa-f]{6}$/, `${id}: optimal`);
    assert.match(palette.invalid, /^#[0-9A-Fa-f]{6}$/, `${id}: invalid`);
    assert.equal(Object.isFrozen(palette), true, `${id}: frozen`);
  }
  assert.equal(Object.isFrozen(palettes.CLASSIFICATION_PALETTE_REGISTRY), true);
  assert.equal(palettes.DEFAULT_PALETTE, palettes.CLASSIFICATION_PALETTE_REGISTRY.pastel);
});

// Both shipped palettes have to be usable by the same profile, or "the profile means the
// same thing under either" is not true.
test("the two shipped palettes reach equally far in both directions", () => {
  assert.equal(pastel.above.length, 5);
  assert.equal(pastel.below.length, 5);
  assert.equal(vivid.above.length, pastel.above.length);
  assert.equal(vivid.below.length, pastel.below.length);
});

test("an unknown palette name resolves to nothing rather than to a default", () => {
  assert.equal(palettes.paletteForName("nope"), null);
  assert.equal(palettes.paletteForName(""), null);
  assert.equal(palettes.paletteForName(undefined), null);
});

test("assertPalette() refuses every incomplete shape, naming the path it was given", () => {
  const ok = { below: ["#111111"], optimal: "#222222", above: ["#333333"] };
  const cases = [
    [null, /my_palette must be an object/],
    [["#111111"], /my_palette must be an object/],
    [{ ...ok, optimal: undefined }, /my_palette\.optimal must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, optimal: "red" }, /my_palette\.optimal must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, above: [] }, /my_palette\.above must be a non-empty list of colors, running outwards from the middle/],
    [{ ...ok, below: undefined }, /my_palette\.below must be a non-empty list/],
    [{ ...ok, above: ["#111111", "nope"] }, /my_palette\.above\[2\] must be a 3\/4\/6\/8-digit hex color/],
    [{ ...ok, invalid: "red" }, /my_palette\.invalid must be a 3\/4\/6\/8-digit hex color/],
  ];
  for (const [palette, expected] of cases) {
    assert.throws(() => palettes.assertPalette(palette, "my_palette"), expected, JSON.stringify(palette));
  }
  // A wing step is named 1-based, because a wing is addressed by "steps from optimal"
  // everywhere else and an off-by-one here would send a user to the wrong colour.
  assert.throws(() => palettes.assertPalette({ ...ok, below: ["bad"] }, "palette"), /palette\.below\[1\]/);
});

// The one field a palette may leave out. Nobody should have to invent a colour for a
// state they never see.
test("invalid is optional and completes to a neutral grey", () => {
  const bare = { below: ["#111111"], optimal: "#222222", above: ["#333333"] };
  assert.equal(palettes.completePalette(palettes.assertPalette(bare)).invalid, palettes.NEUTRAL_INVALID_COLOR);
  assert.equal(palettes.completePalette(palettes.assertPalette({ ...bare, invalid: "#abcdef" })).invalid, "#abcdef");
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
  assert.equal(paletteColor.resolveClassificationColor(classification({ source: "entity", deviation: null }), WIDE), "#B4B2A9");
  // Even if something upstream did hand it a distance, the entity branch comes first.
  assert.equal(paletteColor.resolveClassificationColor(classification({ source: "entity" }), WIDE), "#B4B2A9");
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
