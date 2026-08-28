"use strict";

// ONE WAY TO DESCRIBE A CARD SITUATION, for every layer of the suite.
//
// A test needs two things: a YAML configuration and a `hass` object. Before this file the
// suite built both by hand, in seventy files, in as many dialects — and the differences
// between those dialects were never intentional. Some entities carried a unit, some did
// not; some rooms had names, some did not. The randomized test built its own variant and
// omitted `unit_of_measurement` entirely, which is why it spent five hundred iterations
// rendering the no-data card without anyone noticing.
//
// TWO FACES, ONE DESCRIPTION.
//
//   scenario().temperature().rooms(3).unit("°F").build()   // for a person to read
//   buildScenario(description)                             // for a generator to emit
//
// The fluent chain does nothing but assemble the same plain description object that
// buildScenario() takes. That is the point: a case the property generator finds is a
// description, a description is JSON, and JSON can be printed into a bug report, shrunk
// structurally, and pasted back into a hand-written test unchanged.
//
// WHY ATTRIBUTES ARE DESCRIBED AND NOT WRITTEN. An entity does not carry
// `{ device_class: "temperature" }` here; it carries "a device class, spelled
// `device_class`, valued `temperature`". Splitting the KEY from the VALUE is what lets a
// generator misspell one without touching the other — a template sensor with `device_clas`
// is a real mistake a real user makes, and the card's behaviour there is worth knowing. It
// also lets the shrinker pull one axis back to normal at a time.

const { METRICS, METRIC_KINDS, DEFAULT_LANGUAGE } = require("../manifests/product-surface.js");

const DEVICE_CLASS_KEY = "device_class";
const UNIT_KEY = "unit_of_measurement";

// A value in the middle of each metric's comfortable range: what a test means when it does
// not care about the number.
const TYPICAL_VALUE = { temperature: 21, humidity: 45, co2: 700, pm25: 8 };

// Room values spread around the typical one so coldest and warmest actually differ.
const ROOM_SPREAD = { temperature: 1.5, humidity: 6, co2: 180, pm25: 3 };

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

// ------------------------------------------------------------------ description --

// Resolves one described attribute against the scenario-wide default and the metric's
// canonical value, in that order of precedence: what this entity says, then what the
// scenario says, then what the metric is.
//
// `null` at either level means "no such attribute" — a sensor that reports no unit at all.
// An object at the entity level wins even over a `null` default, because the entity is the
// more specific statement.
function resolveAttribute(own, fallback, canonicalKey, canonicalValue) {
  if (own === null) return null;
  const inherited = fallback === null ? null : { key: canonicalKey, value: canonicalValue, ...(fallback || {}) };
  if (own === undefined) return inherited;
  return { key: canonicalKey, value: canonicalValue, ...(fallback || {}), ...own };
}

// Fills in everything a description leaves out, so buildScenario() never has to ask
// whether a field is present. Pure: it does not touch its argument.
function describeEntity(raw, { metric, id, index, defaults }) {
  const source = raw === null || raw === undefined ? {} : raw;
  const typical = TYPICAL_VALUE[metric];
  const spread = ROOM_SPREAD[metric];
  const fallbackValue =
    index === null ? typical : Math.round((typical + spread * (((index % 5) - 2) / 2)) * 100) / 100;
  return withoutUndefined({
    id: source.id === undefined ? id : source.id,
    // false means the entity is configured but absent from hass.states — the "entity not
    // found" path, which is not the same as `unavailable`.
    present: source.present === undefined ? true : source.present,
    state: source.state === undefined ? fallbackValue : source.state,
    deviceClass: resolveAttribute(source.deviceClass, defaults.deviceClass, DEVICE_CLASS_KEY, METRICS[metric].deviceClass),
    unit: resolveAttribute(source.unit, defaults.unit, UNIT_KEY, METRICS[metric].canonicalUnit),
    extraAttributes: source.extraAttributes ? { ...source.extraAttributes } : {},
    // Which of the TIMESTAMPS shapes this entity reports. Absent means the ordinary one.
    timestamps: source.timestamps,
    // Room-only, ignored for the primary entity.
    name: source.name === undefined ? (index === null ? undefined : `Room ${index}`) : source.name,
    short: source.short === undefined ? (index === null ? undefined : `R${index}`) : source.short,
    // Per-room action overrides, passed through to the room entry as written.
    tap_action: source.tap_action,
    hold_action: source.hold_action,
  });
}

