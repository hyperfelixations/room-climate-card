"use strict";

// Direct unit tests for config primitives, actions, rooms, and views. The error messages
// are a user-facing contract — Home Assistant shows what setConfig() throws, and the README
// quotes it — so they, and the order validation runs in, are asserted literally.
// Collaborators are stubbed, which is the point of injecting them.
// Boundary: this file owns the primitive readers (optional strings, enums, integers) and
// the structured readers for actions, rooms and views; whole-configuration assembly is
// config-normalize-modules.test.js. See interne Doku §4 „Config-Normalisierungsvertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let primitives;
let actions;
let rooms;
let views;

const COLLABORATORS = {
  viewTypes: VIEWS,
  optionSchemaForView: (type) =>
    type === "scale"
      ? {
          show_comfort_band: { default: true, validate: (v) => typeof v === "boolean" },
          markers: { default: "extremes", validate: (v) => ["average", "extremes", "all"].includes(v) },
          legacy: { default: null },
        }
      : undefined,
};

test.before(async () => {
  primitives = await import("../../../src/config/primitives.js");
  actions = await import("../../../src/config/actions.js");
  rooms = await import("../../../src/config/rooms.js");
  views = await import("../../../src/config/views.js");
});

// ------------------------------------------------------------- primitives --

test("isPlainObject() rejects arrays and everything non-object", () => {
  const { isPlainObject } = primitives;
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  for (const invalid of [[], null, undefined, "x", 1, true, () => {}]) {
    assert.equal(isPlainObject(invalid), false, JSON.stringify(String(invalid)));
  }
});

test("requiredEntity() trims and rejects anything unusable", () => {
  const { requiredEntity } = primitives;
  assert.equal(requiredEntity("  sensor.a  ", "entity"), "sensor.a");
  for (const invalid of ["", "   ", null, undefined, 5, {}, []]) {
    assert.throws(
      () => requiredEntity(invalid, "entity"),
      { message: "Invalid configuration: entity must be a non-empty entity id." },
      JSON.stringify(String(invalid))
    );
  }
  assert.throws(() => requiredEntity("", "rooms[2].entity"), {
    message: "Invalid configuration: rooms[2].entity must be a non-empty entity id.",
  });
});

test("optionalEntity() distinguishes absent from malformed", () => {
  const { optionalEntity } = primitives;
  assert.equal(optionalEntity(undefined, null, "range_entity"), null, "absent uses the fallback");
  assert.equal(optionalEntity(null, null, "range_entity"), null);
  assert.equal(optionalEntity("", null, "range_entity"), null, "empty string counts as absent");
  assert.equal(optionalEntity(" sensor.r ", null, "range_entity"), "sensor.r");
  for (const invalid of [5, {}, [], "   "]) {
    assert.throws(
      () => optionalEntity(invalid, null, "range_entity"),
      { message: "Invalid configuration: range_entity must be an entity id string." },
      JSON.stringify(String(invalid))
    );
  }
});

test("optionalString() falls back to null instead of throwing", () => {
  const { optionalString } = primitives;
  assert.equal(optionalString(" Title "), "Title");
  for (const empty of ["", "   ", null, undefined, 5, {}, true]) {
    assert.equal(optionalString(empty), null, JSON.stringify(String(empty)));
  }
});

test("stringOrDefault() coerces and honours the fallback chain", () => {
  const { stringOrDefault } = primitives;
  assert.equal(stringOrDefault("Kitchen", "fallback"), "Kitchen");
  assert.equal(stringOrDefault(undefined, "fallback"), "fallback");
  assert.equal(stringOrDefault(null, "fallback"), "fallback");
  assert.equal(stringOrDefault("", "fallback"), "fallback");
  assert.equal(stringOrDefault(0, "fallback"), "0", "a real 0 is a value, not an absence");
  assert.equal(stringOrDefault(undefined, undefined), "");
});

