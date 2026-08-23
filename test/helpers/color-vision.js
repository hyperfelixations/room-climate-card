"use strict";

// Colour-vision-deficiency simulation, and the perceptual distance it is measured with.
//
// This is a MEASURING INSTRUMENT. It lives in the test suite rather than in a scratch
// file because a palette that claims to work for colour-blind users has to keep claiming
// it: every future edit to a palette is checked against this.
//
// METHOD: Brettel, Viénot & Mollon (1997). A dichromat's reduced gamut is not one plane
// but TWO half-planes hinged on the neutral axis, and which half a colour falls into is
// decided by the sign of its dot product with a separating plane. The widely used Viénot
// 1999 simplification replaces the pair with a single plane; its own authors limit that
// to protanopia and deuteranopia, and for tritanopia it is materially wrong — which is
// exactly the mistake this file used to make.
//
// The twelve matrices and three normals below are the published linear-RGB form from
// libDaltonLens, transcribed verbatim. Two things make the transcription checkable:
// every matrix row sums to 1, which is what keeps the neutral axis fixed, and the fixed
// reference vectors in color-vision-tool.test.js pin the whole pipeline — linearisation,
// half-plane choice, matrix, clipping — against values that did not come from this code.
//
// GAMUT: the reference clips each channel to [0, 1], and so does this. Desaturating
// instead would distort distances less, but it would also make the instrument agree with
// no published implementation, and for an accessibility claim being independently
// reproducible is worth more than the last fraction of a delta.
//
// Sources: Brettel, Viénot & Mollon (1997), "Computerized simulation of color appearance
// for dichromats"; DaltonLens, "Understanding LMS-based Color Blindness Simulations";
// libDaltonLens reference implementation.

const DEFICIENCIES = ["protan", "deutan", "tritan"];

// Two projections and one separating plane per deficiency, all in LINEAR sRGB.
const BRETTEL = {
  protan: {
    first: [0.14980, 1.19548, -0.34528, 0.10764, 0.84864, 0.04372, 0.00384, -0.00540, 1.00156],
    second: [0.14570, 1.16172, -0.30742, 0.10816, 0.85291, 0.03892, 0.00386, -0.00524, 1.00139],
    normal: [0.00048, 0.00393, -0.00441],
  },
  deutan: {
    first: [0.36477, 0.86381, -0.22858, 0.26294, 0.64245, 0.09462, -0.02006, 0.02728, 0.99278],
    second: [0.37298, 0.88166, -0.25464, 0.25954, 0.63506, 0.10540, -0.01980, 0.02784, 0.99196],
    normal: [-0.00281, -0.00611, 0.00892],
  },
  tritan: {
    first: [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.80500, 0.11911],
    second: [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.12320, -0.37562, 1.12767, 0.24796],
    normal: [0.03901, -0.02788, -0.01113],
  },
};

// ---- sRGB ------------------------------------------------------------------

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toEncoded = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * clamp01(c) ** (1 / 2.4) - 0.055);

function hexToLinear(hex) {
  const value = String(hex).replace("#", "").trim();
  const full = value.length === 3 ? value.split("").map((d) => d + d).join("") : value.slice(0, 6);
  return [0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16) / 255));
}

