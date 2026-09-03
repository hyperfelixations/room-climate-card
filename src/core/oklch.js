// sRGB <-> Oklch, the space a colour ramp can be reasoned about in: L for lightness,
// C for colourfulness, h for hue.
//
// Oklab, not CIELAB: a line of constant CIELAB hue bends towards purple in the blues
// (CSS `blue` sits at CIELAB hue 306°, so lightening it "along its own hue" goes lilac).
// Oklab (Ottosson, 2020) was fitted to fix that; the same colour is at 264° and stays
// blue. The matrices below are Oklab's published definition (linear sRGB -> LMS -> cbrt
// -> Oklab and back, D65 throughout).

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toEncoded = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * clamp01(c) ** (1 / 2.4) - 0.055);

// The four CSS hex lengths, reduced to three 0..1 channels. Any alpha is dropped — a ramp
// position is a colour, its transparency is decided where it is painted.
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

// L runs 0..1 here (Oklab's own scale), so the numbers match the published definition.
export function hexToOklch(hex) {
  const [lightness, a, b] = linearToOklab(hexToRgb(hex).map(toLinear));
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { lightness, chroma: Math.hypot(a, b), hue: hue >= 0 ? hue : hue + 360 };
}

// How far apart two colours look, as a plain straight-line distance — which it can be
// because Oklab was fitted so equal coordinate steps look equal (what CIEDE2000 patches
// CIELAB for). CIEDE2000 stays in the test suite as an independent instrument.
export function oklabDistance(hexA, hexB) {
  const a = linearToOklab(hexToRgb(hexA).map(toLinear));
  const b = linearToOklab(hexToRgb(hexB).map(toLinear));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// How far apart two colours look ON A REAL SCREEN — a different question from
// oklabDistance(), and they part company at the dark end. Oklab's cube root puts #1C1C1C
// (HA's dark card) 0.226 from black, as if obviously different; in a lit room, screen
// flare adds a constant and near-blacks merge. WCAG models that with its +0.05 but then
// saturates near white and goes blind to chroma (saturated red on mid grey scores 1.01).
// So a flare term is added FIRST, in linear light, then the uniform distance is measured;
// raising the dark end also compresses chroma there, as the eye does. F = 0.02 is
// measured — the only value that separates the calibration fixture's visible pairs from
// the invisible ones. Full derivation: see internal dev doc §5 "Distanzmaß screenDistance()".
const SCREEN_FLARE = 0.02;

// Linear light plus the flare a lit room adds, renormalised so white stays white.
const withFlare = (linear) => linear.map((channel) => (channel + SCREEN_FLARE) / (1 + SCREEN_FLARE));

export function screenDistance(hexA, hexB) {
  const a = linearToOklab(withFlare(hexToRgb(hexA).map(toLinear)));
  const b = linearToOklab(withFlare(hexToRgb(hexB).map(toLinear)));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export { SCREEN_FLARE };

// A rounding tolerance, not a colour tolerance: the matrices are given to ten digits and
// a channel that lands at 1.00000004 is white, not out of gamut.
const GAMUT_EPSILON = 1e-4;

function inGamut(linear) {
  return linear.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);
}

// The inverse. A lightness/chroma pair can name a colour sRGB cannot show; clamping the
// channels would move the HUE (each clips at a different moment), and a monochrome ramp's
// one promise is a constant hue. So the colour is brought into gamut by reducing CHROMA
// at fixed L and h, by bisection — chroma zero is always in gamut, so the search terminates.
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
