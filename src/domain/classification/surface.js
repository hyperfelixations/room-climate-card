// What the card is sitting ON, and what that means for a palette.
//
// A colour ramp is foreground. Whether its steps can be read depends entirely on the
// background behind them, and that background is not a constant: Home Assistant ships a
// light and a dark theme, users install their own, and card-mod restyles individual
// cards. The card therefore does not assume — it is told, by whoever can actually see the
// rendered background (see the element), and everything below is the pure part.
//
// Two surfaces are enough. A background is either light enough that dark text reads on it
// or dark enough that light text does, and every theme in practice is one or the other;
// the boundary between them is where a mid grey stops favouring either.

import { luminanceOfCssColor, relativeLuminance } from "../../core/color.js";

export const SURFACES = Object.freeze(["light", "dark"]);

// The two backgrounds every palette in this card is measured against. They are the
// extremes rather than averages on purpose: a palette that holds up on pure white and on
// Home Assistant's dark card holds up on everything between.
export const SURFACE_BACKGROUNDS = Object.freeze({ light: "#FFFFFF", dark: "#1C1C1C" });

// The floors a shipped palette clears. Different per surface because the eye is not
// symmetric about them — the same ratio is harder to read as light-on-dark, so the dark
// side asks for more.
const READABLE_ON_LIGHT = 2.0;
const READABLE_ON_DARK = 2.6;

// WCAG's contrast ratio. Duplicated from the measuring instrument in test/helpers rather
// than shared with it, and deliberately: the instrument has to be able to disagree with
// the card, or it is not measuring anything. A test asserts the two still agree.
export function contrastRatio(hex, background) {
  const [lighter, darker] = [relativeLuminance(hex), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Which of the two a background counts as. The split sits at the luminance where a
// mid grey stops being readable on one side and starts being readable on the other; it is
// derived from the same two floors rather than picked, so moving a floor moves this too.
const SURFACE_SPLIT = 0.18;

export function surfaceForLuminance(luminance) {
  return Number.isFinite(luminance) && luminance < SURFACE_SPLIT ? "dark" : "light";
}

export function surfaceForBackground(hex) {
  return surfaceForLuminance(relativeLuminance(hex));
}

// The same question, asked of whatever the CSSOM handed back. null when the value says
// nothing — a fully transparent background, or a form this cannot read — so the caller
// can fall back rather than guess "light".
export function surfaceForBackgroundColor(value) {
  const luminance = luminanceOfCssColor(value);
  return luminance === null ? null : surfaceForLuminance(luminance);
}

// WHICH BACKGROUND A COLOUR WAS MADE FOR, derived rather than declared.
//
// This is what lets `palette: yellow` know about itself. Yellow reaches 15,9 : 1 on a dark
// card and 1,1 : 1 on a light one, so it is a colour for dark dashboards and says so; navy
// is the mirror image; teal works on both. No hand-maintained table can do this for a hex
// the user typed, and a hand-maintained table for the 148 names would be 148 opinions
// where one measurement will do.
//
// COMPUTED WHERE IT IS NEEDED, ONCE. A shipped palette states its tuning in its own
// module; a generated one asks this function about its base colour while it is being
// generated, which happens once per setConfig() for the one colour someone wrote. Nothing
// here runs per render, and nothing sweeps the colour table.
export function tuningForColor(hex) {
  const onLight = contrastRatio(hex, SURFACE_BACKGROUNDS.light) >= READABLE_ON_LIGHT;
  const onDark = contrastRatio(hex, SURFACE_BACKGROUNDS.dark) >= READABLE_ON_DARK;
  if (onLight && onDark) return "any";
  if (onDark) return "dark";
  if (onLight) return "light";
  // Unreachable for any sRGB colour — a value dark enough to fail on white is light
  // enough to pass on the dark card and the other way round — but "we could not tell"
  // must not silently become "it fits everywhere".
  return "any";
}
