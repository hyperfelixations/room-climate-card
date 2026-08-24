// The palette for colour vision deficiency — all of it, in one ramp.
//
// WHY THE CARD'S OWN RAMP FAILS. The default ramp runs green in the middle to red at the
// top, and green against red is exactly the pair red-green deficiency loses: measured with
// a Brettel-Viénot-Mollon (1997) dichromacy simulation, an equiluminant red and green fall
// from a distance of 43 to 3 for a deuteranope. "Optimal" and "critical" become the same
// colour, which is the worst thing a climate card can do. That deficiency is about 99 %
// of all colour blindness — deutan ≈ 2,96 %, protan ≈ 1,05 % of the population, roughly
// one man in twelve — and tritan, the rarer blue-yellow form, ≈ 0,03 %.
//
// WHAT REPLACES IT: blue-violet against amber, with a near-neutral middle. The middle has
// to sit between the two poles of whichever axis survives, and anything more colourful
// there would lean towards one end and shrink the distance to it.
//
// ONE PALETTE FOR ALL THREE, and that is a measurement rather than a convenience. Protan
// and deutan confuse the same colours and differ only in how bright they perceive long
// wavelengths, so they were always going to share a design. Tritan was expected to need
// its own; a search over hue pairs crossed with lightness and chroma schedules, scored
// against all three at once, found this axis serves every one of them. In hindsight the
// room is narrow: it has to avoid red against green, which protan and deutan need, while
// not being the yellow-blue axis, which tritan needs.
//
// Measured under every way of seeing, with the Brettel 1997 simulation, at the time these
// colours were chosen. The simulator was a derivation tool and has been removed now that
// the palette is anchored; the full derivation is recorded in the RCC changelog, and
// classification-palettes.test.js keeps the properties an edit could break — reach,
// separation, order and contrast — measured without it.
//
//                middle -> coldest   middle -> hottest   end to end   nearest neighbours
//   normal              37                  33              52               5,5
//   protanope           37                  34              58               5,6
//   deuteranope         34                  31              58               4,0
//   tritanope           31                  32              50               4,5
//
// Contrast held at 2,47 : 1 on a light card and 2,61 : 1 on a dark one in every one of
// those simulations rather than only for normal vision — a palette for people who see
// colour differently had to be measured as they see it.
//
// NOT CLAIMED: that all eleven steps are individually distinguishable. With one hue axis
// gone and a lightness band of L* 40-70 to work in — these colours are foreground on a
// light card AND a dark one — that is not reachable. The level text carries the fine
// detail; the colour carries the judgement.

export const colorVision = {
  id: "color-vision",
  // Every name a user is likely to reach for, because they will search by their own
  // diagnosis and not by ours. `tritan` resolving here is deliberate and measured (above),
  // not a leftover.
  aliases: ["protan-deutan", "protan", "deutan", "tritan"],
  optimal: "#A7A4A1",
  above: ["#A89485", "#A88469", "#A7734B", "#A56227", "#9C5300"],
  below: ["#9098B5", "#7D8CC2", "#6A7ECD", "#596ED7", "#4A5CE0"],
};
