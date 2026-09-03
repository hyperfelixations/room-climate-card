"use strict";

// Colour measurement for the test suite: perceptual distance, relative luminance, contrast,
// and the order in which a palette's colours are read.
//
// A second implementation on purpose: the card computes contrast in
// src/domain/classification/surface.js, and an instrument that imported that could only
// prove the card agrees with itself. The arithmetic here is written out independently; one
// test compares the two.

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
// again along `above` — the order a reader's eye travels it.
function asRamp(palette) {
  return [...[...palette.below].reverse(), palette.optimal, ...palette.above];
}

// The smallest gap between neighbouring steps — a ramp can span a huge distance and still
// have two adjacent steps nobody can tell apart.
function smallestNeighbourStep(ramp) {
  let smallest = Infinity;
  for (let index = 1; index < ramp.length; index++) {
    smallest = Math.min(smallest, deltaE(ramp[index - 1], ramp[index]));
  }
  return smallest;
}

// Everything one palette has to answer for: how far each wing reaches from the middle, how
// far the two ends are from each other, whether the ramp keeps moving outwards, how close
// its closest neighbours are, and what contrast its weakest step manages on each card.
function measureRamp(palette) {
  const ramp = asRamp(palette);
  const middle = palette.below.length;
  const fromMiddle = ramp.map((hex) => deltaE(ramp[middle], hex));

  // Two readings of "it keeps going outwards": `monotone` requires each step strictly
  // further from the middle than the last; `neverReturns` also allows a step to stand still
  // (a white ramp's pale wing has nowhere paler to go). Neither allows a step back towards
  // the middle — a ramp that has folded over.
  let monotone = true;
  let neverReturns = true;
  for (let index = middle + 1; index < ramp.length; index++) {
    if (fromMiddle[index] <= fromMiddle[index - 1]) monotone = false;
    if (fromMiddle[index] < fromMiddle[index - 1] - 1e-9) neverReturns = false;
  }
  for (let index = middle - 1; index >= 0; index--) {
    if (fromMiddle[index] <= fromMiddle[index + 1]) monotone = false;
    if (fromMiddle[index] < fromMiddle[index + 1] - 1e-9) neverReturns = false;
  }

  return {
    lowWing: fromMiddle[0],
    highWing: fromMiddle[ramp.length - 1],
    ends: deltaE(ramp[0], ramp[ramp.length - 1]),
    monotone,
    neverReturns,
    minStep: smallestNeighbourStep(ramp),
    onLight: Math.min(...ramp.map((hex) => contrastRatio(hex, LIGHT_CARD))),
    onDark: Math.min(...ramp.map((hex) => contrastRatio(hex, DARK_CARD))),
    lightnessRange: [Math.min(...ramp.map((hex) => lab(hex)[0])), Math.max(...ramp.map((hex) => lab(hex)[0]))],
  };
}

module.exports = {
  asRamp,
  contrastRatio,
  deltaE,
  lab,
  measureRamp,
  relativeLuminance,
  smallestNeighbourStep,
  DARK_CARD,
  LIGHT_CARD,
};
