// The two canonical backgrounds. They have two jobs: the last rung of the reading ladder in
// the element (when the browser will not say what the card is painted on, `hass.themes.darkMode`
// picks one) and the reference for the palette measurements. Bucketing backgrounds or palettes
// into these two is not one of them — that is measured (./palette-fit.js). See internal dev doc §5
// "Was von surface.js übrig ist".

export const SURFACES = Object.freeze(["light", "dark"]);

// White, and Home Assistant's dark card — the extremes, not averages: a palette that holds up
// on both holds up on everything between.
export const SURFACE_BACKGROUNDS = Object.freeze({ light: "#FFFFFF", dark: "#1C1C1C" });
