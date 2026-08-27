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

import { hexToOklch, oklchToHex } from "../../../core/oklch.js";
import { MIN_STEP, WING_STEPS, mix, pathLength, placeAlong } from "./geometry.js";

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
export const LIGHTNESS_CEILING = 0.96;
export const LIGHTNESS_FLOOR = 0.1;

// What each wing does to colourfulness, as a factor on the base colour's own chroma.
// Pale washes out, deep intensifies — and because both are PROPORTIONAL, a base with no
// chroma keeps none, so `gray`, `white` and `black` produce a greyscale without this file
// needing to know what "achromatic" means. The earlier draft carried a threshold for
// exactly that case, and got it wrong once already (a green ramp out of `white`, because
// an unsaturated colour's hue angle is rounding noise). A rule that cannot be applied to
// the wrong case is better than a rule that has to detect it.
const PALE_CHROMA = 0.25;
const DEEP_CHROMA = 1.5;

// THE MOST COLOURFULNESS THIS HUE CAN HOLD AT THIS LIGHTNESS. Asked of the conversion itself
// rather than modelled: oklchToHex() resolves an out-of-gamut colour by reducing chroma at
// fixed lightness and fixed hue, so what comes back from an impossible request IS the limit.
function chromaCeiling(lightness, hue) {
  return hexToOklch(oklchToHex({ lightness, chroma: 0.5, hue })).chroma;
}

// Where a wing is headed in colourfulness, given the base it starts from — and never further
// than the space can go.
//
// THE CLAMP IS WHAT KEEPS THE PATH FROM DOUBLING BACK. The deep wing asks for half again the
// base's chroma, and at the dark end that is routinely more than sRGB holds. Unclamped, the
// interpolation walks towards a colour that does not exist, the conversion pulls each step
// back to the edge of the gamut by a different amount, and the painted path wanders instead of
// travelling. Measured on `palette: navy`, that put two of its five deep steps 0.6 apart in
// CIEDE2000 while the ends of the same wing were 3.5 apart — a ramp with a stutter in it.
// Aiming at a colour that exists removes the wander at the source.
const endChromaFor = (base, side, lightness) =>
  Math.min(base.chroma * (side === "pale" ? PALE_CHROMA : DEEP_CHROMA), chromaCeiling(lightness, base.hue));
const endOf = (base, side, lightness) => ({ lightness, chroma: endChromaFor(base, side, lightness), hue: base.hue });

// ONE WING: WING_STEPS colours running outwards from the base to `endLightness`, spaced by what
// a reader SEES rather than by the interpolation parameter — see placeAlong() in geometry.js.
//
// THE LENGTH IS FIXED — see WING_STEPS there too. What is not fixed is how far the wing
// travels, and that is where the room a colour has shows up instead: `white` has nothing paler
// than itself, so its five pale steps are five whites. That is the honest picture of a colour
// with nowhere to go, and it renders exactly as the empty wing it replaces did — every reading
// below optimal shows the colour that was named.
//
// Whether the steps can be told apart is judged where something can be done about it:
// palettes/legible.js aims the endpoints against the background the card is really on, and
// refuses a ramp tighter than the one it started from.
export function monochromeWing(base, side, endLightness) {
  const end = endOf(base, side, endLightness);
  return placeAlong(base, end, WING_STEPS).map((t) => oklchToHex(mix(base, end, t)));
}

// WHERE THE TWO WINGS ARE HEADED for a given base, as the generator would choose it left to
// itself. Separated out because it is now a DEFAULT rather than the only possibility: a ramp
// that has to survive an unusual background may need its wings aimed somewhere else, and the
// caller that knows the background is the one that can say where (see palettes/legible.js).
//
// Kept as one function so that "what this generator would do on its own" has exactly one
// definition, and an adapted ramp is visibly the same construction with different endpoints.
// HOW MANY PLACES TO TRY when a wing has to reach further than its anchor.
const REACH_CANDIDATES = 16;