test("booleanOption() accepts exactly true and false, and says so when it does not", () => {
  const { booleanOption } = primitives;
  const diagnostics = [];
  assert.equal(booleanOption(true, "auto_slide", diagnostics), true);
  assert.equal(booleanOption(false, "auto_slide", diagnostics), false);
  assert.deepEqual(diagnostics, [], "a value it accepts is not worth mentioning");

  for (const rejected of ["true", "false", "yes", "on", 1, 0, {}]) {
    assert.equal(booleanOption(rejected, "swipe", diagnostics), undefined, JSON.stringify(rejected));
  }
  assert.equal(diagnostics.length, 7, "each rejection is reported once");
  assert.equal(diagnostics[0], 'swipe: expected true or false, got "true", falling back to the default');
});

test("booleanOption() answers undefined for an unwritten key without a word about it", () => {
  // A top-level option takes its default; the `show:` block stays silent about a decision
  // nobody touched. The reader reports absence, never diagnoses it, and lets each caller decide.
  const { booleanOption } = primitives;
  const diagnostics = [];
  assert.equal(booleanOption(undefined, "auto_slide", diagnostics), undefined);
  assert.equal(booleanOption(null, "auto_slide", diagnostics), undefined);
  assert.deepEqual(diagnostics, []);
});

test("normalizeEnum() silently falls back for anything outside the set", () => {
  const { normalizeEnum } = primitives;
  assert.equal(normalizeEnum("name", ["configured", "name"], "configured"), "name");
  for (const invalid of ["NAME", "", null, undefined, 1, true]) {
    assert.equal(normalizeEnum(invalid, ["configured", "name"], "configured"), "configured");
  }
});

test("decimalsOverride() accepts only integers 0..2", () => {
  const { decimalsOverride } = primitives;
  for (const [input, expected] of [[0, 0], [1, 1], [2, 2], ["1", 1]]) {
    assert.equal(decimalsOverride(input), expected, JSON.stringify(input));
  }
  for (const invalid of [-1, 3, 1.5, true, "x", {}, [], null, undefined, ""]) {
    assert.equal(decimalsOverride(invalid), null, JSON.stringify(String(invalid)));
  }
});

test("positiveInteger() accepts 1..20 and nothing else", () => {
  const { positiveInteger } = primitives;
  assert.equal(positiveInteger(1), 1);
  assert.equal(positiveInteger(20), 20);
  assert.equal(positiveInteger("7"), 7);
  for (const invalid of [0, -1, 21, 2.5, true, "x", null, undefined, ""]) {
    assert.equal(positiveInteger(invalid), null, JSON.stringify(String(invalid)));
  }
});

test("positiveSeconds() clamps to its bounds by falling back, not by capping", () => {
  const { positiveSeconds } = primitives;
  assert.equal(positiveSeconds(30, 14, 1, 3600), 30);
  assert.equal(positiveSeconds("2.5", 1, 0.1, 10), 2.5);
  assert.equal(positiveSeconds(0.5, 14, 1, 3600), 14, "below min falls back, it is not raised to min");
  assert.equal(positiveSeconds(99999, 14, 1, 3600), 14, "above max falls back, it is not lowered to max");
  assert.equal(positiveSeconds(true, 14, 1, 3600), 14);
  assert.equal(positiveSeconds(undefined, 14, 1, 3600), 14);
});

test("numberAtPath() throws with the path in the message", () => {
  const { numberAtPath } = primitives;
  assert.equal(numberAtPath("21.5", "classification.scale.min"), 21.5);
  assert.throws(() => numberAtPath("x", "classification.scale.min"), {
    message: "Invalid configuration: classification.scale.min must be a finite number.",
  });
  assert.throws(() => numberAtPath(true, "classification.tiers[0].score"), {
    message: "Invalid configuration: classification.tiers[0].score must be a finite number.",
  });
});

test("assertAllowedKeys() names the first offending key", () => {
  const { assertAllowedKeys } = primitives;
  assert.doesNotThrow(() => assertAllowedKeys({ min: 1 }, new Set(["min", "max"]), "classification.scale"));
  assert.throws(() => assertAllowedKeys({ bogus: 1 }, new Set(["min"]), "classification.scale"), {
    message: "Invalid configuration: classification.scale.bogus is not a supported option.",
  });
});

