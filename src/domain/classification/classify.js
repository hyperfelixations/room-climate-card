// Classifying a numeric reading against a profile.
//
// Returns TOKENS, never rendered text and never a finished colour: a tier carries
// `levelKey`/`level` (caller picks `level || t(levelKey)`) and either an explicit colour
// or a signed distance from optimal, which palette-color.js turns into a hex.
//
// The profile handed in must already be projected into the unit the value is expressed
// in — a Fahrenheit reading against Celsius thresholds is the mistake this layer prevents.

// Fallback when a profile declares no invalid classification of its own. Colourless: the
// palette answers "no judgement is possible here".
const FALLBACK_INVALID = {
  score: null,
  levelKey: "level.invalidReading",
  zone: "invalid",
};

// First tier whose threshold the value passes, using the profile's own comparison
// operator (">=" keeps a boundary in the tier that names it; ">" is a YAML-only choice).
//
// PARTIAL: under `>` the open-ended final tier sits at -Infinity, and nothing is strictly
// above -Infinity, so a reading of -Infinity returns no tier. Callers handle undefined.
export function selectTier(profile, value) {
  return profile.tiers.find((candidate) => (profile.comparison === ">" ? value > candidate.min : value >= candidate.min));
}

// How far this profile reaches each direction, in tiers away from optimal. Only colourless
// tiers count — a tier that names its own colour is not on the ramp and its `score` need
// not be a distance. A one-sided profile just reaches 0 downwards; no special case.
export function deviationSpanOf(profile) {
  let above = 0;
  let below = 0;
  for (const tier of profile.tiers) {
    if (tier.color) continue;
    const score = tier.score;
    if (!Number.isInteger(score)) continue;
    above = Math.max(above, score);
    below = Math.max(below, -score);
  }
  return { above, below };
}

export function classifyNumericValue(profile, value) {
  const tier = selectTier(profile, value);
  // Two ways to have no classification, one answer: the profile calls the value impossible,
  // or no tier covers it (only a `>` profile at -Infinity — see selectTier; no finite
  // reading is affected). Both mean "no place on this ramp for this number".
  if (profile.invalidWhen?.(value) || tier === undefined) {
    const invalid = profile.invalidClassification || FALLBACK_INVALID;
    return {
      level: invalid.level || null,
      levelKey: invalid.levelKey,
      score: invalid.score ?? null,
      zone: invalid.zone ?? "invalid",
      explicitColor: invalid.color || null,
      // An impossible reading is off the scale, not a distance from optimal — no ramp colour.
      deviation: null,
      deviationSpan: null,
      invalid: true,
    };
  }
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
