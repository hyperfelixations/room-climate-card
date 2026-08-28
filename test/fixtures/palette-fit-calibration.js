"use strict";

// THE CALIBRATION TABLE for "can this colour be seen on this background".
//
// The card decides whether to leave a palette alone or transform it, and that decision
// rests on one threshold. A threshold picked by taste is not defensible and cannot be
// argued with later, so this file states the judgements the threshold has to reproduce —
// each one a colour, a background, a verdict, and the reason.
//
// HOW TO USE IT. palette-fit.test.js runs every pair through the card's own instrument and
// requires the verdicts to come out right. If a future change to the instrument breaks a
// row, the question is which of the two is wrong — and the row says what a person actually
// sees, so usually it is the instrument.
//
// HOW IT WAS CHECKED. Every borderline pair below is rendered as a swatch by
// test/browser/visual/palette-fit-calibration.spec.js and was looked at. A visibility claim nobody
// has looked at is not a claim.
//
// REVIEWED, AND THE VERDICTS HOLD. Every row below was looked at in the rendered swatches.
// The tightest visible pair is legible, the widest invisible pair is not, and nothing in
// between is misfiled.
//
// One note for whoever looks next, so a correct table is not doubted: `#000000` on `#1C1C1C`
// reads slightly better in a PNG than on a real screen, because an image has perfect black
// levels and a panel in a lit room does not — light from the room lifts both towards each
// other. That is the effect screenDistance() models with its flare term and the one WCAG
// models with the +0.05 in its contrast ratio, which puts this pair at 1.15 : 1. Even in the
// image it is the dimmest text on the page and plainly worse than the row above it, so the
// verdict is right either way. Judge it on a screen rather than on the file.
//
// HOW TO CHANGE A VERDICT. Change the row, with its reason. That is the point of the file:
// the product decision lives here, in one readable place, and the algorithm does not have
// to be touched to overrule it.

// Pairs a person can see apart. The palette step stays as written.
const VISIBLE = [
  ["#000000", "#FFFFFF", "black on white — the easiest case there is"],
  ["#000000", "#E0E0E0", "black on light grey"],
  ["#000000", "#ADD8E6", "black on a light blue card — the palette: black case that must survive"],
  ["#FFFF00", "#1C1C1C", "yellow on the dark card — palette: yellow must give yellow"],
  ["#FF0000", "#808080", "saturated red on mid grey: no lightness difference to speak of, and unmistakable"],
  ["#0000FF", "#FFFFFF", "pure blue on white"],
  ["#2F4F4F", "#000000", "dark slate grey on black — dark, but not the same dark"],
  ["#FFFFFF", "#808080", "white on mid grey"],
  ["#684800", "#FFFFFF", "dark amber on white — the warm end of the colour-vision ramp"],
  ["#688000", "#1C1C1C", "olive on the dark card"],
  ["#B1B1B1", "#1C1C1C", "the pale end of a black ramp on the dark card"],
  ["#575757", "#1C1C1C", "a mid-grey step on the dark card — dim, and still legible"],
  ["#67A7AE", "#FFFFFF", "the pastel ramp's coldest step on white"],
  ["#9C5300", "#FFFFFF", "the colour-vision ramp's hottest step on white"],
  ["#4A5CE0", "#FFFFFF", "the colour-vision ramp's coldest step on white"],
];

// Pairs that collide. The palette has to be transformed, because a value painted in this
// colour would be a value nobody can read.
const INVISIBLE = [
  ["#FFFFFF", "#FFFFFF", "white on white"],
  ["#FFFFFF", "#FAFAFA", "white on off-white"],
  ["#FFFFFF", "#F1F1F1", "white on Home Assistant's secondary light background"],
  ["#F6F8D0", "#FFFFFF", "the palest step of a yellow ramp on white — the palette: yellow + light case"],
  ["#F9FBA7", "#FFFFFF", "the next step in, still on white"],
  ["#000000", "#1C1C1C", "black on the dark card — the palette: black + dark case"],
  ["#000000", "#111111", "black on a near-black card"],
  ["#0C0C0C", "#1C1C1C", "the deepest step of a black ramp on the dark card"],
  ["#000080", "#1C1C1C", "navy on the dark card — the dark-blue + dark-mode case"],
  ["#00004E", "#1C1C1C", "the deepest step of a navy ramp on the dark card"],
  ["#808080", "#808080", "a colour on itself"],
  ["#7D7D7D", "#808080", "the neutral invalid colour on a mid-grey card"],
  ["#A2B1D0", "#ADD8E6", "the palest step of a navy ramp on a light blue card"],
];

// The pairs whose verdict is closest to the line, and therefore the ones worth looking at.
// Rendered side by side by the browser spec.
const BORDERLINE = [
  ["#575757", "#1C1C1C", "visible", "the tightest visible pair in the table"],
  ["#000080", "#1C1C1C", "invisible", "the widest invisible pair in the table"],
  ["#000000", "#ADD8E6", "visible", "black on light blue — must stay visible or palette: black breaks"],
  ["#A2B1D0", "#ADD8E6", "invisible", "the same ramp's pale end on the same card"],
  ["#F6F8D0", "#FFFFFF", "invisible", "pale yellow on white"],
  ["#FF0000", "#808080", "visible", "chroma alone carrying the difference"],
];

module.exports = { VISIBLE, INVISIBLE, BORDERLINE };
