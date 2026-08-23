// sRGB <-> Oklch, the space a colour ramp can actually be reasoned about in.
//
// A ramp is a statement about lightness and colourfulness — "the same colour, paler",
// "the same colour, deeper" — and neither is a straight line in RGB. A polar perceptual
// space says exactly those three things as three numbers: L for lightness, C for
// colourfulness, h for hue.
//
// WHY OKLAB AND NOT CIELAB, which is the older and more familiar choice. CIELAB has a
// well known defect in the blues: a line of constant CIELAB hue bends towards purple as
// lightness or chroma change. It is not a rounding error, it is the size of the whole
// problem — CSS `blue` (#0000FF) sits at CIELAB hue 306 degrees, which is blue-violet,
// so lightening it along "its own hue" produces lilac. An earlier draft of the
// monochrome generator did exactly that and shipped a lilac ramp for `palette: blue`.
// Oklab (Björn Ottosson, 2020) was fitted to fix that specific failure; the same colour
// sits at 264 degrees there and stays blue the whole way up.
//
// The matrices below are Oklab's published definition: linear sRGB -> LMS -> cube root
// -> Oklab, and back. D65 throughout, the white point sRGB is defined against.

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toEncoded = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * clamp01(c) ** (1 / 2.4) - 0.055);

// The four CSS hex lengths, reduced to three 0..1 channels. An alpha channel is dropped
// rather than honoured: a ramp position is a colour, and its transparency is decided
// where it is painted.
function hexToRgb(hex) {
  const value = String(hex).replace("#", "").trim();
  const full = value.length <= 4 ? value.slice(0, 3).split("").map((digit) => digit + digit).join("") : value.slice(0, 6);
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// L runs 0..1 here, not 0..100 — Oklab's own scale, kept rather than rescaled so the
// numbers in this file can be checked against the published definition directly.
export function hexToOklch(hex) {
  const [lightness, a, b] = linearToOklab(hexToRgb(hex).map(toLinear));
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { lightness, chroma: Math.hypot(a, b), hue: hue >= 0 ? hue : hue + 360 };
}

// How far apart two colours look, as a plain straight-line distance.
//
// That it IS a plain distance is the reason this space was chosen. Oklab was fitted so
// that equal steps in its coordinates look like equal steps, which is exactly what CIELAB
// famously fails at and what CIEDE2000 exists to patch up with a page of correction
// terms. A generator that has to decide "is this step big enough to see" needs one number
// and gets it here; the more elaborate CIEDE2000 stays in the test suite, where measuring
// a finished ramp with an INDEPENDENT instrument is the whole point.
export function oklabDistance(hexA, hexB) {
  const a = linearToOklab(hexToRgb(hexA).map(toLinear));
  const b = linearToOklab(hexToRgb(hexB).map(toLinear));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// A rounding tolerance, not a colour tolerance: the matrices are given to ten digits and
// a channel that lands at 1.00000004 is white, not out of gamut.
const GAMUT_EPSILON = 1e-4;

function inGamut(linear) {
  return linear.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);
}

// The inverse, with the one compromise every such conversion has to make somewhere: a
// lightness/chroma pair can name a colour sRGB cannot show.
//
// HOW that is resolved is the whole point of this function. Clamping the three channels
// — the obvious way, and what the CIELAB version of this file used to do — moves the
// HUE, because each channel clips at a different moment. That is fatal here: the one
// promise a monochrome ramp makes is that every step is the same colour. So the colour
// is brought back into gamut by reducing CHROMA at fixed lightness and fixed hue
// instead, by bisection. Chroma zero is a grey, which is always inside the gamut for any
// lightness in 0..1, so the search always terminates with an answer and the hue it
// returns is exactly the hue it was asked for.
export function oklchToHex({ lightness, chroma, hue }) {
  const radians = (hue * Math.PI) / 180;
  const at = (c) => oklabToLinear([lightness, c * Math.cos(radians), c * Math.sin(radians)]);

  let usable = Math.max(0, chroma);
  if (!inGamut(at(usable))) {
    let low = 0;
    let high = usable;
    // 24 halvings take the interval below 1e-7 for any chroma sRGB can hold — far under
    // one step of an 8-bit channel, so the result is exact once rounded.
    for (let index = 0; index < 24; index += 1) {
      const middle = (low + high) / 2;
      if (inGamut(at(middle))) low = middle;
      else high = middle;
    }
    usable = low;
  }

  return `#${at(usable)
    .map((channel) => Math.round(clamp01(toEncoded(clamp01(channel))) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}
