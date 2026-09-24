// The card's identity: the values Home Assistant and HACS key on, and the only module
// `npm run build:dev` replaces — every constant here gets a development counterpart there
// (scripts/build-dev.mjs). See internal dev doc §4 "Build-/Dist-Vertrag".
//
// CARD_VERSION is the single source of truth for the released version and must match
// package.json and package-lock.json; the build-artifact and characterization tests
// assert that against the bundle's window.roomClimateCardVersion. No changelog here —
// user-facing version history belongs in the GitHub releases.

export const CARD_TYPE = "room-climate-card";
export const CARD_NAME = "Room Climate Card";
export const CARD_VERSION = "2.39.0-dev.2";
// The window property carrying CARD_VERSION; camelCase of CARD_TYPE plus "Version".
export const CARD_VERSION_GLOBAL = "roomClimateCardVersion";
