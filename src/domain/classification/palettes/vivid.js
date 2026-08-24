// A saturated alternative to the card's own ramp, for dashboards where the pastel
// colours read as washed out — on a bright wall panel, or next to strongly coloured
// cards that make a soft ramp look faded.
//
// Same middle and the same journey through the hues, so a profile written for one
// palette means the same thing under the other: it is a change of intensity, not of
// meaning.
//
// It names no `invalid` colour of its own and takes the card's neutral grey instead.
// Beside saturated colours a warm grey reads as a faded ramp colour, which is exactly the
// wrong impression for a reading that has no place on the scale at all — and the neutral
// grey is the one measured to hold up on both card backgrounds, so there is nothing left
// for this palette to improve on by naming its own.
//
// The deepest blue is held at L* 42 rather than going darker. Below that it drops under
// the contrast every shipped palette has to keep on a dark card, and a ramp end nobody
// can read on half the dashboards is not a stronger end.
//
// Measured on a light card and a dark one.

export const vivid = {
  id: "vivid",
  optimal: "#17A93F",
  above: ["#7EB018", "#CBA30A", "#E5811A", "#E1552A", "#CC2B2B"],
  below: ["#0DA97E", "#06A5B4", "#128FD1", "#1F6FD6", "#3B58CF"],
};
