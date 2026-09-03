// The palette for colour vision deficiency: blue-violet against amber, near-neutral middle,
// one ramp for protan, deutan and tritan alike (aliases route all three here, `tritan`
// included — measured, not a leftover).
//
// Derived with a Brettel 1997 dichromacy simulation, now an anchored hex set like any other.
// Derivation and the measured tables: RCC changelog. Reach, separation, order and contrast
// under all four ways of seeing: pinned by classification-palettes.test.js. Rationale:
// see internal dev doc §5 "Die color-vision-Palette".

export const colorVision = {
  id: "color-vision",
  aliases: ["protan-deutan", "protan", "deutan", "tritan"],
  optimal: "#A7A4A1",
  above: ["#A89485", "#A88469", "#A7734B", "#A56227", "#9C5300"],
  below: ["#9098B5", "#7D8CC2", "#6A7ECD", "#596ED7", "#4A5CE0"],
};
