// Colour primitives.
//
// isHexColor() is a trust boundary, not a convenience: a value_color attribute
// arrives from an arbitrary integration or template sensor and ends up in CSS
// custom properties and inline style attributes further down the render
// pipeline. Anything that is not one of the four valid CSS hex lengths is
// treated as absent rather than passed through verbatim. The same check
// validates custom classification profiles from YAML.

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
