// Refrigerator temperature. An appliance, not a room.
//
// A classification profile is one atomic semantic unit: tiers with their
// thresholds, score and zone, the comfort/optimal/scale bands, physical
// validity, and the profile-specific icons. Everything that has to stay
// coherent for a reading to be judged consistently lives here together;
// unit conversion is deliberately separate (see ../../../metrics/definitions.js).
//
// It names no colours. `score` IS the tier's position on the card's colour ramp, and
// which colours sit at those positions is the palette's decision, not the profile's --
// which is what lets the same profile be shown in any palette without restating itself.
// See ../../palettes/registry.js.
//
// Values are product decisions, not implementation details. Do not round,
// reorder or "tidy" them without a documented reason.

// Appliance profile, not a room: target band follows common food-
// safety guidance (e.g. FDA/EU "at or below 5 C", ideal ~3-4 C) —
// the internationally cited "danger zone" for holding food starts
// at 8 C, so the tiers widen that headroom on the warm side, the
// direction that actually risks spoilage. anchorScale stays at its
// default (true, unlike outdoor): a fridge's normal operating band
// is narrow and well-defined by the compressor's own cycling, so a
// fixed reference axis is more useful here than one that floats
// with every door-open spike.
export const fridge = {
  id: "fridge",
  metricKind: "temperature",
  comparison: ">=",
  tiers: [
    { min: 12, score: 11, levelKey: "level.veryHot", zone: "outside" },
    { min: 10, score: 10, levelKey: "level.hot", zone: "outside" },
    { min: 8, score: 9, levelKey: "level.veryWarm", zone: "outside" },
    { min: 6, score: 8, levelKey: "level.warm", zone: "outside" },
    { min: 5, score: 7, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: 3, score: 6, levelKey: "level.optimal", zone: "optimal" },
    { min: 1, score: 5, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: 0, score: 4, levelKey: "level.fresh", zone: "outside" },
    { min: -2, score: 3, levelKey: "level.cool", zone: "outside" },
    { min: -4, score: 2, levelKey: "level.cold", zone: "outside" },
    { min: -Infinity, score: 1, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: 1, max: 6 },
  optimal: { min: 3, max: 5 },
  scale: { min: 0, max: 8 },
  step: 1,
  iconTiers: [
    { min: 12, icon: "mdi:fire-alert" },
    { min: 10, icon: "mdi:thermometer-high" },
    { min: 1, icon: "mdi:thermometer" },
    { min: -2, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};