// ---------------------------------------------------------------- actions --

test("normalizeAction() accepts only allowlisted action names", () => {
  const { normalizeAction } = actions;
  assert.deepEqual(normalizeAction({ action: "toggle" }, null), { action: "toggle" });
  assert.deepEqual(
    normalizeAction({ action: "navigate", navigation_path: "/x" }, null),
    { action: "navigate", navigation_path: "/x" },
    "extra parameters are preserved"
  );
  for (const invalid of [{ action: "call-service" }, { action: 5 }, {}, null, undefined, "toggle", []]) {
    assert.equal(normalizeAction(invalid, null), null, JSON.stringify(invalid));
  }
});

test("normalizeAction() copies the fallback instead of sharing it", () => {
  const { normalizeAction } = actions;
  const fallback = { action: "more-info" };
  const result = normalizeAction("nonsense", fallback);
  assert.deepEqual(result, fallback);
  assert.notEqual(result, fallback, "a mutation must not reach back into the defaults");
  const passed = normalizeAction({ action: "toggle" }, fallback);
  passed.action = "url";
  assert.equal(fallback.action, "more-info");
});

// ------------------------------------------------------------------ rooms --

test("normalizeRoom() derives name and short from each other", () => {
  const { normalizeRoom } = rooms;
  assert.deepEqual(normalizeRoom({ name: "Kitchen", short: "KI", entity: "sensor.k" }, 0), {
    name: "Kitchen",
    short: "KI",
    entity: "sensor.k",
    tap_action: null,
    hold_action: null,
  });
  assert.deepEqual(normalizeRoom({ short: "KI", entity: "sensor.k" }, 0).name, "KI", "name falls back to short");
  assert.deepEqual(normalizeRoom({ name: "Kitchen", entity: "sensor.k" }, 0).short, "Kitchen", "short falls back to name");
  assert.deepEqual(normalizeRoom({ entity: "sensor.k" }, 0).name, "sensor.k", "both fall back to the entity id");
});

test("normalizeRoom() reports its own index in the error", () => {
  const { normalizeRoom } = rooms;
  assert.throws(() => normalizeRoom("sensor.k", 3), {
    message: "Invalid configuration: rooms[3] must be an object.",
  });
  assert.throws(() => normalizeRoom({ name: "A" }, 2), {
    message: "Invalid configuration: rooms[2].entity must be a non-empty entity id.",
  });
});