function describeScenario(raw) {
  const source = raw === null || raw === undefined ? {} : raw;
  const metric = source.metric === undefined ? "temperature" : source.metric;
  if (!METRIC_KINDS.includes(metric)) {
    throw new Error(`scenario: unknown metric "${metric}" — the manifest names ${METRIC_KINDS.join(", ")}`);
  }
  // Scenario-wide defaults. They are applied at BUILD time, not when .unit() is called, so
  // .unit("K").rooms(3) and .rooms(3).unit("K") mean the same thing. An earlier version
  // rewrote the rooms added so far, and the ordering trap that created cost a test.
  const defaults = source.defaults ? { ...source.defaults } : {};
  const hassGaps = Array.isArray(source.hassGaps) ? [...source.hassGaps] : [];
  const theme = source.theme;
  const rooms = (source.rooms || []).map((room, index) =>
    describeEntity(room, { metric, id: `sensor.room${index}`, index, defaults })
  );
  // Entities that exist in `hass.states` WITHOUT being configured as rooms. That is what a
  // `range_entity` or a `trend_entity` is: the card reads it, and it must not turn into a
  // room chip. Without this the two roles could not be told apart in a description.
  const extras = (source.extras || []).map((entity, index) =>
    describeEntity({ name: null, short: null, ...entity }, {
      metric,
      id: entity.id || `sensor.extra${index}`,
      index: null,
      defaults,
    })
  );
  // Absent means "the ordinary primary entity"; an explicit null means "no primary entity
  // is configured at all" — a rooms-only card, which is a supported and quite different
  // shape.
  const primary =
    source.primary === null
      ? null
      : describeEntity(source.primary, { metric, id: "sensor.avg", index: null, defaults });
  return withoutUndefined({
    metric,
    defaults,
    extras,
    language: source.language === undefined ? DEFAULT_LANGUAGE : source.language,
    primary,
    rooms,
    // Which fields the `hass` object is missing, and which theme it declares. Both describe
    // the ENVIRONMENT rather than the card, which is why they sit beside the entities and not
    // in `config` — see buildScenario().
    hassGaps,
    theme,
    // Merged over the generated configuration, last. Anything the card accepts goes here:
    // palette, views, view options, subtitle, actions, custom profiles.
    config: source.config ? { ...source.config } : {},
  });
}

// ----------------------------------------------------------------------- building --

function attributesOf(entity) {
  const attributes = {};
  if (entity.deviceClass) attributes[entity.deviceClass.key] = entity.deviceClass.value;
  if (entity.unit) attributes[entity.unit.key] = entity.unit.value;
  return { ...attributes, ...entity.extraAttributes };
}

// WHEN THE READING LAST MOVED, which the card uses to decide what has changed since the
// previous render.
//
// Fixed and identical by default, because a test that does not mention time should not get a
// different card on the second run. The named alternatives are the ones a real installation
// produces: a template sensor that reports no timestamps at all, a sensor whose state and
// attributes moved together, and a clock that is ahead of the browser.
const FIXED_TIME = "2026-01-01T00:00:00.000Z";
const TIMESTAMPS = {
  normal: { last_changed: FIXED_TIME, last_updated: "2026-01-01T00:05:00.000Z" },
  identical: { last_changed: FIXED_TIME, last_updated: FIXED_TIME },
  missing: {},
  future: { last_changed: "2099-01-01T00:00:00.000Z", last_updated: "2099-01-01T00:00:00.000Z" },
  malformed: { last_changed: "not-a-timestamp", last_updated: "not-a-timestamp" },
};

function stateObjectOf(entity) {
  const timestamps = TIMESTAMPS[entity.timestamps] || TIMESTAMPS.identical;
  // Home Assistant always hands the frontend a STRING state, whatever the sensor's
  // template produced. Anything that arrives here as a non-string is stringified the same
  // way HA would, so a test cannot accidentally hand the card a native number it would
  // never see in production.
  return {
    entity_id: entity.id,
    state: String(entity.state),
    attributes: attributesOf(entity),
    ...timestamps,
  };
}