// AN ANCHOR IS A FLOOR, NOT A TARGET.
//
// The anchors say where a wing is AIMED, and that was enough while a wing could shorten itself
// when it ran out of room. With the length fixed it is not: a wing that travels a tenth of the
// lightness range still has to fit five steps into it. `palette: blue` is the case — #0000FF
// already sits below the deep anchor, so its deep wing aimed only MIN_TRAVEL further and came
// back as five blues 1.5 apart in CIEDE2000, which is one colour written five times.
//
// So a wing that is aimed too close is pushed outwards until the path it walks is long enough
// to hold its five steps MIN_STEP apart, or until it reaches the edge of the space.
//
// OVERRIDING AN ANCHOR COSTS SOMETHING, which is why the push stops as soon as the steps fit.
// The anchors sit at the edges of the band that stays readable on both card backgrounds, so a
// wing that reaches past one has a far end that is dim on one of them — and the card then
// repairs it against the background it is really on, which may move the named colour.
//
// ELEVEN STEPS DO NOT FIT INSIDE THAT BAND, and that is the whole of it. The band is 0.26 of
// the lightness range wide; eleven steps a reader can separate need about half of it again. So
// a derived ramp cannot be tuned to both canonical backgrounds at once, and the honest split is
// this: the generator gives the best ramp it can without knowing the background, and
// palettes/legible.js tunes it to the one the card is actually on.
//
// The reach was calibrated by sweeping it against both things it trades off — how well the
// ramp reads, and how often the colour the user named survives adaptation on the two canonical
// cards:
//
//   reach   median tightest step   ramps with an unreadable pair   named colour kept (white / dark)
//   0.10          2.40                        41                        83 / 118
//   0.13          2.72                        33                        83 / 115
//   0.16          3.16                        34                        83 / 115
//   0.20          3.74                        32                        83 / 114
//
// The named colour barely notices, and the ramp does — so the wing takes the room.
function reachedOut(base, side, aim, limit) {
  const wanted = WING_STEPS * MIN_STEP;
  if (pathLength(base, endOf(base, side, aim)) >= wanted) return aim;
  let furthest = aim;
  for (let step = 1; step <= REACH_CANDIDATES; step += 1) {
    furthest = aim + (limit - aim) * (step / REACH_CANDIDATES);
    if (pathLength(base, endOf(base, side, furthest)) >= wanted) break;
  }
  return furthest;
}

export function monochromeAnchors(base) {
  const pale = Math.max(base.lightness, Math.min(LIGHTNESS_CEILING, Math.max(PALE_ANCHOR, base.lightness + MIN_TRAVEL)));
  const deep = Math.min(base.lightness, Math.max(LIGHTNESS_FLOOR, Math.min(DEEP_ANCHOR, base.lightness - MIN_TRAVEL)));
  return {
    pale: reachedOut(base, "pale", pale, Math.max(base.lightness, LIGHTNESS_CEILING)),
    deep: reachedOut(base, "deep", deep, Math.min(base.lightness, LIGHTNESS_FLOOR)),
  };
}

// The palette a base colour implies. Total: every hex produces a palette, and what counts
// as a valid base is the caller's decision, not this file's.
//
// `anchors` overrides where the wings are headed, in Oklab lightness. Omitted — which is
// every call the card makes on its own — the generator picks them itself and produces exactly
// what it always did. A caller may aim a wing at a lightness on EITHER side of the base: on a
// background where nothing paler than the base can be seen, a pale wing that runs downwards
// into the washed-out is still plainly the pale wing, because the deep wing runs downwards
// into the saturated and the two never look alike.
export function monochromePalette(baseHex, id = "monochrome", anchors = null) {
  const base = hexToOklch(baseHex);
  const { pale: paleLightness, deep: deepLightness } = anchors || monochromeAnchors(base);
  return {
    id,
    // The base colour itself, passed through rather than round-tripped through Oklab. A
    // round trip is exact to well under an 8-bit step, but "exact enough" is not the
    // promise; the promise is that `palette: teal` puts #008080 on the card. The caller
    // hands over an already-normalized hex (see parseColorToken in core/color.js).
    optimal: baseHex,
    above: monochromeWing(base, "deep", deepLightness),
    below: monochromeWing(base, "pale", paleLightness),
  };
}
