// Colour primitives, and what counts as a colour from outside the card.
//
// TWO TRUST LEVELS, two functions. isHexColor() is strict — for a value_color attribute
// from an arbitrary integration, which reaches CSS properties and inline styles; anything
// that is not one of the four CSS hex lengths is treated as absent. parseColorToken() is
// lenient and for YAML ONLY (a human typing), accepting the spellings people write and
// normalizing to hex — and it finishes on the same strict check, so its output is as safe.
//
// The 148 CSS colour names live here because layer 0 may not import, even from itself, and
// a name table without its parser would be unusable.

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Accepted shape for a colour coming from outside the card (HA attribute or
// YAML). No global flag, so .test() stays stateless.
export function isHexColor(value) {
  return HEX_COLOR_PATTERN.test(value);
}

// How bright a colour is to the eye, on the 0..1 scale WCAG's contrast ratio uses. Not
// the same as the lightness values elsewhere — this one is about light, not appearance.
export function relativeLuminance(hex) {
  const value = String(hex).replace("#", "").trim();
  const full = value.length <= 4 ? value.slice(0, 3).split("").map((digit) => digit + digit).join("") : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(full.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Builds a semi-transparent colour from a hex, rgb(), or CSS variable input. Accepts all
// four CSS hex lengths; for 4/8-digit input only the RGB part is used, and the given
// alpha always wins over any alpha embedded in the source ("this colour at this opacity").
export function rgba(color, alpha) {
  if (typeof color !== "string") return `rgba(255,255,255,${alpha})`;
  if (color.startsWith("rgba") || color.startsWith("rgb")) return color;
  if (color.startsWith("var(")) return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
  const hex = color.replace("#", "").trim();
  let rgbHex;
  if (hex.length === 3 || hex.length === 4) {
    rgbHex = hex.slice(0, 3).split("").map((c) => c + c).join("");
  } else if (hex.length === 6 || hex.length === 8) {
    rgbHex = hex.slice(0, 6);
  } else {
    return `rgba(255,255,255,${alpha})`;
  }
  const int = Number.parseInt(rgbHex, 16);
  if (!Number.isFinite(int)) return `rgba(255,255,255,${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// The CSS Color Module Level 4 named colours, so a palette can be asked for by name. All
// 148, not a curated subset. A browser test resolves every name through Chromium's CSS
// parser and compares, so this cannot drift from the spec. Keys are lower case (how the
// lookup normalizes); grey/gray pairs are one colour, as in CSS.

export const CSS_COLOR_NAMES = Object.freeze({
  aliceblue: "#F0F8FF",
  antiquewhite: "#FAEBD7",
  aqua: "#00FFFF",
  aquamarine: "#7FFFD4",
  azure: "#F0FFFF",
  beige: "#F5F5DC",
  bisque: "#FFE4C4",
  black: "#000000",
  blanchedalmond: "#FFEBCD",
  blue: "#0000FF",
  blueviolet: "#8A2BE2",
  brown: "#A52A2A",
  burlywood: "#DEB887",
  cadetblue: "#5F9EA0",
  chartreuse: "#7FFF00",
  chocolate: "#D2691E",
  coral: "#FF7F50",
  cornflowerblue: "#6495ED",
  cornsilk: "#FFF8DC",
  crimson: "#DC143C",
  cyan: "#00FFFF",
  darkblue: "#00008B",
  darkcyan: "#008B8B",
  darkgoldenrod: "#B8860B",
  darkgray: "#A9A9A9",
  darkgreen: "#006400",
  darkgrey: "#A9A9A9",
  darkkhaki: "#BDB76B",
  darkmagenta: "#8B008B",
  darkolivegreen: "#556B2F",
  darkorange: "#FF8C00",
  darkorchid: "#9932CC",
  darkred: "#8B0000",
  darksalmon: "#E9967A",
  darkseagreen: "#8FBC8F",
  darkslateblue: "#483D8B",
  darkslategray: "#2F4F4F",
  darkslategrey: "#2F4F4F",
  darkturquoise: "#00CED1",
  darkviolet: "#9400D3",
  deeppink: "#FF1493",
  deepskyblue: "#00BFFF",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1E90FF",
  firebrick: "#B22222",
  floralwhite: "#FFFAF0",
  forestgreen: "#228B22",
  fuchsia: "#FF00FF",
  gainsboro: "#DCDCDC",
  ghostwhite: "#F8F8FF",
  gold: "#FFD700",
  goldenrod: "#DAA520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#ADFF2F",
  grey: "#808080",
  honeydew: "#F0FFF0",
  hotpink: "#FF69B4",
  indianred: "#CD5C5C",
  indigo: "#4B0082",
  ivory: "#FFFFF0",
  khaki: "#F0E68C",
  lavender: "#E6E6FA",
  lavenderblush: "#FFF0F5",
  lawngreen: "#7CFC00",
  lemonchiffon: "#FFFACD",
  lightblue: "#ADD8E6",
  lightcoral: "#F08080",
  lightcyan: "#E0FFFF",
  lightgoldenrodyellow: "#FAFAD2",
  lightgray: "#D3D3D3",
  lightgreen: "#90EE90",
  lightgrey: "#D3D3D3",
  lightpink: "#FFB6C1",
  lightsalmon: "#FFA07A",
  lightseagreen: "#20B2AA",
  lightskyblue: "#87CEFA",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#B0C4DE",
  lightyellow: "#FFFFE0",
  lime: "#00FF00",
  limegreen: "#32CD32",
  linen: "#FAF0E6",
  magenta: "#FF00FF",
  maroon: "#800000",
  mediumaquamarine: "#66CDAA",
  mediumblue: "#0000CD",
  mediumorchid: "#BA55D3",
  mediumpurple: "#9370DB",
  mediumseagreen: "#3CB371",
  mediumslateblue: "#7B68EE",
  mediumspringgreen: "#00FA9A",
  mediumturquoise: "#48D1CC",
  mediumvioletred: "#C71585",
  midnightblue: "#191970",
  mintcream: "#F5FFFA",
  mistyrose: "#FFE4E1",
  moccasin: "#FFE4B5",
  navajowhite: "#FFDEAD",
  navy: "#000080",
  oldlace: "#FDF5E6",
  olive: "#808000",
  olivedrab: "#6B8E23",
  orange: "#FFA500",
  orangered: "#FF4500",
  orchid: "#DA70D6",
  palegoldenrod: "#EEE8AA",
  palegreen: "#98FB98",
  paleturquoise: "#AFEEEE",
  palevioletred: "#DB7093",
  papayawhip: "#FFEFD5",
  peachpuff: "#FFDAB9",
  peru: "#CD853F",
  pink: "#FFC0CB",
  plum: "#DDA0DD",
  powderblue: "#B0E0E6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#FF0000",
  rosybrown: "#BC8F8F",
  royalblue: "#4169E1",
  saddlebrown: "#8B4513",
  salmon: "#FA8072",
  sandybrown: "#F4A460",
  seagreen: "#2E8B57",
  seashell: "#FFF5EE",
  sienna: "#A0522D",
  silver: "#C0C0C0",
  skyblue: "#87CEEB",
  slateblue: "#6A5ACD",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#FFFAFA",
  springgreen: "#00FF7F",
  steelblue: "#4682B4",
  tan: "#D2B48C",
  teal: "#008080",
  thistle: "#D8BFD8",
  tomato: "#FF6347",
  turquoise: "#40E0D0",
  violet: "#EE82EE",
  wheat: "#F5DEB3",
  white: "#FFFFFF",
  whitesmoke: "#F5F5F5",
  yellow: "#FFFF00",
  yellowgreen: "#9ACD32",
});

// One CSS colour, as an opaque hex plus the alpha it was written with — or null.
//
// getComputedStyle returns `rgb()`/`rgba()` for a resolved background-color; a custom
// property comes back as the theme author wrote it, so hex and names are accepted too.
// The alpha is reported, not applied — that needs a backdrop (see compositeOver()). null
// means nothing usable (an unreadable form, or fully transparent): answer from up the tree.
export function cssColorToHex(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const rgb = text.match(/^rgba?\(([^)]*)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
    const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
    if (alpha === 0) return null;
    const hex = `#${parts
      .slice(0, 3)
      .map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0"))
      .join("")}`;
    return { hex, alpha };
  }
  const parsed = parseColorToken(text);
  if (!parsed) return null;
  // An 8-digit hex carries its own alpha in the last pair.
  const digits = parsed.slice(1);
  if (digits.length === 8) {
    const alpha = parseInt(digits.slice(6, 8), 16) / 255;
    return alpha === 0 ? null : { hex: `#${digits.slice(0, 6)}`, alpha };
  }
  return { hex: parsed.length === 9 ? parsed.slice(0, 7) : parsed, alpha: 1 };
}

export function luminanceOfCssColor(value) {
  const parsed = cssColorToHex(value);
  return parsed ? relativeLuminance(parsed.hex) : null;
}

// ---------------------------------------------------------- compositing and blending --

const channelsOf = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hexOf = (channels) =>
  `#${channels.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("")}`;

// A translucent colour painted over an opaque one. Blended in sRGB, not linear light —
// what browsers do: `rgba(0,0,0,0.5)` over white comes out near #808080, not #BCBCBC. The
// point is to predict the screen, not the physics.
export function compositeOver(hex, alpha, backdrop) {
  if (!(alpha > 0)) return backdrop;
  if (alpha >= 1) return hex;
  const front = channelsOf(hex);
  const back = channelsOf(backdrop);
  return hexOf(front.map((value, index) => value * alpha + back[index] * (1 - alpha)));
}

// The colours a CSS gradient actually puts behind the card.
//
// More than "list the stops": browsers interpolate gradients in sRGB, so colours BETWEEN
// stops are a per-channel blend and get sampled too — the interior is where a gradient
// hurts (`linear-gradient(#FFF, #000)` is mid grey through the middle, where mid-light
// ramps die). Returns [] for anything unreadable (a `url(...)` image, conic gradient,
// `color-mix()`), so the caller falls back rather than guesses.
export function gradientSamples(value, { between = 3 } = {}) {
  if (typeof value !== "string") return [];
  const gradient = value.trim().match(/^(?:repeating-)?(?:linear|radial)-gradient\((.*)\)$/is);
  if (!gradient) return [];

  // Split on top-level commas: a stop may itself contain commas inside rgb(...).
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of gradient[1]) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);

  const stops = [];
  for (const part of parts) {
    // A stop is a colour optionally followed by one or two positions; the first token of a
    // gradient may instead be a direction ("to bottom", "45deg", "circle at center"), which
    // simply parses as no colour and is skipped.
    const colour = part.trim().match(/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)/i);
    if (!colour) continue;
    const parsed = cssColorToHex(colour[1]);
    if (parsed) stops.push(parsed.alpha >= 1 ? parsed.hex : null);
  }

  const opaque = stops.filter(Boolean);
  if (opaque.length === 0) return [];
  if (opaque.length === 1) return opaque;

  const samples = [opaque[0]];
  for (let index = 1; index < opaque.length; index++) {
    const from = channelsOf(opaque[index - 1]);
    const to = channelsOf(opaque[index]);
    for (let step = 1; step <= between; step++) {
      const t = step / (between + 1);
      samples.push(hexOf(from.map((value, channel) => value + (to[channel] - value) * t)));
    }
    samples.push(opaque[index]);
  }
  return samples;
}

