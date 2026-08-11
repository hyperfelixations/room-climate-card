"use strict";

// The colour layer: which palettes exist, how a tier's position becomes a colour, and
// in what ORDER a classification is asked for one.
//
// The order is the part worth testing hardest. Two of its steps exist because getting
// them wrong is invisible — an entity-classified value quietly taking a ramp colour it
// has no relation to, an impossible reading quietly taking the ramp's first colour
// because it happens to carry score 1 — and both would look like a working card.
//
// The characterization at the bottom is the regression proof for the whole change: every
// tier of every built-in profile, against the hex values the card shipped before it had
// palettes at all.

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
    assert.ok(palette.ramp.length > 0, `${id}: non-empty ramp`);
    for (const [index, color] of palette.ramp.entries()) {
      assert.match(color, /^#[0-9A-Fa-f]{6}$/, `${id}: ramp position ${index + 1}`);
    }
    assert.match(palette.invalid, /^#[0-9A-Fa-f]{6}$/, `${id}: invalid`);
    assert.equal(Object.isFrozen(palette), true, `${id}: frozen`);
  }
  assert.equal(Object.isFrozen(palettes.CLASSIFICATION_PALETTE_REGISTRY), true);
  assert.equal(palettes.DEFAULT_PALETTE, palettes.CLASSIFICATION_PALETTE_REGISTRY.pastel);
});

// Both shipped palettes have to be usable by the same profile, or "the profile means the
// same thing under either" is not true.
test("the two shipped palettes have the same number of positions", () => {
  assert.equal(pastel.ramp.length, 11);
  assert.equal(vivid.ramp.length, pastel.ramp.length);
});

test("an unknown palette name resolves to nothing rather than to a default", () => {
  assert.equal(palettes.paletteForName("nope"), null);
  assert.equal(palettes.paletteForName(""), null);
  assert.equal(palettes.paletteForName(undefined), null);
});

test("assertPalette() refuses every incomplete shape, naming the path it was given", () => {
  const cases = [
    [null, /my_palette must be an object/],
    [{ ramp: [], invalid: "#ffffff" }, /my_palette\.ramp must be a non-empty list/],
    [{ invalid: "#ffffff" }, /my_palette\.ramp must be a non-empty list/],
    [{ ramp: ["#ffffff", "nope"], invalid: "#ffffff" }, /my_palette\.ramp\[2\] must be a 3\/4\/6\/8-digit hex color/],
    [{ ramp: ["#ffffff"] }, /my_palette\.invalid must be a 3\/4\/6\/8-digit hex color/],
    [{ ramp: ["#ffffff"], invalid: "red" }, /my_palette\.invalid must be a 3\/4\/6\/8-digit hex color/],
  ];
  for (const [palette, expected] of cases) {
    assert.throws(() => palettes.assertPalette(palette, "my_palette"), expected, JSON.stringify(palette));
  }
  // The position in the message is 1-based, because a ramp is addressed by position
  // everywhere else and an off-by-one here would send a user to the wrong colour.
  assert.throws(
    () => palettes.assertPalette({ ramp: ["bad", "#ffffff"], invalid: "#ffffff" }, "palette"),
    /palette\.ramp\[1\]/
  );
});

// -------------------------------------------------------- rank mapping ----

const RAMP3 = { id: "three", ramp: ["#000001", "#000002", "#000003"], invalid: "#999999" };

test("without a declared scale, a position is taken literally", () => {
  for (const [position, expected] of [[1, "#000001"], [2, "#000002"], [3, "#000003"]]) {
    assert.equal(paletteColor.rampIndexFor({ rampPosition: position, declaredPositions: null }, RAMP3), position - 1);
  }
});

// The refusal to guess. A profile with positions 1..5 could mean the lowest five colours
// or five spread over the whole ramp, and nothing in the profile says which — so the
// card says so instead of picking one.
test("a position the palette does not have is an error naming both numbers", () => {
  assert.throws(
    () => paletteColor.rampIndexFor({ rampPosition: 7, declaredPositions: null }, RAMP3, "the profile"),
    /the profile sits at ramp position 7, but the palette has 3 colors/
  );
  assert.throws(
    () => paletteColor.rampIndexFor({ rampPosition: 2, declaredPositions: null }, { ramp: ["#abcdef"], invalid: "#000000" }),
    /palette has 1 color —/,
  );
});

test("a position that is not a whole number of 1 or more is refused, not rounded", () => {
  for (const position of [0, -1, 2.5, null, undefined, NaN, "3"]) {
    assert.throws(
      () => paletteColor.rampIndexFor({ rampPosition: position, declaredPositions: null }, RAMP3),
      /needs a whole ramp position of 1 or more/,
      JSON.stringify(String(position))
    );
  }
});

