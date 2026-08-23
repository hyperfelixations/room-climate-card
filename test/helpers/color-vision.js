"use strict";

// Colour-vision-deficiency simulation, and the perceptual distance it is measured with.
//
// This is a MEASURING INSTRUMENT, and it lives in the test suite rather than in a
// scratch file for one reason: a palette that claims to work for colour-blind users has
// to keep claiming it. Every future edit to a palette is checked against this.
//
// METHOD. Viénot, Brettel & Mollon (1999): convert to the LMS cone space, project onto
// the plane the dichromat can still see, convert back. The published plane coefficients
// below belong to the SMITH-POKORNY LMS space and only to it — pairing them with a
// different LMS matrix silently breaks the one invariant that makes the whole thing a
// simulation rather than a colour shift, which is why assertNeutralAxisPreserved() below
// exists and why the tool's own tests run before any palette is measured against it.
//
// The inverse matrix is COMPUTED, not copied. Transcribing nine more numbers is exactly
// the kind of thing that goes wrong quietly.
//
// Sources: Viénot, Brettel & Mollon (1999), "Digital video colourmaps for checking the
// legibility of displays by dichromats"; matrix as tabulated in DaltonLens's write-up
// "Understanding LMS-based Color Blindness Simulations".

const DEFICIENCIES = ["protan", "deutan", "tritan"];

// linear sRGB -> Smith-Pokorny LMS.
const RGB_TO_LMS = [
  [17.8824041, 43.5161087, 4.1193531],
  [3.4556423, 27.1554478, 3.8671123],
  [0.02996581, 0.18430022, 1.46708614],
];

// The plane each dichromat's vision collapses onto. Each rebuilds the missing cone's
// response from the two that remain.
const PROJECTIONS = {
  protan: (lms) => [2.02344 * lms[1] - 2.52581 * lms[2], lms[1], lms[2]],
  deutan: (lms) => [lms[0], 0.494207 * lms[0] + 1.24827 * lms[2], lms[2]],
  tritan: (lms) => [lms[0], lms[1], -0.395913 * lms[0] + 0.801109 * lms[1]],
};

// ---- small linear algebra, so no second copy of any matrix exists -----------

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || det === 0) throw new Error("matrix is not invertible");
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const LMS_TO_RGB = invert3(RGB_TO_LMS);
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

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
  return `#${linear.map((c) => Math.round(clamp01(toEncoded(c)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// Projecting onto a dichromat plane routinely lands OUTSIDE sRGB, most often for
// saturated blues. Clamping each channel on its own is what a quick implementation does,
// and it is wrong for measurement: it moves the colour sideways in hue and so inflates
// or deflates the very distances this file exists to compute. Desaturating towards the
// colour's own luminance instead keeps both its luminance and its direction, and gives
// up only the chroma a display could not have shown anyway.
function intoGamut(linear) {
  const luminance = clamp01(0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]);
  const fits = (t) => linear.every((c) => {
    const v = luminance + (c - luminance) * t;
    return v >= -1e-9 && v <= 1 + 1e-9;
  });
  if (fits(1)) return linear;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return linear.map((c) => luminance + (c - luminance) * lo);
}

// What someone with the given deficiency sees. "normal" is the identity, so a caller can
// sweep all four without a special case.
function simulate(hex, deficiency) {
  if (deficiency === "normal") return typeof hex === "string" ? hex.toUpperCase() : hex;
  const project = PROJECTIONS[deficiency];
  if (!project) throw new Error(`unknown deficiency "${deficiency}"`);
  return linearToHex(intoGamut(apply(LMS_TO_RGB, project(apply(RGB_TO_LMS, hexToLinear(hex))))));
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
  const lightness = ramp.map((hex) => lab(hex)[0]);
  return {
    deficiency,
    // How far the two extremes sit from the middle — the claim a diverging palette makes.
    lowWing: fromMiddle[0],
    highWing: fromMiddle[seen.length - 1],
    ends: deltaE(seen[0], seen[seen.length - 1]),
    monotone,
    onLight: Math.min(...ramp.map((hex) => contrastRatio(hex, LIGHT_CARD))),
    onDark: Math.min(...ramp.map((hex) => contrastRatio(hex, DARK_CARD))),
    lightnessRange: [Math.min(...lightness), Math.max(...lightness)],
  };
}

// The invariant that separates a simulation from an arbitrary colour transform: a colour
// on the neutral axis has no hue to lose, so every dichromat sees it unchanged. Exported
// because it is the check that would have caught the broken matrix pairing immediately.
function neutralAxisError(deficiency) {
  let worst = 0;
  for (const grey of [0.02, 0.1, 0.25, 0.5, 0.75, 1]) {
    const lms = apply(RGB_TO_LMS, [grey, grey, grey]);
    const projected = PROJECTIONS[deficiency](lms);
    for (const [i, value] of projected.entries()) {
      worst = Math.max(worst, Math.abs(value - lms[i]) / Math.max(1e-12, Math.abs(lms[i])));
    }
  }
  return worst;
}

module.exports = {
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
