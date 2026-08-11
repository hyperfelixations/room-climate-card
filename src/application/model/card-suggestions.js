// What the card offers the dashboard's card picker.
//
// Two questions, one answer each, both decided from `hass.states` alone:
//
//   suggestionsForEntity()  the user picked an entity — does this card make sense for
//                           it, and with what configuration?
//   stubConfigFor()         the user is browsing the card list — what should the card
//                           start out as?
//
// Both go through metricKindForEntity(), which is the same resolver the card itself
// uses at runtime: device_class first, unit_of_measurement as the fallback. That is the
// whole point of computing it here instead of listing device classes a second time — an
// entity the picker offers this card for is by construction an entity the card can
// read, and a fifth measurement kind extends both at once. `climate.*`, `weather.*` and
// anything else without a recognized device class or unit falls out on its own.
//
// TOTAL BY CONSTRUCTION. These run inside Home Assistant's card picker, outside this
// card's own lifecycle, against whatever the frontend happens to pass — so every access
// is guarded and neither function can throw. Deliberately not a try/catch at the call
// site: that would also swallow a genuine defect and leave the picker quietly missing
// this card with nothing to debug.

import { CARD_TYPE } from "../../core/card-metadata.js";
import { metricKindForEntity } from "./entity-model.js";

// The configuration the picker inserts. `custom:` is how Home Assistant addresses a
// card that is not one of its own; CARD_TYPE is the same constant customElements is
// registered under, so the two can never drift.
const CONFIG_TYPE = `custom:${CARD_TYPE}`;

// The fallback start configuration: a primary plus three rooms, with placeholder ids in
// the shape the README's own quickstart uses. It is what a user sees when nothing in
// their system matches — the ids are then invented, but the SHAPE still teaches what
// the card is for, which an empty object would not.
function templateConfig() {
  return {
    entity: "sensor.house_temperature",
    rooms: [
      { name: "Kitchen", short: "KI", entity: "sensor.kitchen_temperature" },
      { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
      { name: "Living Room", short: "LR", entity: "sensor.living_room_temperature" },
    ],
  };
}

function isSupportedEntity(states, entityId) {
  return typeof entityId === "string" && Boolean(metricKindForEntity(states, entityId));
}

// Null for everything this card cannot read, which Home Assistant's own guidance asks
// for explicitly: a suggestion that renders a no-data card is worse than no suggestion.
//
// An entity that is merely `unavailable` right now IS still offered. It remains a
// climate entity, the card renders that state deliberately, and excluding it would make
// the card disappear from the picker during every restart window.
export function suggestionsForEntity(states, entityId) {
  if (!isSupportedEntity(states, entityId)) return null;
  return { config: { type: CONFIG_TYPE, entity: entityId } };
}

// The starting configuration for the browse path, preferring a real entity from the
// user's own system so the picker's preview shows their data rather than an error.
//
// Home Assistant passes two candidate lists — what the current view already uses, then
// a broader fallback — and its own cards search them in that order. Searching all of
// `states` afterwards is this card's own third step: a climate sensor anywhere is still
// a better start than an invented id.
//
// Deliberately ONE entity and no rooms. Room chips fall back to the bare entity id when
// a room has no name, which reads badly in a preview, and declaring an arbitrary room
// sensor to be the home average would be wrong rather than merely ugly. Adding rooms is
// the first thing the README shows.
export function stubConfigFor(states, entities, entitiesFallback) {
  const lists = [entities, entitiesFallback].filter(Array.isArray);
  for (const list of lists) {
    const match = list.find((entityId) => isSupportedEntity(states, entityId));
    if (match) return { entity: match };
  }
  const all = states && typeof states === "object" ? Object.keys(states) : [];
  const anyMatch = all.find((entityId) => isSupportedEntity(states, entityId));
  return anyMatch ? { entity: anyMatch } : templateConfig();
}
