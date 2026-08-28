"use strict";

// The scenario builder is a fixture, and a fixture that lies is worse than no fixture at
// all: everything downstream inherits the lie and reports it as a pass. The randomized
// test is the cautionary tale — its home-grown entity builder omitted
// `unit_of_measurement`, so five hundred iterations rendered the no-data card and every
// one of them was green.
//
// So this file checks two separate things. First, that the builder produces what it says
// it produces. Second, and more importantly, that what it produces is a card the product
// actually recognises — a `hass` object the card reads and a configuration it accepts.
// The second is the check the old builder never had.

const test = require("node:test");
const assert = require("node:assert/strict");

const { scenario, buildScenario, describeScenario, DEVICE_CLASS_KEY, UNIT_KEY } = require("./scenario.js");
const { METRICS, METRIC_KINDS } = require("../manifests/product-surface.js");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

// ------------------------------------------------------- what it builds --

test("the default scenario is one primary temperature entity and nothing else", () => {
  const built = scenario().build();
  assert.deepEqual(built.config, { entity: "sensor.avg" });
  assert.deepEqual(Object.keys(built.states), ["sensor.avg"]);
  assert.deepEqual(built.states["sensor.avg"].attributes, {
    device_class: "temperature",
    unit_of_measurement: "°C",
  });
});

test("every metric builds with its own device class and canonical unit", () => {
  for (const kind of METRIC_KINDS) {
    const { states } = scenario().metric(kind).build();
    assert.deepEqual(
      states["sensor.avg"].attributes,
      { [DEVICE_CLASS_KEY]: METRICS[kind].deviceClass, [UNIT_KEY]: METRICS[kind].canonicalUnit },
      kind
    );
  }
});

test("an unknown metric is refused rather than quietly building a temperature card", () => {
  assert.throws(() => scenario().metric("pressure").build(), /unknown metric "pressure"/);
});

test("rooms get distinct entities, names and spread-out values", () => {
  const { config, states } = scenario().rooms(4).build();
  const entities = config.rooms.map((room) => room.entity);
  assert.equal(new Set(entities).size, 4, "no two rooms share an entity");
  const values = entities.map((id) => Number(states[id].state));
  assert.ok(values.every(Number.isFinite), values.join(", "));
  assert.notEqual(Math.min(...values), Math.max(...values), "coldest and warmest must differ");
});

test("a rooms-only card configures no entity at all", () => {
  const { config, states } = scenario().primary(null).rooms(2).build();
  assert.equal(config.entity, undefined);
  assert.equal(states["sensor.avg"], undefined);
  assert.equal(config.rooms.length, 2);
});

test("`present: false` configures the entity but leaves it out of hass.states", () => {
  const { config, states } = scenario().primaryMissing().build();
  assert.equal(config.entity, "sensor.avg", "still configured — that is the whole point");
  assert.equal(states["sensor.avg"], undefined, "and not found");
});

test("the state is always a string, the way Home Assistant delivers it", () => {
  const { states } = scenario().primary(21.5).build();
  assert.equal(typeof states["sensor.avg"].state, "string");
  assert.equal(states["sensor.avg"].state, "21.5");
});

test("the attribute KEY can be misspelled without touching the value", () => {
  const { states } = scenario().deviceClass("temperature", "device_clas").build();
  assert.deepEqual(states["sensor.avg"].attributes, {
    device_clas: "temperature",
    unit_of_measurement: "°C",
  });
});

test("units and device classes can differ per room", () => {
  const { states } = scenario()
    .temperature()
    .room({ unit: { value: "°C" } })
    .room({ unit: { value: "K" } })
    .room({ unit: null })
    .build();
  assert.equal(states["sensor.room0"].attributes[UNIT_KEY], "°C");
  assert.equal(states["sensor.room1"].attributes[UNIT_KEY], "K");
  assert.equal(states["sensor.room2"].attributes[UNIT_KEY], undefined);
});

test("extra configuration is merged last, so it can override what the builder generated", () => {
  const { config } = scenario().rooms(1).config({ palette: "vivid", rooms: [] }).build();
  assert.equal(config.palette, "vivid");
  assert.deepEqual(config.rooms, [], "an explicit config key wins over the generated one");
});

// ------------------------------------------------------ the description --

test("the builder is immutable — a shared prefix cannot be mutated by a later step", () => {
  const base = scenario().temperature().rooms(2);
  const celsius = base.unit("°C").build();
  const kelvin = base.unit("K").build();
  assert.equal(celsius.states["sensor.room0"].attributes[UNIT_KEY], "°C");
  assert.equal(kelvin.states["sensor.room0"].attributes[UNIT_KEY], "K");
});

test("unit and device class are scenario-wide defaults, whatever order they are written in", () => {
  // The trap this locks out: an earlier version applied .unit() to the rooms that existed
  // AT THAT MOMENT, so .unit("K").rooms(3) silently gave three Celsius rooms. Order must
  // not carry meaning here, because nothing about the chain suggests that it does.
  const before = scenario().temperature().unit("K").rooms(3).build();
  const after = scenario().temperature().rooms(3).unit("K").build();
  assert.deepEqual(before.states, after.states);
  for (const id of ["sensor.avg", "sensor.room0", "sensor.room1", "sensor.room2"]) {
    assert.equal(before.states[id].attributes[UNIT_KEY], "K", id);
  }
});

