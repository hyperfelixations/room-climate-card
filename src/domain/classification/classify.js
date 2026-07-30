// Classifying a numeric reading against a profile.
//
// Returns TOKENS, never rendered text: a built-in tier carries a `levelKey` that
// the presentation layer translates, while a custom profile carries a `level`
// string the user wrote and that must stay verbatim. Both are returned as they
// are and the caller picks — `level || t(levelKey)` — so translation stays out of
// the domain entirely.
//
// The profile handed in must already be projected into the unit the value is
// expressed in; comparing a Fahrenheit reading against Celsius thresholds is the
// one mistake this whole layer is built to prevent.

const FALLBACK_INVALID = {
  score: null,
  levelKey: "level.invalidReading",
  color: "#B4B2A9",
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
      color: invalid.color,
      score: invalid.score ?? null,
      zone: invalid.zone ?? "invalid",
    };
  }
  const tier = selectTier(profile, value);
  return {
    level: tier.level || null,
    levelKey: tier.levelKey,
    color: tier.color,
    score: tier.score ?? null,
    zone: tier.zone ?? null,
  };
}
