// THE TWO CANONICAL BACKGROUNDS, and the one question that can still be asked without
// measuring anything.
//
// Nearly everything this module used to hold has moved. Deciding whether a palette suits
// the card is now a MEASUREMENT against the colours the card is actually painted on — see
// ./palette-fit.js — rather than a bucketing of backgrounds into "light" and "dark" and of
// palettes into which bucket they prefer. Two buckets could never describe a dark blue
// card-mod card, and the palettes' own claims about which bucket suited them could drift
// away from their colours without anything noticing.
//
// What survives is the part that is still true: there are two canonical backgrounds, and
// when the browser will not say what the card is painted on, `hass.themes.darkMode` picks
// one of them. That is the last rung of the reading ladder in the element.

export const SURFACES = Object.freeze(["light", "dark"]);

// White, and Home Assistant's dark card. They are the extremes rather than averages on
// purpose: a palette that holds up on both holds up on everything between.
export const SURFACE_BACKGROUNDS = Object.freeze({ light: "#FFFFFF", dark: "#1C1C1C" });