function linearToHex(linear) {
  return `#${linear.map((c) => Math.round(clamp01(toEncoded(clamp01(c))) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// ---- the simulation --------------------------------------------------------

const project = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// What someone with the given deficiency sees. "normal" is the identity, so a caller can
// sweep all four without a special case.
function simulate(hex, deficiency) {
  if (deficiency === "normal") return typeof hex === "string" ? hex.toUpperCase() : hex;
  const params = BRETTEL[deficiency];
  if (!params) throw new Error(`unknown deficiency "${deficiency}"`);
  const linear = hexToLinear(hex);
  const side = linear[0] * params.normal[0] + linear[1] * params.normal[1] + linear[2] * params.normal[2];
  return linearToHex(project(side >= 0 ? params.first : params.second, linear));
}

// ---- CIELAB and CIEDE2000 --------------------------------------------------

function lab(hex) {
  const [r, g, b] = hexToLinear(hex);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIEDE2000. "Can these two be told apart" is a perceptual question, and RGB distance is
// not one; even plain CIE76 misjudges the blue region badly, which is precisely where a
// dichromat palette lives.
function deltaE(hexA, hexB) {
  const [l1, a1, b1] = lab(hexA);
  const [l2, a2, b2] = lab(hexB);
  const avgL = (l1 + l2) / 2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const avgC = (cp1 + cp2) / 2;
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const deg = (Math.atan2(b, a) * 180) / Math.PI;
    return deg >= 0 ? deg : deg + 360;
  };
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  let dh = h2 - h1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (Math.abs(dh) > 180) dh += dh > 0 ? -360 : 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * Math.PI) / 360);
  let avgH;
  if (cp1 * cp2 === 0) avgH = h1 + h2;
  else if (Math.abs(h1 - h2) > 180) avgH = (h1 + h2 + 360) / 2;
  else avgH = (h1 + h2) / 2;
  const t =
    1 -
    0.17 * Math.cos(((avgH - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * avgH * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avgH + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avgH - 63) * Math.PI) / 180);
  const sl = 1 + (0.015 * (avgL - 50) ** 2) / Math.sqrt(20 + (avgL - 50) ** 2);
  const sc = 1 + 0.045 * avgC;
  const sh = 1 + 0.015 * avgC * t;
  const rt =
    -2 *
    Math.sqrt(avgC ** 7 / (avgC ** 7 + 25 ** 7)) *
    Math.sin((60 * Math.exp(-(((avgH - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt(
    ((l2 - l1) / sl) ** 2 + ((cp2 - cp1) / sc) ** 2 + (dH / sh) ** 2 + rt * ((cp2 - cp1) / sc) * (dH / sh)
  );
}

// ---- what the card needs to know about a colour ----------------------------

const relativeLuminance = (hex) => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// The card's colours are foreground on a light card AND on a dark one, which is what
// keeps the usable lightness band narrow. Both are measured, never assumed.
const LIGHT_CARD = "#FFFFFF";
const DARK_CARD = "#1C1C1C";

function contrastRatio(hex, background) {
  const [lighter, darker] = [relativeLuminance(hex), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// A palette read as one continuous ramp: the far end of `below`, inwards to optimal, out
// again along `above`. That is the order a reader's eye travels it.
function asRamp(palette) {
  return [...[...palette.below].reverse(), palette.optimal, ...palette.above];
}

// Everything one palette has to answer for, under one way of seeing.
function measure(palette, deficiency) {
  const ramp = asRamp(palette);
  const seen = ramp.map((hex) => simulate(hex, deficiency));
  const middle = palette.below.length;
  const fromMiddle = seen.map((hex) => deltaE(seen[middle], hex));
  let monotone = true;
  for (let i = middle + 1; i < seen.length; i++) if (fromMiddle[i] <= fromMiddle[i - 1]) monotone = false;
  for (let i = middle - 1; i >= 0; i--) if (fromMiddle[i] <= fromMiddle[i + 1]) monotone = false;
  // The smallest gap between NEIGHBOURS, which is a different question from how far the
  // ends reach and the one a reader actually runs into: a ramp can span a huge distance
  // and still have two adjacent steps nobody can tell apart.
  let minStep = Infinity;
  for (let i = 1; i < seen.length; i++) minStep = Math.min(minStep, deltaE(seen[i - 1], seen[i]));
  const lightness = ramp.map((hex) => lab(hex)[0]);
  return {
    deficiency,
    // How far the two extremes sit from the middle — the claim a diverging palette makes.
    lowWing: fromMiddle[0],
    highWing: fromMiddle[seen.length - 1],
    ends: deltaE(seen[0], seen[seen.length - 1]),
    monotone,
    minStep,
    // Measured on the colours AS SEEN, not as written. A palette for people who see
    // colour differently that was only ever checked against normal vision would be
    // checking the one case it is not for. Under "normal" the two are the same thing.
    onLight: Math.min(...seen.map((hex) => contrastRatio(hex, LIGHT_CARD))),
    onDark: Math.min(...seen.map((hex) => contrastRatio(hex, DARK_CARD))),
    lightnessRange: [Math.min(...lightness), Math.max(...lightness)],
  };
}

// The invariant that separates a simulation from an arbitrary colour transform: a colour
// on the neutral axis has no hue to lose, so every dichromat sees it unchanged. It holds
// here because every matrix row sums to 1 — which is also the cheapest way to verify the
// transcription, and is asserted directly in the tool's own tests.
function neutralAxisError(deficiency) {
  let worst = 0;
  for (const grey of [0.02, 0.1, 0.25, 0.5, 0.75, 1]) {
    const params = BRETTEL[deficiency];
    const side = grey * (params.normal[0] + params.normal[1] + params.normal[2]);
    const seen = project(side >= 0 ? params.first : params.second, [grey, grey, grey]);
    for (const value of seen) worst = Math.max(worst, Math.abs(value - grey) / grey);
  }
  return worst;
}

module.exports = {
  BRETTEL,
  DEFICIENCIES,
  asRamp,
  contrastRatio,
  deltaE,
  lab,
  measure,
  neutralAxisError,
  simulate,
  DARK_CARD,
  LIGHT_CARD,
};
