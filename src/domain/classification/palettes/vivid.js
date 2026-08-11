// A saturated alternative to the card's own ramp, for dashboards where the pastel
// colours read as washed out — on a bright wall panel, or next to strongly coloured
// cards that make a soft ramp look faded.
//
// Same eleven positions and the same journey through the hues, so a profile written for
// one palette means the same thing under the other: it is a change of intensity, not of
// meaning. The middle of the ramp stays the unambiguous green, because that is the
// position every built-in profile puts its optimal tier at.
//
// `invalid` is a plain grey rather than the warm one the pastel ramp uses: beside
// saturated colours a warm grey reads as a faded ramp colour, which is exactly the wrong
// impression for a reading that has no position on the scale at all.

export const vivid = {
  id: "vivid",
  ramp: [
    "#2A4FC4",
    "#1F6FD6",
    "#128FD1",
    "#06A5B4",
    "#0DA97E",
    "#17A93F",
    "#7EB018",
    "#CBA30A",
    "#E5811A",
    "#E1552A",
    "#CC2B2B",
  ],
  invalid: "#8A8A8A",
};
