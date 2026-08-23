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
import { AVAILABILITY, buildEntityModel, metricKindForEntity } from "./entity-model.js";

// The configuration the picker inserts. `custom:` is how Home Assistant addresses a
// card that is not one of its own; CARD_TYPE is the same constant customElements is
// registered under, so the two can never drift.
const CONFIG_TYPE = `custom:${CARD_TYPE}`;

// WHAT THE BROWSE PATH OFFERS — a product decision, and deliberately not a YAML option.
//
// It applies to exactly one moment: the user opened "add card" and scrolled to this one
// without having picked an entity first. It cannot be a per-card setting, because there
// is no card yet to configure.
//
// The three answers are a real trade-off, which is why this is a switch rather than a
// hard-coded choice:
//
//   "entity-and-rooms"  a working preview of the user's OWN data, and a rooms list they
//                       can see, so it is visible that this card compares rooms at all.
//   "entity"            a working preview and nothing else. Simplest, but a user who
//                       never sees `rooms:` may never learn the card does that.
//   "template"          the placeholder configuration from the quickstart. Teaches the
//                       shape immediately, at the price of a preview that shows no data
//                       until the invented ids are replaced.
//
// Changing this constant is the whole change; everything below reads it.
export const BROWSE_DISCOVERY = "entity-and-rooms";

// How many rooms the browse path is willing to offer. Three is what the quickstart
// shows, and enough for the room comparison to be visible without filling the preview
// with a system's entire sensor list.
const BROWSE_ROOM_LIMIT = 3;

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

// The browse path only ever offers `sensor.*`, which is what Home Assistant's own cards
// do when they search for something to start with. A `number.*` or `input_number.*` with
// a temperature device class would read correctly, but it is a control rather than a
// measurement, and offering one unasked as somebody's home average is a worse first
// impression than one room fewer. The ENTITY path applies no such filter: there the user
// pointed at it deliberately.
const SENSOR_DOMAIN = "sensor.";

function isSupportedEntity(states, entityId) {
  return typeof entityId === "string" && Boolean(metricKindForEntity(states, entityId));
}

function isBrowsableEntity(states, entityId) {
  return typeof entityId === "string" && entityId.startsWith(SENSOR_DOMAIN) && isSupportedEntity(states, entityId);
}

// Whether the card could actually SHOW this entity right now, decided by the same
// EntityModel the runtime uses rather than by a second opinion about what "usable"
// means. A sensor that is unavailable, non-numeric, in a unit the card cannot read or
// outside its own physical limits is recognized, but would render as no data.
function isUsableEntity(states, entityId) {
  if (!isBrowsableEntity(states, entityId)) return false;
  return buildEntityModel(states, null, entityId, "primary").availability === AVAILABILITY.USABLE;
}

// Null for everything this card cannot read, which Home Assistant's own guidance asks
// for explicitly: a suggestion that renders a no-data card is worse than no suggestion.
//
// An entity that is merely `unavailable` right now IS still offered. It remains a
// climate entity, the card renders that state deliberately, and excluding it would make
// the card disappear from the picker during every restart window. It is also an entity
// the user chose on purpose — which is exactly what the browse path below cannot say of
// anything it finds by itself, and why only that path insists on a usable sensor.
export function suggestionsForEntity(states, entityId) {
  if (!isSupportedEntity(states, entityId)) return null;
  return { config: { type: CONFIG_TYPE, entity: entityId } };
}

// Every candidate the picker gave us, then everything else, in that order and without
// repeats. Home Assistant passes what the current view already uses first and a broader
// fallback second, and its own cards search them in that order; searching all of
// `states` afterwards is this card's own third step, because a climate sensor anywhere
// is still a better start than an invented id.
function browseCandidates(states, entities, entitiesFallback) {
  // Sorted, because `Object.keys` follows insertion order and Home Assistant builds that
  // object from whatever arrived first. Without this the preview could show a different
  // sensor on every reload of the same system, which looks like a bug in the card. The
  // two lists Home Assistant supplies keep THEIR order: it is a preference, not an
  // accident.
  const all = states && typeof states === "object" ? Object.keys(states).sort() : [];
  const ordered = [...[entities, entitiesFallback].filter(Array.isArray).flat(), ...all];
  return [...new Set(ordered.filter((entityId) => typeof entityId === "string"))];
}

// The rooms the browse path is willing to offer: the same measurement as the primary,
// usable right now, and named by the system rather than by us. An entity with no
// friendly name is skipped — a chip showing a bare entity id reads worse in a preview
// than one room fewer does.
function browseRooms(states, candidates, primary) {
  const kind = metricKindForEntity(states, primary);
  const rooms = [];
  for (const entityId of candidates) {
    if (rooms.length >= BROWSE_ROOM_LIMIT) break;
    if (entityId === primary) continue;
    // Same measurement as the primary, or the card would be asked to average a humidity
    // into a temperature. The card refuses that at runtime; the picker must not build it.
    if (metricKindForEntity(states, entityId) !== kind) continue;
    if (!isUsableEntity(states, entityId)) continue;
    const name = states?.[entityId]?.attributes?.friendly_name;
    if (typeof name !== "string" || !name.trim()) continue;
    rooms.push({ name: name.trim(), entity: entityId });
  }
  return rooms;
}

// The starting configuration for the browse path.
//
// Two passes, and the order is the point: a sensor that is merely RECOGNIZED can still
// be unavailable, and starting the user off with one produces exactly the empty card
// the preview exists to avoid. So a usable sensor wins over a recognized one anywhere
// in the list, and only when nothing at all is usable does a recognized one get the job
// — which is still better than an invented id.
export function stubConfigFor(states, entities, entitiesFallback) {
  if (BROWSE_DISCOVERY === "template") return templateConfig();

  const candidates = browseCandidates(states, entities, entitiesFallback);
  const primary =
    candidates.find((entityId) => isUsableEntity(states, entityId)) ||
    candidates.find((entityId) => isBrowsableEntity(states, entityId));
  if (!primary) return templateConfig();

  if (BROWSE_DISCOVERY !== "entity-and-rooms") return { entity: primary };
  const rooms = browseRooms(states, candidates, primary);
  return rooms.length ? { entity: primary, rooms } : { entity: primary };
}
