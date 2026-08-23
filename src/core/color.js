// Colour primitives, and what counts as a colour from outside the card.
//
// TWO TRUST LEVELS, and they are deliberately two functions.
//
// isHexColor() is the strict one. A value_color attribute arrives from an arbitrary
// integration or template sensor and ends up in CSS custom properties and inline style
// attributes further down the render pipeline. Anything that is not one of the four valid
// CSS hex lengths is treated as absent rather than passed through verbatim.
//
// parseColorToken() is the lenient one, and it is for YAML ONLY — a human typing into a
// dashboard editor, where the strict spelling is a trap rather than a safeguard. It
// accepts the spellings a person actually writes and normalizes them to hex; what comes
// out is exactly as safe as what isHexColor() lets through, because that is the check it
// finishes with.
//
// The 148 CSS colour names live here rather than in a module of their own because layer 0
// may not import anything, not even from itself (see architecture-imports.test.js) — and
// a name table without the parser that reads it would be data nobody can use.

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Accepted shape for a colour coming from outside the card (HA attribute or
// YAML). No global flag, so .test() stays stateless.
export function isHexColor(value) {
  return HEX_COLOR_PATTERN.test(value);
}

// Builds a semi-transparent colour from a hex, rgb(), or CSS variable input.
// Accepts all four valid CSS hex lengths (3/4/6/8, matching isHexColor); for
// the two with an embedded alpha channel (4/8), only the RGB part is used —
// this always applies the given alpha rather than any alpha already embedded
// in the source colour, since the contract here is "this colour at the
// requested opacity", not "this colour's own opacity, adjusted".
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

// The names CSS itself defines, so a palette can be asked for by name. One line of YAML —
// `palette: teal` — is a far better door into the colour system than a hand-written ramp.
// All 148 are here rather than a curated subset: a subset would need a reason for every
// colour left out, and there is none.
//
// Values are the CSS Color Module Level 4 definitions; a browser test resolves every name
// through Chromium's own CSS parser and compares, so this table cannot quietly drift from
// the specification it claims to follow. Keys are lower case, which is how the lookup
// normalizes; the grey/gray pairs are both spellings of one colour, as in CSS.

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

// The colour spellings a human writes in YAML, normalized to hex — or null.
//
// Four roads in, and each exists because of something a user actually runs into:
//
//   "#1DB85D"   the strict spelling, which YAML forces into quotes
//   1DB85D      the same colour unquoted, because `optimal: #1DB85D` is a YAML COMMENT
//               and the value would silently be empty
//   teal        a name, for the far more common case of not having a hex at hand
//   123456      what YAML hands over when every digit of a hex happens to be numeric
//
// The numeric road is the only subtle one. A YAML parser turns `123456` into the NUMBER
// 123456, and the six hex digits the user typed are recoverable from its decimal
// spelling — the digits are their own hex digits. Anything that does not come back as
// exactly six digits is refused rather than guessed at, so a float, a leading zero or a
// seven-digit number produces an error naming the fix instead of a wrong colour. The one
// spelling this cannot see through is a three-digit shorthand of the form `1E5`, which
// YAML reads as 100000; that is what quotes are for, and the README says so.
export function parseColorToken(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) return null;
    const digits = String(value);
    return digits.length === 6 ? `#${digits}` : null;
  }
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (!token) return null;
  const named = CSS_COLOR_NAMES[token];
  if (named) return named;
  const hex = token.startsWith("#") ? token : `#${token}`;
  if (!isHexColor(hex)) return null;
  // One output form for every input form. The shorthand doubling is CSS's own definition
  // of what #0F8 means, so nothing is invented — and downstream, where colours are
  // compared and written into styles, "the same colour" and "the same string" being the
  // same thing is worth more than keeping the user's abbreviation.
  const digits = hex.slice(1).toUpperCase();
  return `#${digits.length <= 4 ? digits.split("").map((digit) => digit + digit).join("") : digits}`;
}