// A description in, everything four layers of the suite need out.
function buildScenario(raw) {
  const description = describeScenario(raw);
  const states = {};
  const config = {};

  if (description.primary) {
    config.entity = description.primary.id;
    if (description.primary.present) states[description.primary.id] = stateObjectOf(description.primary);
  }
  if (description.rooms.length) {
    config.rooms = description.rooms.map((room) => {
      if (room.present) states[room.id] = stateObjectOf(room);
      const entry = { entity: room.id };
      if (room.name !== undefined) entry.name = room.name;
      if (room.short !== undefined) entry.short = room.short;
      if (room.tap_action !== undefined) entry.tap_action = room.tap_action;
      if (room.hold_action !== undefined) entry.hold_action = room.hold_action;
      return entry;
    });
  }
  // Present in hass, absent from the configuration.
  for (const extra of description.extras) {
    if (extra.present) states[extra.id] = stateObjectOf(extra);
  }
  Object.assign(config, description.config);

  // WHAT HOME ASSISTANT HANDS THE CARD, and what it sometimes does not.
  //
  // `hassGaps` names fields to leave out. Every one of them is a real state a dashboard
  // passes through: `hass` arrives before the locale is resolved, a custom setup has no
  // themes object, and a card can be given a `hass` whose `states` is still empty. The card
  // has to render — or refuse cleanly — in all of them, and a description that says nothing
  // gets the complete object.
  const gaps = new Set(description.hassGaps || []);
  const hass = {};
  if (!gaps.has("language")) hass.language = description.language;
  if (!gaps.has("locale")) hass.locale = { language: description.language };
  hass.states = gaps.has("states") ? {} : states;
  if (!gaps.has("callService")) hass.callService = () => {};
  // Absent unless asked for: the builder used to omit `themes` entirely, so "no themes" is
  // what every existing test means and has to keep meaning.
  if (description.theme && !gaps.has("themes")) hass.themes = { darkMode: description.theme === "dark" };

  return { config, states, hass, language: description.language, description };
}

// -------------------------------------------------------------------- fluent face --

// Immutable: every step returns a new builder, so a half-built scenario can be shared by
// several tests without one of them reaching back into another.
class ScenarioBuilder {
  constructor(description) {
    this._d = description || {};
  }

  _with(patch) {
    return new ScenarioBuilder({ ...this._d, ...patch });
  }

  _default(patch) {
    return this._with({ defaults: { ...this._d.defaults, ...patch } });
  }

  metric(kind) {
    return this._with({ metric: kind });
  }
  temperature() {
    return this.metric("temperature");
  }
  humidity() {
    return this.metric("humidity");
  }
  co2() {
    return this.metric("co2");
  }
  pm25() {
    return this.metric("pm25");
  }

  language(code) {
    return this._with({ language: code });
  }

  // The primary entity. `primary(null)` configures none at all — a rooms-only card.
  primary(valueOrPatch) {
    if (valueOrPatch === null) return this._with({ primary: null });
    if (valueOrPatch === undefined) return this._with({ primary: { ...this._d.primary } });
    if (typeof valueOrPatch === "object") return this._with({ primary: { ...this._d.primary, ...valueOrPatch } });
    return this._with({ primary: { ...this._d.primary, state: valueOrPatch } });
  }
  primaryUnavailable() {
    return this.primary({ state: "unavailable" });
  }
  // Configured, but not in hass.states at all. A different card state from `unavailable`.
  primaryMissing() {
    return this.primary({ present: false });
  }

  // N rooms with sensible, spread-out values.
  rooms(count) {
    return this._with({ rooms: Array.from({ length: count }, () => ({})) });
  }
  // One more room, described explicitly.
  room(patch) {
    return this._with({ rooms: [...(this._d.rooms || []), patch || {}] });
  }

  // An entity that exists but is not a room — what a range_entity or trend_entity is.
  extra(patch) {
    return this._with({ extras: [...(this._d.extras || []), patch || {}] });
  }

  // Scenario-wide, order-independent, and overridable per room. The common case is one
  // unit for the whole card; a mixed-unit card says so per room with .room({ unit: … }).
  unit(value, key) {
    return this._default({ unit: key === undefined ? { value } : { key, value } });
  }
  noUnit() {
    return this._default({ unit: null });
  }
  deviceClass(value, key) {
    return this._default({ deviceClass: key === undefined ? { value } : { key, value } });
  }
  noDeviceClass() {
    return this._default({ deviceClass: null });
  }

  config(patch) {
    return this._with({ config: { ...this._d.config, ...patch } });
  }

  describe() {
    return describeScenario(this._d);
  }
  build() {
    return buildScenario(this._d);
  }
}

function scenario(description) {
  return new ScenarioBuilder(description);
}

module.exports = { scenario, buildScenario, describeScenario, DEVICE_CLASS_KEY, UNIT_KEY, TYPICAL_VALUE };