test("a room overrides the scenario-wide default, including back to having no unit", () => {
  const { states } = scenario().unit("K").room({ unit: { value: "°F" } }).room({ unit: null }).build();
  assert.equal(states["sensor.avg"].attributes[UNIT_KEY], "K");
  assert.equal(states["sensor.room0"].attributes[UNIT_KEY], "°F");
  assert.equal(states["sensor.room1"].attributes[UNIT_KEY], undefined);
});

test("an entity can re-add an attribute the scenario removed", () => {
  const { states } = scenario().noUnit().room({ unit: { value: "°C" } }).build();
  assert.equal(states["sensor.avg"].attributes[UNIT_KEY], undefined);
  assert.equal(states["sensor.room0"].attributes[UNIT_KEY], "°C", "the more specific statement wins");
});

test("a sensor reports the timestamps it was asked for, and ordinary ones by default", () => {
  // Fixed and identical unless a description says otherwise, so a test that never mentions
  // time gets the same card on every run.
  const plain = buildScenario({ rooms: [{}] });
  const [first] = Object.values(plain.states);
  assert.equal(first.last_changed, first.last_updated);
  assert.match(first.last_updated, /^2026-/);

  const varied = buildScenario({
    rooms: [{ timestamps: "missing" }, { timestamps: "future" }, { timestamps: "normal" }, { timestamps: "malformed" }],
  });
  const [, missing, future, normal, malformed] = Object.values(varied.states);
  assert.equal("last_updated" in missing, false, "a template sensor can report no timestamps at all");
  assert.equal("last_changed" in missing, false);
  assert.match(future.last_updated, /^2099-/, "a clock ahead of the browser");
  assert.notEqual(normal.last_changed, normal.last_updated, "an attribute-only update moves one and not the other");
  assert.equal(malformed.last_updated, "not-a-timestamp");
});

test("hass can arrive without the fields a card expects", () => {
  const complete = buildScenario({ rooms: [{}] }).hass;
  assert.deepEqual(Object.keys(complete).sort(), ["callService", "language", "locale", "states"]);
  assert.equal("themes" in complete, false, "no theme unless one is asked for, which is what every existing test means");

  const gapped = buildScenario({ rooms: [{}], hassGaps: ["locale", "callService"] }).hass;
  assert.equal("locale" in gapped, false);
  assert.equal("callService" in gapped, false);
  assert.equal("language" in gapped, true, "and nothing else was removed");

  // `states` is emptied rather than removed: Home Assistant always passes the field, and a
  // dashboard being restored passes it empty.
  const stateless = buildScenario({ rooms: [{}], hassGaps: ["states"] }).hass;
  assert.deepEqual(stateless.states, {});

  for (const theme of ["dark", "light"]) {
    assert.deepEqual(buildScenario({ rooms: [{}], theme }).hass.themes, { darkMode: theme === "dark" });
  }

  const themeGap = buildScenario({ rooms: [{}], theme: "dark", hassGaps: ["themes"] }).hass;
  assert.equal("themes" in themeGap, false, "a declared theme does not override the missing-themes environment axis");
});

test("a built scenario carries a description that rebuilds it exactly", () => {
  // This is what makes a randomly found case reportable and shrinkable: the description is
  // plain JSON, and JSON in gives the same card out.
  const original = scenario().co2().rooms(3).primaryUnavailable().config({ palette: "signal" }).build();
  const rebuilt = buildScenario(original.description);
  assert.deepEqual(rebuilt.config, original.config);
  assert.deepEqual(rebuilt.states, original.states);
});

test("describing is idempotent — a full description describes to itself", () => {
  const once = describeScenario({ metric: "humidity", rooms: [{}, {}] });
  assert.deepEqual(describeScenario(once), once);
});

// --------------------------------------- what the product makes of it --

test("the default scenario produces a card with data, not the no-data state", () => {
  // The check the previous generator lacked. Without it a fixture can drift into a shape
  // the entity model rejects, and every test built on it silently stops testing.
  const built = scenario().rooms(3).build();
  const el = env.createCard(built.config, built.hass);
  const data = el._computeViewModel();
  assert.equal(data.empty, false, "the ordinary scenario must produce a usable card");
  env.cleanup(el);
});

test("every metric produces a card with data", () => {
  for (const kind of METRIC_KINDS) {
    const built = scenario().metric(kind).rooms(2).build();
    const el = env.createCard(built.config, built.hass);
    assert.equal(el._computeViewModel().empty, false, kind);
    env.cleanup(el);
  }
});

test("every non-canonical temperature unit still produces a card with data", () => {
  for (const unit of ["°C", "°F", "K"]) {
    const built = scenario().temperature().unit(unit).rooms(2).build();
    const el = env.createCard(built.config, built.hass);
    assert.equal(el._computeViewModel().empty, false, unit);
    env.cleanup(el);
  }
});

test("a misspelled device_class key really does break identification", () => {
  // Proof that the misspelling axis is not decorative: it changes what the card sees.
  const built = scenario().deviceClass("temperature", "device_clas").noUnit().rooms(1).build();
  const el = env.createCard(built.config, built.hass);
  assert.equal(el._computeViewModel().empty, true, "with neither a readable class nor a unit there is no metric");
  env.cleanup(el);
});
