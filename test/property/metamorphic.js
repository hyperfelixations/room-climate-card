"use strict";

// RELATIONS BETWEEN TWO CARDS, rather than statements about one.
//
// WHY THIS LAYER HAD TO EXIST. Every invariant in properties.js looks at a single card and
// asks whether it is self-consistent — no NaN, positions inside the track, nothing unescaped
// in the DOM. That catches a card which is *wrong*. It cannot catch a card which is merely
// *worse than it should be*, because "worse" is a comparison and there was nothing to
// compare against.
//
// BUG-10 is exactly that shape. A card with three rooms, one of them reporting a metric the
// card does not use, renders perfectly: two markers, an average, no NaN anywhere. Make the
// primary entity unavailable and the whole card goes blank — and the blank card is *also*
// perfectly self-consistent. Every single-card invariant passes on both. Only putting them
// side by side shows that adding a room the card ignores turned two markers into none.
//
// HOW A RELATION IS WRITTEN. Each one derives a SEQUENCE of configurations from the original
// description and what the ORIGINAL CARD turned out to be, applies them to one card in order,
// and states what must and must not have moved between the original card and the last one.
// The derivation returns null when the relation does not apply to that case: most do not
// apply to most descriptions, and a relation that quietly applied anyway would be asserting
// something it was never given grounds for.
//
// A SEQUENCE RATHER THAN A SECOND DESCRIPTION, because two of the relations are about
// re-applying rather than about the description: an outage that ENDS is
// [unavailable, original], and setConfig being called twice with the same thing is
// [original, original]. Both are ordinary sequences, and neither needs the runner to be told
// anything special.
//
// WHAT A SEQUENCE IS MADE OF IS BUILT SCENARIOS, not descriptions, and that is not a
// convenience. "The order the rooms are written in" is a statement about the CONFIGURATION,
// and a description cannot express it: the scenario builder names an unnamed room after its
// position and derives its value from that position, so reordering a description swaps the
// identities and the readings of the rooms rather than reordering them. The relation has to
// reach the config to say what it means. Measured, both mistakes first showed up as
// violations that turned out to be in the derivation rather than in the card.
//
// THE PRECONDITIONS ARE THE CAREFUL PART. "Adding a room the card cannot use changes
// nothing" is FALSE for a card with no primary entity and no other room: there the added
// room is the only source, so of course everything changes. Every relation below therefore
// says what it needs, and says why — an over-eager precondition produces a test that fails
// on correct behaviour, which is worse than no test at all.
//
// SOME PRECONDITIONS CANNOT BE CHECKED ON THE DESCRIPTION ALONE. A relation may declare
// `needsRenderedBase`, and the runner then skips it whenever the original card rendered
// nothing — which is a statement about the built card, not about the description.
//
// It matters more than it sounds. A card whose every sensor contradicts itself
// (`device_class: pm25` with `unit_of_measurement: Gcal`) renders nothing at all, and adding
// a well-formed room to it correctly changes everything, because the added room is then the
// only source the card has: it may become a temperature card, and it may even be refused
// outright if the configuration pinned a classification profile that suits no temperature.
// Both were reported as violations before this existed, and both turned out to be correct
// behaviour. A relation about what a card PRESERVES has nothing to say about a card that was
// showing nothing.

const { METRICS } = require("../manifests/product-surface.js");
const { buildScenario } = require("../fixtures/scenario.js");

// A reading the card and JavaScript agree is a number.
//
// `Number()` is more generous than the card, and the difference matters here more than
// anywhere else: this file RESTATES readings, so a state the card rejects but Number()
// accepts comes back as a plain decimal the card does accept, and a room that was missing
// from the first card appears on the second. Measured, `""`, `"  "`, `"0x10"` and `"21."` all
// do that — Number() gives 0, 0, 16 and 21, and the card shows none of them.
//
// So a relation that restates a reading may only touch one both sides read the same way.
const PLAIN_DECIMAL = /^\s*[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?\s*$/;

// ------------------------------------------------------------------ observation --

// WHAT IS COMPARED, and it is deliberately not the whole model.
//
// Two cards derived from one description differ in things nobody promised would match — a
// tooltip naming a different entity, a room's own colour, the order chips happen to sit in.
// What a relation is about is the INFORMATION the card is showing: whether it gave up, which
// sources it used, where it put them, and what it concluded.
//
// Room-level facts are collected as a SET keyed by entity rather than as a list, so that
// "these rooms are on the card" is separable from "they are in this order" — one relation
// below is precisely about the difference.
function observe(model) {
  if (!model) return null;
  // Stored RAW. Rounding here and comparing there would be two instruments doing one job,
  // and the pair fights: rounding to a fixed grid can push two values that differ by 1e-9
  // onto neighbouring grid points a whole 1e-6 apart, which the tolerance then refuses. That
  // happened, and the case it reported was a reordered sum. agree() below does the whole job.
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
    // By entity, so a comparison can ask "is this room still on the card" without caring
    // where it ended up.
    markersByEntity: new Map(markers.map((marker) => [marker.entity, marker])),
    // And in order, for the one relation that is about order.
    markerOrder: markers.map((marker) => marker.entity),
    extremes: model.extremes
      ? {
          coolest: model.extremes.coolest ? model.extremes.coolest.entity : null,
          warmest: model.extremes.warmest ? model.extremes.warmest.entity : null,
        }
      : null,
  };
}

