// Classifying a numeric reading against a profile.
//
// Returns TOKENS, never rendered text: a built-in tier carries a `levelKey` that
// the presentation layer translates, while a custom profile carries a `level`
// string the user wrote and that must stay verbatim. Both are returned as they
// are and the caller picks — `level || t(levelKey)` — so translation stays out of
// the domain entirely.
//
// It returns no finished COLOUR either, for the same reason. What a tier knows is
// where it sits — an explicit colour the profile named, or a position on a ramp
// whose colours the card's palette owns. Turning that into a hex value is
// palette-color.js's job, and keeping the two apart is what lets one profile be
// shown in two palettes without saying anything twice.
//
// The profile handed in must already be projected into the unit the value is
// expressed in; comparing a Fahrenheit reading against Celsius thresholds is the
// one mistake this whole layer is built to prevent.

// What a profile that declares no invalid classification of its own falls back to.
// Deliberately colourless: "no judgement is possible here" is a statement the palette
// answers, not this file.
const FALLBACK_INVALID = {
  score: null,
  levelKey: "level.invalidReading",
  zone: "invalid",
};

// First tier whose threshold the value passes, using the profile's own
// comparison operator. ">=" makes a boundary belong to the tier above it, ">"
// makes it belong to the tier below — PM2.5 uses the latter so a reading of
// exactly 5 is still optimal.
export function selectTier(profile, value) {
  return profile.tiers.find((candidate) => (profile.comparison === ">" ? value > candidate.min : value >= candidate.min));
}

export function classifyNumericValue(profile, value) {
  if (profile.invalidWhen?.(value)) {
    const invalid = profile.invalidClassification || FALLBACK_INVALID;
    return {
      level: invalid.level || null,
      levelKey: invalid.levelKey,
      score: invalid.score ?? null,
      zone: invalid.zone ?? "invalid",
      explicitColor: invalid.color || null,
      // An impossible reading has no place ON the scale, so it gets no position on the
      // ramp — whatever score it happens to carry. Reading position 1 out of a score
      // that only ever meant "lowest tier" would paint an unusable value in the ramp's
      // own colour, which is precisely the wrong impression.
      rampPosition: null,
      declaredPositions: null,
      invalid: true,
    };
  }
  const tier = selectTier(profile, value);
  const explicitColor = tier.color || null;
  return {
    level: tier.level || null,
    levelKey: tier.levelKey,
    score: tier.score ?? null,
    zone: tier.zone ?? null,
    explicitColor,
    // A tier that named its own colour needs no position, and is therefore not held to
    // the position rules either — that is what keeps every custom profile written before
    // palettes existed valid unchanged.
    rampPosition: explicitColor ? null : tier.score ?? null,
    declaredPositions: explicitColor ? null : profile.positions ?? null,
    invalid: false,
  };
}
