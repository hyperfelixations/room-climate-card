// The card's own colour ramp — the one every built-in profile has always shown.
//
// A palette is a DIVERGING scale with a middle, which is what a climate reading needs:
// there is a right value, and two ways of being wrong about it. `optimal` is that middle,
// `above` runs outwards from it towards "too much" and `below` outwards towards "too
// little". Both wings are listed FROM THE CENTRE OUT, so `above[0]` is one step off
// optimal and `above[4]` is as far as this palette goes.
//
// Splitting the ramp this way rather than writing one flat list is not cosmetic. The
// middle is the only position whose meaning is fixed, and a flat list would have to carry
// its index alongside — a second number that can disagree with the first. Here it cannot.
//
// Five steps per wing is what the card's own profiles need, not a limit. A palette may
// have wings of any length, and of DIFFERENT lengths: more resolution towards "too much"
// than towards "too little" is a legitimate thing to want, and costs nothing to express.

// `tunedFor: "dark"` records where this ramp is at its best. Its colours are soft, which
// reads as calm against a dark card and as slightly washed out against a light one.
// Nothing acts on that yet — see PALETTE_TUNINGS in registry.js.

export const pastel = {
  id: "pastel",
  tunedFor: "dark",
  optimal: "#79A86C",
  above: ["#9DA85A", "#C0A752", "#C98A67", "#C67277", "#B85F67"],
  below: ["#69A78B", "#67A7AE", "#76A0C0", "#8192C8", "#8A88C9"],
  invalid: "#B4B2A9",
};