// NUMBERS ARE COMPARED WITH A RELATIVE TOLERANCE, not rounded to a fixed number of digits.
//
// Two cards derived from one description often compute the same quantity by summing the same
// terms in a different ORDER, and floating-point addition is not associative: reversing four
// room readings moved an average from 1043.805 to 1043.8049999999998 and a marker position by
// one part in a hundred million. Neither is a difference anybody could see, and neither is a
// defect.
//
// Rounding to a fixed number of decimals was tried first and is the wrong instrument: it
// merely moves the boundary, and a pair that straddles it still reports. A relative tolerance
// scales with the magnitude, which is how the error actually behaves — and at 1e-9 it is six
// orders of magnitude above the noise a reordered sum produces and far below any difference
// the card could mean.
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
  // A Map has no own enumerable keys, so the object branch below would call any two of them
  // equal. Nothing passes one today — the per-entity markers are looked up and compared as
  // plain objects — and this is here so that nothing can start to without noticing.
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

// The attribute name Home Assistant uses. A description can override it — that is how a
// generator writes `device_clas` on an otherwise well-formed sensor — and behind a
// misspelled name the card never reads the value at all.
const DEVICE_CLASS_KEY = "device_class";

// The device_class attribute an entity in this description carries, NAME AND VALUE, resolved
// the way the scenario builder resolves it: what the entity says, then what the scenario
// says, then what the metric is. `null` at either level means the sensor reports none.
function declaredDeviceClass(entity, description) {
  const own = entity && entity.deviceClass;
  if (own === null) return null;
  const fallback = description.defaults && description.defaults.deviceClass;
  if (own === undefined && fallback === null) return null;
  const canonical = { key: DEVICE_CLASS_KEY, value: METRICS[description.metric || "temperature"].deviceClass };
  return { ...canonical, ...(fallback || {}), ...(own || {}) };
}

// The device classes the card actually recognises, taken from the manifest rather than
// listed again here.
const KNOWN_DEVICE_CLASSES = new Set(Object.values(METRICS).map((metric) => metric.deviceClass));

// Whether a description carries a primary entity that DECLARES what it measures.
//
// The declaration is what matters and not the reading: `device_class: temperature` is a
// statement about the sensor, and an unavailable sensor still measures temperature. Several
// relations below rest on that, because it is the fact that lets the card arbitrate between
// rooms that disagree.
//
// A DEVICE CLASS THE CARD DOES NOT KNOW DECLARES NOTHING. `device_class: timestamp` tells
// this card no more than an absent one, so a card carrying it has no arbiter and a
// disagreement between its rooms genuinely empties it — the documented answer when nobody
// can settle which measurement the card is about. Counting such a value as a declaration
// made the relation assert that the card knew which kind was its own when it did not, and
// the generator reaches it: seed 0x13bb863d, a pm25 card whose primary declares `timestamp`.
function hasDeclaringPrimary(description) {
  if (!description.primary || description.primary.present === false) return false;
  const declared = declaredDeviceClass(description.primary, description);
  // BOTH HALVES have to be right, and the generator misses each of them separately: a
  // misspelled attribute NAME hides a perfectly good value (seed 0x42b771f0, `device_class `
  // with a trailing space), and a VALUE the card does not know says nothing behind a correct
  // name (seed 0x13bb863d, `device_class: timestamp`).
  return Boolean(declared) && declared.key === DEVICE_CLASS_KEY && KNOWN_DEVICE_CLASSES.has(declared.value);
}

// Whether the card refers to exactly one entity, which is also its only room.
//
// The scenario builder names the primary `sensor.avg` and an unnamed room after its
// position, so the two coincide only when a description says so explicitly.
function isSingleRoomCard(description) {
  const rooms = roomsOf(description);
  if (rooms.length !== 1 || !description.primary || description.primary.present === false) return false;
  const primaryId = description.primary.id || "sensor.avg";
  return (rooms[0].id || "sensor.room0") === primaryId;
}

