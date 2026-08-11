// The card's own colour ramp — the one every built-in profile has always shown.
//
// A palette is a RAMP, not a set of judgements. Position 1 is one end of the scale and
// position 11 the other; what those ends MEAN is the profile's business. For temperature
// position 1 is the coldest tier, for humidity the driest, for CO2 the cleanest air —
// the same eleven colours, read against three different scales.
//
// Eleven is the number the card's own profiles need, not a limit. A palette may declare
// any number of positions; see registry.js for what a palette has to satisfy.
//
// `invalid` is not part of the ramp. A physically impossible reading has no position on
// a scale of "how good is this" — it is off the scale entirely — and colouring it from
// the ramp would make an unusable reading look like a judgement.

export const pastel = {
  id: "pastel",
  ramp: [
    "#8A88C9",
    "#8192C8",
    "#76A0C0",
    "#67A7AE",
    "#69A78B",
    "#79A86C",
    "#9DA85A",
    "#C0A752",
    "#C98A67",
    "#C67277",
    "#B85F67",
  ],
  invalid: "#B4B2A9",
};