// The colour spellings a human writes in YAML, normalized to hex — or null. Accepts
// "#1DB85D", unquoted 1DB85D (`optimal: #1DB85D` is a YAML comment), a name (teal), and a
// digits-only value YAML turned into a Number.
//
// The numeric road: `080808` arrives as 80808, so the digits are read back from the
// decimal spelling and left-padded to six. Refused: fewer than four digits (80 is
// ambiguous between #000080 and shorthand #080) or more than six. Unfixable: `0808080`
// also arrives as 808080 — the readme says to quote anything longer than six digits.
// Full contract: see internal dev doc §5 "Der YAML-Palettenvertrag ist für Menschen geschrieben".
export function parseColorToken(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 999999) return null;
    const digits = String(value);
    // `0` is the one short spelling with nothing to guess (every reading is black).
    if (digits !== "0" && digits.length < 4) return null;
    return `#${digits.padStart(6, "0")}`;
  }
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (!token) return null;
  const named = CSS_COLOR_NAMES[token];
  if (named) return named;
  const hex = token.startsWith("#") ? token : `#${token}`;
  if (!isHexColor(hex)) return null;
  // One output form for every input form: shorthand is doubled (CSS's own definition of
  // #0F8), so "same colour" and "same string" match downstream.
  const digits = hex.slice(1).toUpperCase();
  return `#${digits.length <= 4 ? digits.split("").map((digit) => digit + digit).join("") : digits}`;
}