// A room reporting something THIS CARD is not about.
//
// Chosen against the kind the card actually resolved to, not against the kind the description
// asked for. Those are not always the same: a description of a pm25 card whose sensors all
// carry a mismatched unit can end up rendering as something else entirely, and a "foreign"
// room picked from the description would then be the card's own kind — perfectly usable, and
// the relation would be asserting that a usable room changes nothing. Measured, that is
// exactly what happened: the average moved, correctly, and it was reported as a defect.
//
// Built from a real metric rather than from a nonsense value, so that the card ignoring it is
// a legitimate decision and not a rejection of malformed input.
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
    // Only meaningful against a card that was showing something — see the note above.
    needsRenderedBase: true,
    derive(description, base) {
      // Needs an arbiter, or the added room genuinely does change what the card is about.
      if (!hasDeclaringPrimary(description)) return null;
      const rooms = roomsOf(description);
      if (!rooms.length) return null;
      if (!base.metricKind) return null;
      // A ONE-ENTITY CARD IS A DIFFERENT KIND OF CARD, and adding any room changes which
      // kind it is rather than what it shows. When the primary entity is also the single
      // configured room, the headline genuinely IS that room and carries its name and its
      // tap action; with a second room the same card is a whole-home card that happens to
      // list its primary, and captioning it with one room's name would be wrong. The rule
      // and its reasoning are written out in src/application/model/source-topology.js.
      //
      // Without this the relation reports the caption moving from "Room 0" to "Home avg." —
      // which is the documented contract doing exactly what it says.
      if (isSingleRoomCard(description)) return null;
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
      // The primary is made unavailable, because that is the source whose loss could plausibly
      // be read as "the card has nothing left" — and, for a card with rooms, is not.
      if (!description.primary || description.primary.present === false) return null;
      if (description.primary.state === "unavailable") return null;
      if (roomsOf(description).length < 1) return null;
      const next = clone(description);
      next.primary = { ...next.primary, state: "unavailable" };
      return scenariosOf(next);
    },
    compare(base, derived) {
      const violations = [];
      // Only rooms are compared. The AVERAGE legitimately disappears when the primary was
      // the source of it, and the scale may legitimately move if the primary was defining
      // its range — neither is a room being lost.
      const lost = entitiesOf(base).filter((entity) => !derived.markersByEntity.has(entity));
      if (lost.length) {
        violations.push(`rooms lost when only the primary went unavailable: ${lost.join(", ")}`);
      }
      // ONLY WHEN THERE WAS SOMETHING ELSE TO SHOW. A card whose rooms are all unavailable
      // too has nothing left when its primary goes, and emptying is then the right answer.
      // Reported as a violation without this guard, and the minimal case it produced was a
      // correct card: one room, itself unavailable, on a card whose primary then went as well.
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
      // THE CONFIGURATION IS REORDERED AND NOTHING ELSE IS. `hass` is the same object, so
      // every sensor keeps its id, its reading and its attributes; only the order the card was
      // told about them in differs.
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
    // STATED ON THE BUILT SCENARIO rather than on the description, because what has to be
    // true is a fact about the ENTITIES: every one the card reads reports °C, spelled the
    // canonical way, with a finite number for a state. A description cannot say that — it can
    // say what it asked for, and the builder, the defaults and a misspelt attribute key all
    // sit between the asking and the result.
    //
    // Written against the description first, and it never once applied across 300 generated
    // cases: the generator states a unit or a device class on nearly every entity, and the
    // precondition excluded all of them. The coverage assertion in the runner is what caught
    // that, which is the whole reason it is there.
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
        // A reading near the floating-point ceiling overflows on the way: -1e308 °C is
        // -1.8e308 °F, which is -Infinity. That is BUG-07, it is already registered, and it is
        // not what this relation is about — restating it here would only mean feeding the card
        // a number this file invented.
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
      // THE ORDER, AND NOT THE POSITIONS. The two are not the same thing, and asserting the
      // positions was wrong: the card rounds its scale bounds to a whole step IN THE UNIT ON
      // SCREEN, so that the boundary labels read as numbers a person would write. A whole °F
      // is a smaller share of the same physical range than a whole °C, so the padding at each
      // end differs and every marker shifts by a percent or two — measured at up to seven
      // points on a narrow scale. That is the card doing its job, not a disagreement about
      // the readings. What cannot change is which room is colder than which.
      if (base.markerOrder.join(",") !== derived.markerOrder.join(",")) {
        violations.push(`the rooms changed order between °C and °F: ${base.markerOrder.join(",")} -> ${derived.markerOrder.join(",")}`);
      }
      if (!agree(base.extremes, derived.extremes)) {
        violations.push(`the extremes changed between °C and °F: ${JSON.stringify(base.extremes)} -> ${JSON.stringify(derived.extremes)}`);
      }
      // NEITHER THE ZONE NOR THE COMFORT COUNTS ARE ASSERTED, and that is a finding rather
      // than a gap. The card projects its thresholds into the unit on screen AND ROUNDS THEM,
      // so that the band it prints is the band it applies. The reasoning is written out at the
      // top of src/domain/classification/projection.js, which says in as many words that the
      // alternative would let a displayed 68 degree Fahrenheit comfort edge classify as if it
      // were 67.9.
      //
      // The consequence is real and was measured here: 23.9 C is `comfort`, and the same
      // temperature written as 75.02 F is `outside`, because 24 C projects to 75.2 F and
      // prints as 75. A household reading Fahrenheit gets a different verdict at the boundary
      // than one reading Celsius. That is a deliberate trade of physical exactness for
      // agreement with what the card says, so this relation states what survives it instead of
      // contradicting it.
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
