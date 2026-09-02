// The card's default colour ramp — the colours every built-in profile shows under `pastel`.
//
// Wings run from the centre out: `above[0]` is one step off optimal, `above[4]` the far end.
// Palette shape, wing lengths and how a score maps onto a step: interne Doku §5 „Farbpaletten".
//
// Reads best on a dark card; a note only — the card measures fit against the real background
// (../palette-fit.js), never a palette's own word.

export const pastel = {
  id: "pastel",
  optimal: "#79A86C",
  above: ["#9DA85A", "#C0A752", "#C98A67", "#C67277", "#B85F67"],
  below: ["#69A78B", "#67A7AE", "#76A0C0", "#8192C8", "#8A88C9"],
  invalid: "#B4B2A9",
};