test("normalizeRooms() rejects a duplicate entity outright", () => {
  const { normalizeRooms } = rooms;
  assert.throws(
    () => normalizeRooms([{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.a" }]),
    { message: 'Invalid configuration: duplicate rooms[].entity "sensor.a" — each room must reference a unique entity.' }
  );
  // Whitespace is trimmed first, so two spellings of one entity still collide.
  assert.throws(() => normalizeRooms([{ entity: "sensor.a" }, { entity: " sensor.a " }]), /duplicate rooms\[\]\.entity/);
});

test("normalizeRooms() rejects a non-array and preserves order", () => {
  const { normalizeRooms } = rooms;
  assert.throws(() => normalizeRooms("sensor.a"), { message: "Invalid configuration: rooms must be an array." });
  assert.deepEqual(
    normalizeRooms([{ entity: "sensor.b" }, { entity: "sensor.a" }]).map((r) => r.entity),
    ["sensor.b", "sensor.a"],
    "declaration order is preserved"
  );
  assert.deepEqual(normalizeRooms([]), []);
});

// ------------------------------------------------------------------ views --

test("an omitted views: config is the not-configured sentinel and is not diagnosed", () => {
  for (const absent of [undefined, null]) {
    assert.deepEqual(views.normalizeViewsConfig(absent, COLLABORATORS), { views: null, diagnostics: [] });
  }
});

test("a non-array views: config is diagnosed and normalizes to the sentinel", () => {
  const result = views.normalizeViewsConfig("scale", COLLABORATORS);
  assert.equal(result.views, null);
  assert.deepEqual(result.diagnostics, ['views: expected an array, got "scale"']);
});

test("string and object entry forms both mean enabled", () => {
  assert.deepEqual(views.normalizeViewsConfig(["scale"], COLLABORATORS), {
    views: [{ type: "scale", enabled: true, options: {} }],
    diagnostics: [],
  });
  assert.deepEqual(views.normalizeViewsConfig([{ type: "scale" }], COLLABORATORS).views, [
    { type: "scale", enabled: true, options: {} },
  ]);
});

test("every view-entry diagnosis keeps its exact wording", () => {
  const cases = [
    [["   "], 'views[0]: expected a non-empty string or an object'],
    [[42], "views[0]: expected a string or an object, got 42"],
    [[{ enabled: true }], 'views[0]: missing or invalid "type"'],
    [[{ type: "scale", enabled: "yes" }], 'views[0] ("scale"): invalid "enabled" value "yes", falling back to "auto"'],
    [[{ type: "scale", options: "all" }], 'views[0] ("scale"): invalid "options" value "all", expected an object'],
    [[{ type: "scale", options: { bogus: 1, other: 2 } }], 'views[0] ("scale"): ignoring unknown "options" key(s) "bogus", "other"'],
    [[{ type: "scale", options: { show_comfort_band: "yes" } }], 'views[0] ("scale"): invalid "show_comfort_band" value "yes", falling back to default'],
    [[{ type: "scale", options: { markers: "some" } }], 'views[0] ("scale"): invalid "markers" value "some", falling back to default'],
  ];
  for (const [input, expected] of cases) {
    const { diagnostics } = views.normalizeViewsConfig(input, COLLABORATORS);
    assert.ok(diagnostics.includes(expected), `${JSON.stringify(input)}\n  got: ${JSON.stringify(diagnostics)}`);
  }
});

test("an invalid enabled: falls back to auto rather than dropping the view", () => {
  const { views: result } = views.normalizeViewsConfig([{ type: "scale", enabled: "yes" }], COLLABORATORS);
  assert.deepEqual(result, [{ type: "scale", enabled: "auto", options: {} }]);
});

test("an explicit auto delegates, an omitted enabled does not", () => {
  const { views: result } = views.normalizeViewsConfig(
    [{ type: "scale", enabled: "auto" }, { type: "scale", enabled: false }],
    COLLABORATORS
  );
  assert.deepEqual(result.map((r) => r.enabled), ["auto", false]);
});

test("an unresolvable entry is dropped while the rest survives", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig([42, "scale"], COLLABORATORS);
  assert.deepEqual(result, [{ type: "scale", enabled: true, options: {} }]);
  assert.equal(diagnostics.length, 1);
});

test("view options are filtered against the requested view's own schema", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "scale", options: { show_comfort_band: false, markers: "all", bogus: 1 } }],
    COLLABORATORS
  );
  assert.deepEqual(result[0].options, { show_comfort_band: false, markers: "all" });
  assert.equal(diagnostics.length, 1, "only the unknown key is diagnosed");
});

test("an unknown view type has no schema, so all its options are stripped", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "bogus", options: { anything: 1 } }],
    COLLABORATORS
  );
  assert.deepEqual(result, [{ type: "bogus", enabled: true, options: {} }], "the type itself survives for the resolver to reject");
  assert.match(diagnostics[0], /ignoring unknown "options" key/);
});

test("a schema entry without validate() is whitelisted but not value-checked", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "scale", options: { legacy: "anything at all" } }],
    COLLABORATORS
  );
  assert.deepEqual(result[0].options, { legacy: "anything at all" });
  assert.deepEqual(diagnostics, []);
});

test("omitted options are not diagnosed", () => {
  for (const absent of [undefined, null]) {
    const { diagnostics } = views.normalizeViewsConfig([{ type: "scale", options: absent }], COLLABORATORS);
    assert.deepEqual(diagnostics, []);
  }
});
