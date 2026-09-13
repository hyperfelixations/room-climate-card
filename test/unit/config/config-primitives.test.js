"use strict";

// Direct unit tests for the configuration readers, actions, rooms and views. A reader answers with
// the value it accepts or the one it falls back to, and records exactly one diagnostic for a value
// it refuses; a key the card does not know refuses the whole configuration, naming the option
// meant. The refusal messages are what Home Assistant shows, so they are asserted literally.
// Collaborators are stubbed, which is the point of injecting them.
// Boundary: this file owns the small readers and the structured readers for actions, rooms and
// views; whole-configuration assembly is config-normalize-modules.test.js. See internal dev doc
// §3 "Konfigurationsvertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let primitives;
let actions;
let rooms;
let views;
let core;
let errors;

const COLLABORATORS = {
  viewTypes: VIEWS,
  optionSchemaForView: (type) =>
    type === "scale"
      ? {
          show_comfort_band: { default: true, validate: (v) => typeof v === "boolean" },
          markers: { default: "extremes", validate: (v) => ["average", "extremes", "all"].includes(v) },
          legacy: { default: null },
        }
      : type === "range"
        ? { show_time: { default: true, validate: (v) => typeof v === "boolean" } }
        : undefined,
};

test.before(async () => {
  primitives = await import("../../../src/config/primitives.js");
  actions = await import("../../../src/config/actions.js");
  rooms = await import("../../../src/config/rooms.js");
  views = await import("../../../src/config/views.js");
  core = await import("../../../src/core/diagnostics.js");
  errors = await import("../../../src/config/errors.js");
});

// The diagnostic a reader records for an invalid value, built the way the reader builds it.
const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });

// What a refused configuration throws: the error Home Assistant shows, with its message.
const refusal = (message) => ({ name: "ConfigError", message });

// Runs one read with a fresh diagnostics list and returns both answers.
function reading(read) {
  const diagnostics = [];
  const result = read(diagnostics);
  return { result, diagnostics };
}

// ------------------------------------------------------------- primitives --

test("isPlainObject() rejects arrays and everything non-object", () => {
  const { isPlainObject } = primitives;
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  for (const value of [[], null, undefined, "x", 1, true, () => {}]) {
    assert.equal(isPlainObject(value), false, JSON.stringify(String(value)));
  }
});

test("a key the object does not have refuses the configuration, naming the option meant", () => {
  const { assertKnownKeys } = primitives;
  assert.doesNotThrow(() => assertKnownKeys({ min: 1, max: 2 }, ["min", "max"], "classification.scale"));
  assert.throws(
    () => assertKnownKeys({ min: 1, minn: 2 }, ["min", "max"], "classification.scale"),
    refusal("Invalid configuration: classification.scale.minn is not an option of this card. Did you mean classification.scale.min?")
  );
  const error = (() => {
    try {
      assertKnownKeys({ bogus: 1, other: 2 }, new Set(["min"]), "classification.scale");
    } catch (thrown) {
      return thrown;
    }
    return null;
  })();
  assert.ok(error instanceof errors.ConfigError);
  assert.equal(error.code, "config.unknown_key");
  assert.deepEqual(error.params, { key: "classification.scale.bogus", suggestion: null }, "the first unknown key, and no guess");
  assert.equal(error.message, "Invalid configuration: classification.scale.bogus is not an option of this card.");
});

test("requiredEntity() trims and refuses anything that is not an entity id", () => {
  const { requiredEntity } = primitives;
  assert.equal(requiredEntity("  sensor.a  ", "rooms[0].entity"), "sensor.a");
  for (const value of ["", "   ", null, undefined, 5, {}, []]) {
    assert.throws(
      () => requiredEntity(value, "rooms[2].entity"),
      refusal("Invalid configuration: rooms[2].entity must be an entity id."),
      JSON.stringify(String(value))
    );
  }
});

test("readSourceEntity() takes an empty entity as none and refuses a malformed one", () => {
  const { readSourceEntity } = primitives;
  for (const none of [undefined, null, ""]) assert.equal(readSourceEntity(none, "entity"), null, JSON.stringify(none));
  assert.equal(readSourceEntity(" sensor.a ", "entity"), "sensor.a");
  for (const value of [5, {}, [], "   "]) {
    assert.throws(() => readSourceEntity(value, "entity"), refusal("Invalid configuration: entity must be an entity id."), JSON.stringify(value));
  }
});

