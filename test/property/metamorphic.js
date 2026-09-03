"use strict";

// Relations between two cards derived from one description. Each relation derives a sequence
// of configurations from the original description and the rendered base card, applies them
// to one card in order, and states what must and must not have moved between the first card
// and the last; derive() returns null when the relation does not apply to a case.
// Why the layer exists, the BUG-12 shape it was built for, `needsRenderedBase`, and the
// coverage guard in the runner: see internal dev doc §4 "Die metamorphe Schicht: zwei Karten
// statt einer".

const { METRICS } = require("../manifests/product-surface.js");
const { buildScenario } = require("../fixtures/scenario.js");

// `Number()` accepts states the card rejects ("", "  ", "0x10", "21."), and this file
// restates readings, so a relation that restates one may only touch a plain decimal both
// sides read the same way.
const PLAIN_DECIMAL = /^\s*[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?\s*$/;

// ------------------------------------------------------------------ observation --

// Compared is the information the card shows — whether it gave up, which sources it used,
// where it put them, what it concluded — not the whole model. Room facts are keyed by
// entity, so "which rooms are on the card" is separable from "in what order"; one relation
// below is about that difference.
function observe(model) {
  if (!model) return null;
  // Raw, not rounded here: rounding here and applying a tolerance there are two instruments
  // fighting over one job. agree() below does the whole job.
  const markers = (model.roomMarkers || []).map((marker) => ({
    entity: marker.entity,
    value: marker.value,
    position: marker.position,
  }));
  return {
    empty: Boolean(model.empty),
    metricKind: model.metric ? model.metric.kind : null,
    unit: model.metric ? model.metric.unit : null,
    views: model.views && model.views.keys ? [...model.views.keys] : [],
    zone: model.tone ? model.tone.zone : null,
    average: model.average ? { value: model.average.value, position: model.average.position, source: model.average.source } : null,
    comfort: model.comfort ? { ...model.comfort } : null,
    spread: model.spread,
    markersByEntity: new Map(markers.map((marker) => [marker.entity, marker])),
    markerOrder: markers.map((marker) => marker.entity),
    extremes: model.extremes
      ? {
          coolest: model.extremes.coolest ? model.extremes.coolest.entity : null,
          warmest: model.extremes.warmest ? model.extremes.warmest.entity : null,
        }
      : null,
  };
}

// Numbers are compared with a relative tolerance, not rounded to fixed decimals: two cards
// often sum the same terms in a different order, and float addition is not associative. See
// internal dev doc §4 "Die metamorphe Schicht: zwei Karten statt einer".
const RELATIVE_TOLERANCE = 1e-9;

function numbersAgree(one, other) {
  if (Number.isNaN(one) && Number.isNaN(other)) return true;
  if (!Number.isFinite(one) || !Number.isFinite(other)) return one === other;
  const scale = Math.max(Math.abs(one), Math.abs(other), 1);
  return Math.abs(one - other) <= RELATIVE_TOLERANCE * scale;
}

// Deep equality with that tolerance. Everything that is not a number is compared exactly.
function agree(one, other) {
  if (typeof one === "number" || typeof other === "number") {
    return typeof one === "number" && typeof other === "number" && numbersAgree(one, other);
  }
  if (one === null || other === null || typeof one !== "object" || typeof other !== "object") return one === other;
  // A Map/Set has no own enumerable keys, so the object branch below would call any two
  // equal. Nothing passes one today; this guards against that starting unnoticed.
  if (one instanceof Map || other instanceof Map || one instanceof Set || other instanceof Set) {
    throw new Error("agree() compares plain values; unpack the Map before calling it");
  }
  if (Array.isArray(one) !== Array.isArray(other)) return false;
  if (Array.isArray(one)) return one.length === other.length && one.every((entry, index) => agree(entry, other[index]));
  const keys = Object.keys(one);
  if (keys.length !== Object.keys(other).length) return false;
  return keys.every((key) => key in other && agree(one[key], other[key]));
}

const entitiesOf = (observation) => [...observation.markersByEntity.keys()].sort();

// ------------------------------------------------------------------ description helpers --

const clone = (value) => JSON.parse(JSON.stringify(value));

// The sequence a relation returns: one built scenario per configuration to apply, in order.
const scenariosOf = (...descriptions) => descriptions.map((description) => buildScenario(description));

const roomsOf = (description) => (Array.isArray(description.rooms) ? description.rooms : []);

// Home Assistant's attribute name. A description can override it (a generator writing
// `device_clas`), and behind a misspelled name the card never reads the value.
const DEVICE_CLASS_KEY = "device_class";

// The device_class attribute (name and value) an entity carries, resolved the way the
// scenario builder resolves it: entity, then scenario default, then metric. `null` at either
// level means the sensor reports none.
function declaredDeviceClass(entity, description) {
  const own = entity && entity.deviceClass;
  if (own === null) return null;
  const fallback = description.defaults && description.defaults.deviceClass;
  if (own === undefined && fallback === null) return null;
  const canonical = { key: DEVICE_CLASS_KEY, value: METRICS[description.metric || "temperature"].deviceClass };
  return { ...canonical, ...(fallback || {}), ...(own || {}) };
}

// The device classes the card recognises, from the manifest rather than listed again here. A
// device class the card does not know (`timestamp`) declares nothing, so a card carrying one
// has no arbiter and a disagreement between its rooms genuinely empties it.
const KNOWN_DEVICE_CLASSES = new Set(Object.values(METRICS).map((metric) => metric.deviceClass));

// The entity id a description gives its primary.
const primaryIdOf = (description) => description.primary && (description.primary.id || "sensor.avg");

// The id a room in this description ends up with — the builder names an unnamed room after
// its position.
const roomIdAt = (room, index) => room.id || `sensor.room${index}`;

// Which description authored the primary entity's state. Usually the primary's own, but
// buildScenario() writes rooms after the primary, so a room configured with the primary's id
// overwrites it; a relation reading the primary's description then reads something the card
// never sees.
function primaryStateDescription(description) {
  if (!description.primary) return null;
  const primaryId = primaryIdOf(description);
  // And the card has to be able to find it: setConfig() trims the id while the builder stores
  // state under the id verbatim, so a padded `"  sensor.x  "` resolves to nothing and
  // declares no more than a missing primary.
  if (typeof primaryId !== "string" || primaryId !== primaryId.trim() || !primaryId) return null;
  const authors = description.primary.present === false ? [] : [description.primary];
  roomsOf(description).forEach((room, index) => {
    if (roomIdAt(room, index) === primaryId && room.present !== false) authors.push(room);
  });
  return authors.length ? authors[authors.length - 1] : null;
}

// Whether the primary entity is also a configured room. Then taking the primary away takes
// that room with it, and a relation about losing "no other" source has nothing to say.
function primaryIsAlsoARoom(description) {
  if (!description.primary) return false;
  const primaryId = primaryIdOf(description);
  return roomsOf(description).some((room, index) => roomIdAt(room, index) === primaryId);
}

function hasDeclaringPrimary(description) {
  const authored = primaryStateDescription(description);
  if (!authored) return false;
  const declared = declaredDeviceClass(authored, description);
  // Both halves must hold: a misspelled attribute name hides a good value, and a value the
  // card does not know says nothing behind a correct name.
  return Boolean(declared) && declared.key === DEVICE_CLASS_KEY && KNOWN_DEVICE_CLASSES.has(declared.value);
}

// A room reporting a metric this card is not about, chosen against the kind the card
// actually resolved to (not the kind the description asked for — they differ when every
// sensor carries a mismatched unit) and built from a real metric, so the card ignoring it is
// a legitimate decision rather than a rejection of malformed input.
function foreignRoom(actualKind, id) {
  const own = Object.keys(METRICS).find((metric) => METRICS[metric].deviceClass === actualKind || metric === actualKind);
  const other = Object.keys(METRICS).find((metric) => metric !== own);
  return {
    id,
    state: 50,
    deviceClass: { value: METRICS[other].deviceClass },
    unit: { value: METRICS[other].canonicalUnit },
    name: "Foreign",
    short: "FX",
  };
}

// ------------------------------------------------------------------ the relations --

const RELATIONS = [
  {
    name: "a room the card cannot use changes nothing else",
    why:
      "A room reporting a different metric is not data the card can show, and it is not a " +
      "reason to stop showing the data it can. Both cards have a primary entity declaring a " +
      "measurement the card knows, so both know which kind is theirs.",
    // Only meaningful against a card that was already showing something.
    needsRenderedBase: true,
    derive(description, base) {
      // Needs an arbiter, or the added room genuinely does change what the card is about.
      if (!hasDeclaringPrimary(description)) return null;
      const rooms = roomsOf(description);
      if (!rooms.length) return null;
      if (!base.metricKind) return null;
      // A single-room card is included on purpose: the foreign room is not a source of this
      // card's metric (src/application/model/source-topology.js), so the card stays the
      // single-room card it was. BUG-12 got this wrong; excluding the case excludes the defect.
      const next = clone(description);
      next.rooms = [...next.rooms, foreignRoom(base.metricKind, "sensor.foreign_kind")];
      return scenariosOf(next);
    },
    compare(base, derived) {
      const violations = [];
      if (derived.empty) {
        violations.push(
          `emptied by an unusable room: without it the card rendered ${base.markerOrder.length} room marker(s)` +
            `${base.average ? ` and an average of ${base.average.value}` : ""}, with it nothing at all`
        );
      }
      const lost = entitiesOf(base).filter((entity) => !derived.markersByEntity.has(entity));
      if (lost.length) violations.push(`rooms dropped when an unusable one was added: ${lost.join(", ")}`);
      if (base.metricKind !== derived.metricKind) {
        violations.push(`metric kind changed from ${base.metricKind} to ${derived.metricKind}`);
      }
      if (!derived.empty && !sameAverage(base, derived)) {
        violations.push(`average moved from ${JSON.stringify(base.average)} to ${JSON.stringify(derived.average)}`);
      }
      return violations;
    },
  },

  {
    name: "taking a source away removes that source and no other",
    why:
      "An entity going unavailable is the most ordinary thing that happens to a dashboard. " +
      "It may cost the card that entity's own contribution; it may not cost it the others.",
    needsRenderedBase: true,
    derive(description) {
      // The primary is made unavailable: its loss is the one that could plausibly read as
      // "the card has nothing left" — and, for a card with rooms, does not.
      if (!description.primary || description.primary.present === false) return null;
      if (description.primary.state === "unavailable") return null;
      if (roomsOf(description).length < 1) return null;
      // One entity cannot be taken away and kept: when the primary is also a room, losing it
      // is the loss this relation permits, not a second source going with it.
      if (primaryIsAlsoARoom(description)) return null;
      const next = clone(description);
      next.primary = { ...next.primary, state: "unavailable" };
      return scenariosOf(next);
    },
    compare(base, derived) {
      const violations = [];
      // Only rooms are compared: the average legitimately disappears when the primary was its
      // source, and the scale may legitimately move if the primary defined its range.
      const lost = entitiesOf(base).filter((entity) => !derived.markersByEntity.has(entity));
      if (lost.length) {
        violations.push(`rooms lost when only the primary went unavailable: ${lost.join(", ")}`);
      }
      // Only when there was something else to show: a card whose rooms are all unavailable
      // too is right to empty when its primary goes.
      if (!base.empty && derived.empty && base.markerOrder.length > 0) {
        violations.push(
          `the whole card emptied when only the primary went unavailable, discarding ${base.markerOrder.length} usable room(s)`
        );
      }
      return violations;
    },
  },

  {
    name: "giving a source back restores exactly what was there",
    why:
      "The card holds no state across renders, so an outage that ends has to leave the card " +
      "where it started. Anything that did not come back was being remembered rather than " +
      "computed.",
    derive(description) {
      if (!description.primary || description.primary.present === false) return null;
      if (description.primary.state === "unavailable") return null;
      // Away, then back. What is compared is the original card against the restored one, so
      // the relation is about the round trip rather than about the outage.
      const away = clone(description);
      away.primary = { ...away.primary, state: "unavailable" };
      return scenariosOf(away, description);
    },
    compare(base, derived) {
      return sameObservation(base, derived, "an outage that ended left the card different");
    },
  },

  {
    name: "the order rooms are written in does not change what they say",
    why:
      "`rooms:` is a list of sources, not a ranking. Reversing it may reorder the chips — " +
      "that is what the list is for — but the average, the extremes, the comfort counts and " +
      "each room's own position are facts about the readings.",
    derive(description) {
      const rooms = roomsOf(description);
      if (rooms.length < 2) return null;
      // Only the configuration is reordered: `hass` is the same object, so every sensor keeps
      // its id, reading and attributes; only the order the card is told about them differs.
      const scenario = buildScenario(description);
      return [scenario, { config: { ...scenario.config, rooms: [...scenario.config.rooms].reverse() }, hass: scenario.hass }];
    },
    compare(base, derived) {
      const violations = [];
      if (base.empty !== derived.empty) violations.push(`reversing the room list changed empty from ${base.empty} to ${derived.empty}`);
      if (base.empty) return violations;
      const before = entitiesOf(base);
      const after = entitiesOf(derived);
      if (before.join(",") !== after.join(",")) {
        violations.push(`reversing the room list changed which rooms appear: ${before.join(",")} -> ${after.join(",")}`);
      }
      for (const entity of before) {
        const one = base.markersByEntity.get(entity);
        const other = derived.markersByEntity.get(entity);
        if (!other) continue;
        if (!agree(one, other)) {
          violations.push(`${entity} moved from ${JSON.stringify(one)} to ${JSON.stringify(other)} when the list was reversed`);
        }
      }
      if (!sameAverage(base, derived)) violations.push("the average changed when the room list was reversed");
      if (!agree(base.comfort, derived.comfort)) {
        violations.push(`the comfort counts changed when the list was reversed: ${JSON.stringify(base.comfort)} -> ${JSON.stringify(derived.comfort)}`);
      }
      if (!agree(base.extremes, derived.extremes)) {
        violations.push(`the extremes changed when the list was reversed: ${JSON.stringify(base.extremes)} -> ${JSON.stringify(derived.extremes)}`);
      }
      return violations;
    },
  },

  {
    name: "the same readings in another unit describe the same rooms",
    why:
      "21 °C and 69.8 °F are one temperature. The number on the card differs and the unit " +
      "label differs; which sensors the card shows, and which of them is the warmest, do not.",
    needsRenderedBase: true,
    // Stated on the built scenario, not the description: what must hold is a fact about the
    // entities (every one the card reads reports °C, canonical spelling, finite state), which
    // a description cannot express. An earlier description-level form never applied across the
    // generated cases; the runner's coverage assertion caught that.
    derive(description) {
      const scenario = buildScenario(description);
      const states = scenario.hass && scenario.hass.states;
      if (!states) return null;

      const ids = Object.keys(states);
      if (!ids.length) return null;
      const readable = ids.every((id) => {
        const attributes = states[id] && states[id].attributes;
        if (!attributes || attributes.unit_of_measurement !== "°C") return false;
        return PLAIN_DECIMAL.test(String(states[id].state));
      });
      if (!readable) return null;
      // A configuration that pins its own thresholds states them in the card's canonical
      // unit, so restating the readings alone does not restate the card.
      const config = scenario.config || {};
      if (config.classification || config.optimal || config.comfort || config.range_entity) return null;

      const toFahrenheit = (celsius) => Math.round(((celsius * 9) / 5 + 32) * 100) / 100;
      const converted = {};
      for (const id of ids) {
        const entity = states[id];
        const fahrenheit = toFahrenheit(Number(entity.state));
        // -1e308 °C overflows to -Infinity °F; the card refuses it, but that would be a number
        // this file invented, so the relation stands down.
        if (!Number.isFinite(fahrenheit)) return null;
        converted[id] = {
          ...entity,
          state: String(fahrenheit),
          attributes: { ...entity.attributes, unit_of_measurement: "°F" },
        };
      }
      return [scenario, { config: scenario.config, hass: { ...scenario.hass, states: converted } }];
    },
    compare(base, derived) {
      const violations = [];
      if (base.empty !== derived.empty) {
        violations.push(`the same readings in °F ${derived.empty ? "emptied" : "filled"} a card that °C did not`);
        return violations;
      }
      if (base.empty) return null;
      if (base.unit === derived.unit) violations.push(`the card still reports ${base.unit} after every reading was restated in °F`);
      for (const entity of base.markersByEntity.keys()) {
        if (!derived.markersByEntity.has(entity)) violations.push(`${entity} is on the °C card and not on the °F one`);
      }
      // The order, not the positions: the card rounds scale bounds to a whole step in the
      // displayed unit, so end padding differs between °C and °F and every marker shifts a
      // little. What cannot change is which room is colder than which.
      if (base.markerOrder.join(",") !== derived.markerOrder.join(",")) {
        violations.push(`the rooms changed order between °C and °F: ${base.markerOrder.join(",")} -> ${derived.markerOrder.join(",")}`);
      }
      if (!agree(base.extremes, derived.extremes)) {
        violations.push(`the extremes changed between °C and °F: ${JSON.stringify(base.extremes)} -> ${JSON.stringify(derived.extremes)}`);
      }
      // Zone and comfort counts are deliberately not asserted: the card rounds projected
      // thresholds into the displayed unit, so a Fahrenheit household can get a different
      // verdict at a boundary than a Celsius one. See internal dev doc §4 "Die metamorphe
      // Schicht: zwei Karten statt einer" and the head of src/domain/classification/projection.js.
      return violations;
    },
  },

  {
    name: "applying the same configuration twice changes nothing",
    why:
      "setConfig is called again on every dashboard edit, and Home Assistant calls it with " +
      "the same object it called it with before. A card that answered differently the second " +
      "time would be carrying state it should not have.",
    derive(description) {
      const scenario = buildScenario(description);
      return [scenario, scenario];
    },
    compare(base, derived) {
      return sameObservation(base, derived, "the second setConfig produced a different card");
    },
  },
];

function sameAverage(base, derived) {
  return agree(base.average, derived.average);
}

function sameObservation(base, derived, headline) {
  const violations = [];
  const compare = (name, one, other) => {
    if (!agree(one, other)) {
      violations.push(`${headline}: ${name} went from ${JSON.stringify(one)} to ${JSON.stringify(other)}`);
    }
  };
  compare("empty", base.empty, derived.empty);
  compare("views", base.views, derived.views);
  compare("average", base.average, derived.average);
  compare("comfort", base.comfort, derived.comfort);
  compare("spread", base.spread, derived.spread);
  compare("extremes", base.extremes, derived.extremes);
  compare("the rooms shown", entitiesOf(base), entitiesOf(derived));
  for (const [entity, marker] of base.markersByEntity) {
    compare(`${entity}`, marker, derived.markersByEntity.get(entity) || null);
  }
  return violations;
}

module.exports = { RELATIONS, observe, entitiesOf };
