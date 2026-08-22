// A saturated alternative to the card's own ramp, for dashboards where the pastel
// colours read as washed out — on a bright wall panel, or next to strongly coloured
// cards that make a soft ramp look faded.
//
// Same middle and the same journey through the hues, so a profile written for one
// palette means the same thing under the other: it is a change of intensity, not of
// meaning.
//
// `invalid` is a plain grey rather than the warm one the pastel ramp uses: beside
// saturated colours a warm grey reads as a faded ramp colour, which is exactly the wrong
// impression for a reading that has no place on the scale at all.

export const vivid = {
  id: "vivid",
  optimal: "#17A93F",
  above: ["#7EB018", "#CBA30A", "#E5811A", "#E1552A", "#CC2B2B"],
  below: ["#0DA97E", "#06A5B4", "#128FD1", "#1F6FD6", "#2A4FC4"],
  invalid: "#8A8A8A",
};