test("readBoolean() accepts exactly true and false, and names the default it uses instead", () => {
  const { readBoolean } = primitives;
  for (const value of [true, false]) {
    assert.deepEqual(reading((d) => readBoolean(value, "auto_slide", d, true)), { result: value, diagnostics: [] });
  }
  for (const value of [undefined, null]) {
    assert.deepEqual(reading((d) => readBoolean(value, "auto_slide", d, true)), { result: true, diagnostics: [] }, "not written");
  }
  for (const value of ["true", "false", "yes", "on", 1, 0, {}, ""]) {
    assert.deepEqual(
      reading((d) => readBoolean(value, "swipe", d, false)),
      { result: false, diagnostics: [invalid("swipe", value, core.fallbackValue(false))] },
      JSON.stringify(value)
    );
  }
});

test("readEnum() accepts the written word exactly and names the default otherwise", () => {
  const { readEnum } = primitives;
  const allowed = ["configured", "name", "value_asc"];
  assert.deepEqual(reading((d) => readEnum("name", "room_sort", d, allowed, "value_asc")), { result: "name", diagnostics: [] });
  assert.deepEqual(reading((d) => readEnum(undefined, "room_sort", d, allowed, "value_asc")), { result: "value_asc", diagnostics: [] });
  for (const value of ["NAME", "", 1, true, []]) {
    assert.deepEqual(
      reading((d) => readEnum(value, "room_sort", d, allowed, "value_asc")),
      { result: "value_asc", diagnostics: [invalid("room_sort", value, core.fallbackValue("value_asc"))] },
      JSON.stringify(value)
    );
  }
});

test("readNumber() accepts a number in its bounds and falls back rather than clamping", () => {
  const { readNumber } = primitives;
  const { FALLBACK, fallbackValue } = core;
  const decimals = { min: 0, max: 2, integer: true, fallback: null, instead: FALLBACK.METRIC_DECIMALS };
  for (const [value, expected] of [[0, 0], [1, 1], [2, 2], ["1", 1]]) {
    assert.deepEqual(reading((d) => readNumber(value, "decimals", d, decimals)), { result: expected, diagnostics: [] }, JSON.stringify(value));
  }
  for (const value of [-1, 3, 1.5, true, "x", {}, [], ""]) {
    assert.deepEqual(
      reading((d) => readNumber(value, "decimals", d, decimals)),
      { result: null, diagnostics: [invalid("decimals", value, FALLBACK.METRIC_DECIMALS)] },
      JSON.stringify(value)
    );
  }
  assert.deepEqual(reading((d) => readNumber(undefined, "decimals", d, decimals)), { result: null, diagnostics: [] });

  const seconds = { min: 1, max: 3600, fallback: 14 };
  assert.deepEqual(reading((d) => readNumber(30, "rotation_seconds", d, seconds)), { result: 30, diagnostics: [] });
  assert.deepEqual(reading((d) => readNumber("2.5", "rotation_seconds", d, seconds)), { result: 2.5, diagnostics: [] });
  assert.deepEqual(reading((d) => readNumber(null, "rotation_seconds", d, seconds)), { result: 14, diagnostics: [] });
  for (const value of [0.5, 99999, true]) {
    assert.deepEqual(
      reading((d) => readNumber(value, "rotation_seconds", d, seconds)),
      { result: 14, diagnostics: [invalid("rotation_seconds", value, fallbackValue(14))] },
      `${JSON.stringify(value)}: the default, not the nearest bound`
    );
  }
});

test("readText() keeps a written text and takes the automatic one for anything else", () => {
  const { readText } = primitives;
  assert.deepEqual(reading((d) => readText(" mdi:sofa ", "icon", d)), { result: "mdi:sofa", diagnostics: [] });
  assert.deepEqual(reading((d) => readText(undefined, "icon", d)), { result: null, diagnostics: [] });
  for (const value of ["", "   ", 42, true, {}]) {
    assert.deepEqual(
      reading((d) => readText(value, "icon", d)),
      { result: null, diagnostics: [invalid("icon", value, core.FALLBACK.AUTOMATIC)] },
      JSON.stringify(value)
    );
  }
});

test("readLabel() keeps every written text, the empty one included", () => {
  const { readLabel } = primitives;
  assert.deepEqual(reading((d) => readLabel(" Home ", "entity_label", d)), { result: "Home", diagnostics: [] });
  assert.deepEqual(reading((d) => readLabel("", "entity_label", d)), { result: "", diagnostics: [] }, '"" means no caption');
  assert.deepEqual(reading((d) => readLabel("   ", "entity_label", d)), { result: "", diagnostics: [] });
  assert.deepEqual(reading((d) => readLabel(null, "entity_label", d)), { result: null, diagnostics: [] });
  for (const value of [5, true, []]) {
    assert.deepEqual(
      reading((d) => readLabel(value, "entity_label", d)),
      { result: null, diagnostics: [invalid("entity_label", value, core.FALLBACK.AUTOMATIC)] },
      JSON.stringify(value)
    );
  }
});

