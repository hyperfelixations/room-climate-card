// A traffic light rather than a gradient: green = in place, amber = drifted, red = act.
//
// Two steps per wing by design (see internal dev doc §5 "Farbpaletten"); both wings carry the same
// pair because the message is distance from optimal, not direction. A longer profile collapses
// onto these colours by construction. Neighbouring steps ΔE00 ~49 and ~38; contrast 2,17:1
// light / 4,00:1 dark — pinned by classification-palettes.test.js.
//
// Not measured against colour vision deficiency: green-vs-red is the pair red-green deficiency
// loses, and that is what a traffic light is made of. `color-vision` is the palette for that
// (see internal dev doc §5 "Die color-vision-Palette").

export const signal = {
  id: "signal",
  optimal: "#1DB85D",
  above: ["#FD9808", "#EE2046"],
  below: ["#FD9808", "#EE2046"],
};
