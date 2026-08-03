// The card's identity: the values Home Assistant and HACS key on.
//
// CARD_VERSION is the single source of truth for the released version and must
// match package.json and package-lock.json. test/unit/build-artifact.test.js
// and test/unit/characterization-registration.test.js both assert that,
// against the built bundle's window.roomClimateCardVersion, so the three can
// never silently drift apart.
//
// Deliberately no changelog here: user-facing version history belongs in the
// public GitHub releases, not in the shipped file.

export const CARD_TYPE = "room-climate-card";
export const CARD_NAME = "Room Climate Card";
export const CARD_VERSION = "2.38.0";