test("readOptionalEntity() takes an empty entity as none and ignores a malformed one", () => {
  const { readOptionalEntity } = primitives;
  for (const none of [undefined, null, ""]) {
    assert.deepEqual(reading((d) => readOptionalEntity(none, "range_entity", d)), { result: null, diagnostics: [] }, JSON.stringify(none));
  }
  assert.deepEqual(reading((d) => readOptionalEntity(" sensor.r ", "range_entity", d)), { result: "sensor.r", diagnostics: [] });
  for (const value of [5, {}, [], "   "]) {
    assert.deepEqual(
      reading((d) => readOptionalEntity(value, "trend_entity", d)),
      { result: null, diagnostics: [invalid("trend_entity", value, core.FALLBACK.IGNORED)] },
      JSON.stringify(value)
    );
  }
});

test("readNumberAtPath() refuses the value at its path, for the object that holds it to answer", () => {
  const { readNumberAtPath } = primitives;
  assert.equal(readNumberAtPath("21.5", "classification.scale.min"), 21.5);
  for (const value of ["x", true, undefined]) {
    assert.throws(
      () => readNumberAtPath(value, "classification.scale.min"),
      (error) => error instanceof errors.ConfigValueError && error.path === "classification.scale.min" && error.value === value,
      JSON.stringify(value)
    );
  }
});

// ---------------------------------------------------------------- actions --

test("normalizeAction() accepts only allowlisted action names and keeps their parameters", () => {
  const { normalizeAction } = actions;
  assert.deepEqual(reading((d) => normalizeAction({ action: "toggle" }, "tap_action", d, null)), { result: { action: "toggle" }, diagnostics: [] });
  assert.deepEqual(
    normalizeAction({ action: "navigate", navigation_path: "/x" }, "tap_action", [], null),
    { action: "navigate", navigation_path: "/x" },
    "extra parameters are Home Assistant's and are preserved"
  );
  for (const value of [undefined, null]) {
    assert.deepEqual(reading((d) => normalizeAction(value, "tap_action", d, { action: "more-info" })), {
      result: { action: "more-info" },
      diagnostics: [],
    });
  }
});

test("an action the card cannot run falls back and names where it was written", () => {
  const { normalizeAction } = actions;
  const { FALLBACK, fallbackValue } = core;
  const card = { action: "more-info" };
  const cases = [
    [{ action: "call-service" }, "tap_action.action", "call-service"],
    [{ action: 5 }, "tap_action.action", 5],
    [{ navigation_path: "/x" }, "tap_action.action", undefined],
    ["toggle", "tap_action", "toggle"],
    [[], "tap_action", []],
  ];
  for (const [value, path, written] of cases) {
    assert.deepEqual(
      reading((d) => normalizeAction(value, "tap_action", d, card)),
      { result: card, diagnostics: [invalid(path, written, fallbackValue("more-info"))] },
      JSON.stringify(value)
    );
  }
  // A room's own action falls back to the card's.
  assert.deepEqual(reading((d) => normalizeAction({ action: "explode" }, "rooms[1].hold_action", d, null)), {
    result: null,
    diagnostics: [invalid("rooms[1].hold_action.action", "explode", FALLBACK.CARD_ACTION)],
  });
});

test("normalizeAction() copies the fallback instead of sharing it", () => {
  const { normalizeAction } = actions;
  const fallback = { action: "more-info" };
  const result = normalizeAction("nonsense", "tap_action", [], fallback);
  assert.deepEqual(result, fallback);
  assert.notEqual(result, fallback, "a mutation must not reach back into the defaults");
  const passed = normalizeAction({ action: "toggle" }, "tap_action", [], fallback);
  passed.action = "url";
  assert.equal(fallback.action, "more-info");
});

// ------------------------------------------------------------------ rooms --

test("normalizeRoom() derives name and short from each other", () => {
  const { normalizeRoom } = rooms;
  assert.deepEqual(reading((d) => normalizeRoom({ name: "Kitchen", short: "KI", entity: "sensor.k" }, 0, d)), {
    result: { name: "Kitchen", short: "KI", entity: "sensor.k", tap_action: null, hold_action: null },
    diagnostics: [],
  });
  assert.equal(normalizeRoom({ short: "KI", entity: "sensor.k" }, 0, []).name, "KI", "name falls back to short");
  assert.equal(normalizeRoom({ name: "Kitchen", entity: "sensor.k" }, 0, []).short, "Kitchen", "short falls back to name");
  assert.equal(normalizeRoom({ entity: "sensor.k" }, 0, []).name, "sensor.k", "both fall back to the entity id");
  assert.equal(normalizeRoom({ name: 101, entity: "sensor.k" }, 0, []).name, "101", "a number is a name, as YAML writes room numbers");
});

