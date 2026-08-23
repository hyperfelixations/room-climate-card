// The palette for colour vision deficiency — all of it, in one ramp.
//
// WHY THE CARD'S OWN RAMP FAILS. The default ramp runs green in the middle to red at the
// top, and green against red is exactly the pair red-green deficiency loses: measured
// with the simulation in test/helpers/color-vision.js, an equiluminant red and green fall
// from a distance of 43 to 3 for a deuteranope. "Optimal" and "critical" become the same
// colour, which is the worst thing a climate card can do. That deficiency is about 99 %
// of all colour blindness — deutan ≈ 2,96 %, protan ≈ 1,05 % of the population, roughly
// one man in twelve — and tritan, the rarer blue-yellow form, ≈ 0,03 %.
//
// WHAT REPLACES IT: blue against olive-gold, with a near-neutral middle. The middle has to
// sit between the two poles of whichever axis survives, and anything more colourful there
// would lean towards one end and shrink the distance to it.
//
// ONE PALETTE FOR ALL THREE, and that is a measurement rather than a convenience. Protan
// and deutan confuse the same colours and differ only in how bright they perceive long
// wavelengths, so they were always going to share a design. Tritan was expected to need
// its own — and does not. A search over 36 hue pairs crossed with lightness and chroma
// schedules, about three thousand candidates that cleared every acceptance criterion,
// picked the SAME winner for both targets independently: blue 260° against olive 104° in
// Oklch. In hindsight it is not surprising. This axis avoids red and green, which is what
// protan and deutan need, and it is not the yellow-blue axis either, which is what tritan
// needs; there is not much room left, and this is what is in it.
//
// Measured under every way of seeing (classification-palettes.test.js pins these):
//
//                middle -> coldest   middle -> hottest   end to end
//   normal              41                  34              62
//   protanope           41                  34              65
//   deuteranope         43                  33              67
//   tritanope           45                  33              70
//
// Contrast holds at 2,48 : 1 on a light card and 2,61 : 1 on a dark one, in every one of
// those simulations rather than only for normal vision — a palette for people who see
// colour differently has to be measured as they see it.
//
// NOT CLAIMED: that all eleven steps are individually distinguishable. With one hue axis
// gone and a lightness band of L* 40-68 to work in — these colours are foreground on a
// light card AND a dark one — that is not reachable. The level text carries the fine
// detail; the colour carries the judgement.

export const colorVision = {
  id: "color-vision",
  tunedFor: "any",
  // Every name a user is likely to reach for, because they will search by their own
  // diagnosis and not by ours. `tritan` resolving here is deliberate and measured (above),
  // not a leftover.
  aliases: ["protan-deutan", "protan", "deutan", "tritan"],
  optimal: "#A5A59E",
  above: ["#9A9878", "#8F8A51", "#847C1B", "#766E00", "#676000"],
  below: ["#8699B9", "#6A8DC5", "#4E7FD0", "#2E6FDB", "#005DE0"],
};