test("a declared scale stretches the ramp across it, deterministically", () => {
  // 20 positions over 11 colours: both ends pinned, the rest spread evenly.
  const table = [
    [1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 4], [7, 4], [8, 5], [9, 5], [10, 6],
    [11, 6], [12, 7], [13, 7], [14, 8], [15, 8], [16, 9], [17, 9], [18, 10], [19, 10], [20, 11],
  ];
  for (const [position, expectedRank] of table) {
    assert.equal(
      paletteColor.rampIndexFor({ rampPosition: position, declaredPositions: 20 }, pastel) + 1,
      expectedRank,
      `position ${position} of 20`
    );
  }
  // Six positions over eleven colours: still both ends, still even.
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((p) => paletteColor.rampIndexFor({ rampPosition: p, declaredPositions: 6 }, pastel) + 1),
    [1, 3, 5, 7, 9, 11]
  );
  // And the identity case has to survive being declared explicitly.
  assert.deepEqual(
    [1, 6, 11].map((p) => paletteColor.rampIndexFor({ rampPosition: p, declaredPositions: 11 }, pastel) + 1),
    [1, 6, 11]
  );
});

test("a declared scale clamps rather than throwing, and a one-colour palette collapses", () => {
  assert.equal(paletteColor.rampIndexFor({ rampPosition: 99, declaredPositions: 20 }, RAMP3), 2);
  const single = { ramp: ["#abcdef"], invalid: "#000000" };
  for (const position of [1, 4, 9]) {
    assert.equal(paletteColor.rampIndexFor({ rampPosition: position, declaredPositions: 9 }, single), 0);
  }
});

// ---------------------------------------------------- resolution order ----

function classification(overrides) {
  return {
    source: "builtin",
    invalid: false,
    explicitColor: null,
    rampPosition: 2,
    declaredPositions: null,
    ...overrides,
  };
}

test("an entity-classified value never takes a ramp colour, whatever score it carries", () => {
  // The trap: an integration supplies value_score but no value_color. That score is a
  // number on the integration's own scale and means nothing in the card's palette.
  assert.equal(
    paletteColor.resolveClassificationColor(
      classification({ source: "entity", rampPosition: null, explicitColor: null }),
      RAMP3
    ),
    "#B4B2A9"
  );
  // Even if something upstream did hand it a position, the entity branch comes first.
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ source: "entity", rampPosition: 1 }), RAMP3),
    "#B4B2A9"
  );
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ source: "entity", explicitColor: "#123456" }), RAMP3),
    "#123456"
  );
});

test("an invalid reading takes the palette's invalid colour, never the ramp", () => {
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ invalid: true, rampPosition: null }), RAMP3),
    "#999999"
  );
  // Position 1 present AND invalid: invalid still wins, which is the whole point.
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ invalid: true, rampPosition: 1 }), RAMP3),
    "#999999"
  );
  // A profile that names its own invalid colour keeps it.
  assert.equal(
    paletteColor.resolveClassificationColor(classification({ invalid: true, explicitColor: "#abcabc" }), RAMP3),
    "#abcabc"
  );
});

test("an explicit tier colour beats the palette, and only then does the ramp apply", () => {
  assert.equal(paletteColor.resolveClassificationColor(classification({ explicitColor: "#fedcba" }), RAMP3), "#fedcba");
  assert.equal(paletteColor.resolveClassificationColor(classification({ rampPosition: 3 }), RAMP3), "#000003");
});

// ---------------------------------------------- built-in characterization --

// The colours the card shipped before palettes existed, by ramp position. Recorded from
// the profile sources as they were, so this is evidence rather than a restatement of the
// ramp it checks.
const SHIPPED_BY_POSITION = {
  1: "#8A88C9",
  2: "#8192C8",
  3: "#76A0C0",
  4: "#67A7AE",
  5: "#69A78B",
  6: "#79A86C",
  7: "#9DA85A",
  8: "#C0A752",
  9: "#C98A67",
  10: "#C67277",
  11: "#B85F67",
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
          SHIPPED_BY_POSITION[tier.score],
          `${kind}/${id} ${tier.levelKey} (position ${tier.score})`
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
    assert.notEqual(bold, soft, `position ${tier.score} must actually change`);
    assert.match(bold, /^#[0-9A-Fa-f]{6}$/);
    seen.add(bold);
  }
  assert.equal(seen.size, profile.tiers.length, "eleven tiers, eleven distinct colours");
});