test("a room name that is not text falls back to the automatic label, with a warning", () => {
  const { normalizeRoom } = rooms;
  const { FALLBACK } = core;
  assert.deepEqual(reading((d) => normalizeRoom({ name: true, short: {}, entity: "sensor.k" }, 2, d)), {
    result: { name: "sensor.k", short: "sensor.k", entity: "sensor.k", tap_action: null, hold_action: null },
    diagnostics: [invalid("rooms[2].name", true, FALLBACK.AUTOMATIC), invalid("rooms[2].short", {}, FALLBACK.AUTOMATIC)],
  });
  assert.deepEqual(reading((d) => normalizeRoom({ name: "", entity: "sensor.k" }, 0, d)).diagnostics, [
    invalid("rooms[0].name", "", FALLBACK.AUTOMATIC),
  ]);
});

test("a room that is not an object, has no entity, or has a key it does not know refuses the configuration", () => {
  const { normalizeRoom } = rooms;
  assert.throws(() => normalizeRoom("sensor.k", 3, []), refusal("Invalid configuration: rooms[3] must be an object."));
  assert.throws(() => normalizeRoom({ name: "A" }, 2, []), refusal("Invalid configuration: rooms[2].entity must be an entity id."));
  assert.throws(
    () => normalizeRoom({ entity: "sensor.k", nmae: "Kitchen" }, 0, []),
    refusal("Invalid configuration: rooms[0].nmae is not an option of this card. Did you mean rooms[0].name?")
  );
  assert.throws(
    () => normalizeRoom({ icon: "mdi:sofa" }, 1, []),
    refusal("Invalid configuration: rooms[1].icon is not an option of this card."),
    "the keys are read before the entity"
  );
});

