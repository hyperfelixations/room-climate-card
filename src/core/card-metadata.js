// The card's identity: the values Home Assistant and HACS key on.
//
// CARD_VERSION is the single source of truth for the released version and must
// match package.json and package-lock.json. test/unit/build-artifact.test.js
// and test/unit/characterization-registration.test.js both assert that,
// against the built bundle's window.roomClimateCardVersion, so the three can
// never silently drift apart.
//
// Deliberately no changelog here (documented convention since 2.9.0): version
// history and rationale live in the internal technical documentation, not in
// the shipped file.

export const CARD_TYPE = "room-climate-card";
export const CARD_NAME = "Room Climate Card";
export const CARD_VERSION = "2.36.1";
