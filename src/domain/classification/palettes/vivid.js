// Saturated alternative to `pastel` for dashboards where the soft ramp reads as washed out.
// Same middle and same hue journey — a change of intensity, not of meaning.
//
// Names no `invalid`; completePalette() fills in NEUTRAL_COLOR (interne Doku §5 „Farbpaletten").
// The deepest blue stops at L* 42: any darker drops below the dark-card contrast every
// shipped palette must hold.

export const vivid = {
  id: "vivid",
  optimal: "#17A93F",
  above: ["#7EB018", "#CBA30A", "#E5811A", "#E1552A", "#CC2B2B"],
  below: ["#0DA97E", "#06A5B4", "#128FD1", "#1F6FD6", "#3B58CF"],
};