test("normalizeRooms() refuses a duplicate entity outright", () => {
  const { normalizeRooms } = rooms;
  assert.throws(
    () => normalizeRooms([{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.a" }], []),
    refusal("Invalid configuration: sensor.a is used by more than one room.")
  );
  // Whitespace is trimmed first, so two spellings of one entity still collide.
  assert.throws(() => normalizeRooms([{ entity: "sensor.a" }, { entity: " sensor.a " }], []), refusal("Invalid configuration: sensor.a is used by more than one room."));
});

test("normalizeRooms() refuses a value that is not a list and keeps the written order", () => {
  const { normalizeRooms } = rooms;
  assert.throws(() => normalizeRooms("sensor.a", []), refusal("Invalid configuration: rooms must be a list."));
  assert.deepEqual(
    normalizeRooms([{ entity: "sensor.b" }, { entity: "sensor.a" }], []).map((room) => room.entity),
    ["sensor.b", "sensor.a"]
  );
  assert.deepEqual(normalizeRooms([], []), []);
});

// ------------------------------------------------------------------ views --

function viewsOf(value) {
  const diagnostics = [];
  return { views: views.normalizeViewsConfig(value, COLLABORATORS, diagnostics), diagnostics };
}

test("an omitted views: config is the not-configured sentinel and is not diagnosed", () => {
  for (const absent of [undefined, null]) assert.deepEqual(viewsOf(absent), { views: null, diagnostics: [] });
});

test("a non-array views: config is diagnosed and normalizes to the sentinel", () => {
  assert.deepEqual(viewsOf("scale"), { views: null, diagnostics: [invalid("views", "scale", core.FALLBACK.AUTOMATIC)] });
});

test("string and object entry forms both mean enabled", () => {
  assert.deepEqual(viewsOf(["scale"]), { views: [{ type: "scale", enabled: true, options: {} }], diagnostics: [] });
  assert.deepEqual(viewsOf([{ type: "scale" }]).views, [{ type: "scale", enabled: true, options: {} }]);
});

test("every view-entry diagnosis names the path, the written value and what is used instead", () => {
  const { FALLBACK, fallbackValue } = core;
  const cases = [
    [["   "], [invalid("views[0]", "   ", FALLBACK.IGNORED)]],
    [[42], [invalid("views[0]", 42, FALLBACK.IGNORED)]],
    [["bogus"], [invalid("views[0]", "bogus", FALLBACK.IGNORED)]],
    [[{ enabled: true }], [invalid("views[0].type", undefined, FALLBACK.IGNORED)]],
    [[{ type: "bogus", options: { anything: 1 } }], [invalid("views[0].type", "bogus", FALLBACK.IGNORED)]],
    [["scale", "scale"], [invalid("views[1]", "scale", FALLBACK.IGNORED)]],
    [["scale", { type: "scale" }], [invalid("views[1].type", "scale", FALLBACK.IGNORED)]],
    [[{ type: "scale", enabled: "yes" }], [invalid("views[0].enabled", "yes", fallbackValue("auto"))]],
    [[{ type: "scale", options: "all" }], [invalid("views[0].options", "all", FALLBACK.DEFAULTS)]],
    [[{ type: "scale", options: { show_comfort_band: "yes" } }], [invalid("views[0].options.show_comfort_band", "yes", fallbackValue(true))]],
    [[{ type: "scale", options: { markers: "some" } }], [invalid("views[0].options.markers", "some", fallbackValue("extremes"))]],
    // A key with nothing after it is not a request.
    [[{ type: "scale", options: { markers: null } }], []],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(viewsOf(input).diagnostics, expected, JSON.stringify(input));
  }
});

test("a key a view entry or its options do not have refuses the configuration", () => {
  assert.throws(
    () => viewsOf([{ type: "scale", enable: true }]),
    refusal("Invalid configuration: views[0].enable is not an option of this card. Did you mean views[0].enabled?")
  );
  assert.throws(
    () => viewsOf(["range", { type: "scale", options: { markers: "all", marker: "all" } }]),
    refusal("Invalid configuration: views[1].options.marker is not an option of this card. Did you mean views[1].options.markers?")
  );
  assert.throws(
    () => viewsOf([{ type: "range", options: { markers: "all" } }]),
    refusal("Invalid configuration: views[0].options.markers is not an option of this card."),
    "each view has its own options"
  );
  // A repeated entry is still an entry: its own keys are read, its options are not.
  assert.throws(() => viewsOf(["scale", { type: "scale", enable: true }]), { name: "ConfigError" });
  assert.doesNotThrow(() => viewsOf(["scale", { type: "scale", options: { bogus: 1 } }]));
});

test("an invalid enabled: falls back to auto rather than dropping the view", () => {
  assert.deepEqual(viewsOf([{ type: "scale", enabled: "yes" }]).views, [{ type: "scale", enabled: "auto", options: {} }]);
});

test("an explicit auto delegates, an omitted enabled does not", () => {
  const { views: result } = viewsOf([{ type: "scale", enabled: "auto" }, { type: "range", enabled: false }, { type: "extremes" }]);
  assert.deepEqual(result.map((request) => request.enabled), ["auto", false, true]);
});

test("an unresolvable entry is dropped while the rest survives", () => {
  const { views: result, diagnostics } = viewsOf([42, "scale"]);
  assert.deepEqual(result, [{ type: "scale", enabled: true, options: {} }]);
  assert.equal(diagnostics.length, 1);
});

test("view options keep only the values their schema accepts", () => {
  const { views: result, diagnostics } = viewsOf([{ type: "scale", options: { show_comfort_band: false, markers: "sometimes" } }]);
  assert.deepEqual(result[0].options, { show_comfort_band: false });
  assert.equal(diagnostics.length, 1, "the rejected value is named and its default applies");
});

test("an unknown view type is dropped with its options, and named once", () => {
  const { views: result, diagnostics } = viewsOf([{ type: "bogus", options: { anything: 1 } }]);
  assert.deepEqual(result, [], "no renderer exists for it, so nothing downstream sees it");
  assert.deepEqual(diagnostics, [invalid("views[0].type", "bogus", core.FALLBACK.IGNORED)], "its options belong to no schema and are not judged");
});

test("a repeated view type keeps its first entry and names the repetition", () => {
  const { views: result, diagnostics } = viewsOf([{ type: "scale", options: { markers: "all" } }, { type: "scale", options: { markers: "bogus" } }]);
  assert.deepEqual(result, [{ type: "scale", enabled: true, options: { markers: "all" } }]);
  assert.deepEqual(diagnostics, [invalid("views[1].type", "scale", core.FALLBACK.IGNORED)], "the repeated entry's own options are never read");
});

test("a schema entry without validate() is accepted but not value-checked", () => {
  const { views: result, diagnostics } = viewsOf([{ type: "scale", options: { legacy: "anything at all" } }]);
  assert.deepEqual(result[0].options, { legacy: "anything at all" });
  assert.deepEqual(diagnostics, []);
});

test("omitted options are not diagnosed", () => {
  for (const absent of [undefined, null]) assert.deepEqual(viewsOf([{ type: "scale", options: absent }]).diagnostics, []);
});
