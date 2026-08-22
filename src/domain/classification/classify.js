// Classifying a numeric reading against a profile.
//
// Returns TOKENS, never rendered text: a built-in tier carries a `levelKey` that
// the presentation layer translates, while a custom profile carries a `level`
// string the user wrote and that must stay verbatim. Both are returned as they
// are and the caller picks — `level || t(levelKey)` — so translation stays out of
// the domain entirely.
//
// It returns no finished COLOUR either, for the same reason. What a tier knows is
// where it sits — an explicit colour the profile named, or how far it is from optimal
// on a scale the profile owns. Turning that into a hex value is palette-color.js's job,
// and keeping the two apart is what lets one profile be shown in any palette without
// saying anything twice.
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

// How far this profile reaches in each direction, counted in tiers away from optimal.
//
// Only tiers that take their colour from the palette count. A tier that named its own
// colour is not on the ramp at all, and its `score` is under no obligation to be a
// distance — that freedom is what keeps every profile written before palettes existed
// valid. A one-sided profile such as CO2 simply reaches 0 downwards, which is not a
// special case anywhere: nothing ever asks its `below` wing for a colour.
export function deviationSpanOf(profile) {
  let above = 0;
  let below = 0;
  for (const tier of profile.tiers) {
    if (tier.color) continue;
    const score = tier.score;
    if (!Number.isInteger(score)) continue;
    if (score > above) above = score;
    if (-score > below) below = -score;
  }
  return { above, below };
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
      // An impossible reading is not a distance from optimal — it is off the scale
      // entirely. Reading its score as a distance would paint an unusable value in a
      // ramp colour, which is precisely the wrong impression.
      deviation: null,
      deviationSpan: null,
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
    // A tier that named its own colour needs no distance, and is therefore not held to
    // the distance rules either.
    deviation: explicitColor ? null : tier.score ?? null,
    deviationSpan: explicitColor ? null : deviationSpanOf(profile),
    invalid: false,
  };
}
