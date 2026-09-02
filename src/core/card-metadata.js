// The card's identity: the values Home Assistant and HACS key on.
//
// CARD_VERSION is the single source of truth for the released version and must match
// package.json and package-lock.json; the build-artifact and characterization tests
// assert that against the bundle's window.roomClimateCardVersion. No changelog here —
// user-facing version history belongs in the GitHub releases.

export const CARD_TYPE = "room-climate-card";
export const CARD_NAME = "Room Climate Card";
export const CARD_VERSION = "2.38.2";
