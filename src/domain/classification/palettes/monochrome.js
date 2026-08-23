// A palette in one colour, derived rather than written down.
//
// `palette: teal` is the shortest useful thing a user can say about colour, and there are
// 148 names CSS already gives them. Shipping 148 files would be absurd; shipping a
// handful of favourites would be arbitrary. So the ramp is DERIVED from whatever colour
// was named, and the same function serves a hex the user picked themselves.
//
// THE ONE PROMISE: the colour you name is the colour you get. `optimal` is the base hex,
// unchanged and exact, and every step keeps its hue to the digit — the gamut is left by
// reducing chroma at fixed hue (see core/oklch.js), never by clamping channels. An
// earlier draft made a different promise: it took only the HUE from the base colour and
// placed the ramp at fixed lightness and chroma of its own. That produced a washed-out
// lilac for `palette: blue` — wrong twice over, once because the named colour appeared
// nowhere in its own ramp, and once because CIELAB's hue lines bend from blue towards
// purple. Both are gone.
//
// THE PROBLEM A SINGLE HUE CREATES. A classification ramp is diverging — too little, just
// right, too much — and hue is normally what separates the two directions. With one hue
// there is nothing left to say "which way", only "how far". So direction is carried by
// the two qualities a single hue still has:
//
//   below   pale     lighter and washed out    "not enough of it"
//   optimal           the colour that was named
//   above   deep     darker and saturated      "too much of it"
//
// The reading is intuitive in one direction — more colour means more of the thing — and
// the two wings never look alike.
//
// WHAT A SINGLE HUE COSTS, and it is worth stating plainly because no tuning removes it.
// A diverging ramp has to go both paler and deeper than its middle, and every step it
// takes in either direction moves towards one background or the other. The hand-designed
// palettes get away with a narrow lightness band because they also change HUE, which this
// cannot. So a generated ramp does not promise the contrast a designed palette does; what
// it promises is that the middle is exactly the colour that was asked for, that no step is
// wasted on a difference nobody can see, and that at least a couple of steps stay
// comfortable on both card backgrounds. Naming a colour is a choice, and this file keeps
// it rather than overruling it.

import { hexToOklch, oklabDistance, oklchToHex } from "../../../core/oklch.js";
import { tuningForColor } from "../surface.js";

// Where each wing is headed, in Oklab lightness.
//
// The two anchors are roughly the edges of the band that stays readable on a light card
// AND a dark one: measured on greys, 2,0 : 1 on white runs out around L 0.78 and 2,6 : 1
// on the dark card around L 0.48, which is also where the four hand-designed palettes
// happen to live. A wing aims at its anchor and stops there — going further buys bigger
// steps at the price of an end nobody can read.
//
// MIN_TRAVEL is what a base already past its anchor still gets. `blue` sits below the
// deep anchor, so its deep wing travels a short way rather than not at all; the step
// filter below then decides how many steps that is worth.
const PALE_ANCHOR = 0.76;
const DEEP_ANCHOR = 0.5;
const MIN_TRAVEL = 0.08;
// Absolute stops, so an extreme base cannot send the ramp out of the space entirely.
const LIGHTNESS_CEILING = 0.96;
const LIGHTNESS_FLOOR = 0.1;

// What each wing does to colourfulness, as a factor on the base colour's own chroma.
// Pale washes out, deep intensifies — and because both are PROPORTIONAL, a base with no
// chroma keeps none, so `gray`, `white` and `black` produce a greyscale without this file
// needing to know what "achromatic" means. The earlier draft carried a threshold for
// exactly that case, and got it wrong once already (a green ramp out of `white`, because
// an unsaturated colour's hue angle is rounding noise). A rule that cannot be applied to
// the wrong case is better than a rule that has to detect it.
const PALE_CHROMA = 0.25;
const DEEP_CHROMA = 1.5;

// The reach of every built-in profile, so a profile and a full-length generated palette
// map one to one and the middle of one is the middle of the other.
const MAX_STEPS = 5;

// How far apart two neighbouring steps have to look before the ramp is allowed to claim
// them as two steps. In Oklab units, where the distance is the perceived difference (see
// oklabDistance); several times what counts as just noticeable.
const MIN_STEP = 0.04;

// One wing: up to MAX_STEPS colours running outwards from the base towards `endLightness`
// and `endChroma`.
//
// THE LENGTH IS NOT FIXED, and that is a feature rather than a concession. `gold` is
// already so light that five distinguishable steps do not fit above it, and `white` has
// no room at all — so they get three and none. Faking the steps would mean five colours a
// reader cannot tell apart, which is worse than three they can; and a palette may have
// wings of different lengths, including empty ones, so nothing downstream has to be told
// about this. Fewer steps means bigger gaps, so the longest length that still clears
// MIN_STEP everywhere is the answer, and it is found by trying from the top.
function wing(base, baseHex, endLightness, endChroma) {
  const at = (t) =>
    oklchToHex({
      lightness: base.lightness + (endLightness - base.lightness) * t,
      chroma: base.chroma + (endChroma - base.chroma) * t,
      hue: base.hue,
    });

  for (let steps = MAX_STEPS; steps >= 1; steps -= 1) {
    const colors = Array.from({ length: steps }, (_, index) => at((index + 1) / steps));
    let previous = baseHex;
    const separated = colors.every((color) => {
      const far = oklabDistance(previous, color) >= MIN_STEP;
      previous = color;
      return far;
    });
    if (separated) return colors;
  }
  return [];
}

// The palette a base colour implies. Total: every hex produces a palette, and what counts
// as a valid base is the caller's decision, not this file's.
export function monochromePalette(baseHex, id = "monochrome") {
  const base = hexToOklch(baseHex);
  const paleLightness = Math.max(
    base.lightness,
    Math.min(LIGHTNESS_CEILING, Math.max(PALE_ANCHOR, base.lightness + MIN_TRAVEL))
  );
  const deepLightness = Math.min(
    base.lightness,
    Math.max(LIGHTNESS_FLOOR, Math.min(DEEP_ANCHOR, base.lightness - MIN_TRAVEL))
  );
  return {
    id,
    // Measured from the base colour rather than declared, because there is no list that
    // could cover a hex somebody typed. `yellow` says it is for dark dashboards, `navy`
    // for light ones, `teal` for both — see tuningForColor(). Computed here means once
    // per setConfig(), for the one colour that was asked for.
    tunedFor: tuningForColor(baseHex),
    // The base colour itself, passed through rather than round-tripped through Oklab. A
    // round trip is exact to well under an 8-bit step, but "exact enough" is not the
    // promise; the promise is that `palette: teal` puts #008080 on the card. The caller
    // hands over an already-normalized hex (see parseColorToken in core/color.js).
    optimal: baseHex,
    above: wing(base, baseHex, deepLightness, base.chroma * DEEP_CHROMA),
    below: wing(base, baseHex, paleLightness, base.chroma * PALE_CHROMA),
  };
}
