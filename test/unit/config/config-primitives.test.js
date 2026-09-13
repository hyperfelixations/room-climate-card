"use strict";

// Direct unit tests for config primitives, actions, rooms, and views. The error messages
// are a user-facing contract — Home Assistant shows what setConfig() throws — so they, and
// the order validation runs in, are asserted literally.
// Collaborators are stubbed, which is the point of injecting them.
// Boundary: this file owns the primitive readers (optional strings, enums, integers) and
// the structured readers for actions, rooms and views; whole-configuration assembly is
// config-normalize-modules.test.js. See internal dev doc §4 "Config-Normalisierungsvertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let primitives;
let actions;
let rooms;
let views;
let core;

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
  core = await import("../../../src/core/diagnostics.js");
});

// The diagnostic a reader records for an invalid value, built the way the reader builds it.
const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });

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

test("booleanOption() accepts exactly true and false, and names the default when it does not", () => {
  const { booleanOption } = primitives;
  const diagnostics = [];
  assert.equal(booleanOption(true, "auto_slide", diagnostics, true), true);
  assert.equal(booleanOption(false, "auto_slide", diagnostics, true), false);
  assert.deepEqual(diagnostics, [], "a value it accepts is not worth mentioning");

  for (const rejected of ["true", "false", "yes", "on", 1, 0, {}]) {
    assert.equal(booleanOption(rejected, "swipe", diagnostics, true), undefined, JSON.stringify(rejected));
  }
  assert.equal(diagnostics.length, 7, "each rejection is reported once");
  assert.deepEqual(diagnostics[0], invalid("swipe", "true", core.fallbackValue(true)));
});

test("booleanOption() answers undefined for an unwritten key without a word about it", () => {
  // A top-level option takes its default; the `show:` block stays silent about a decision
  // nobody touched. The reader reports absence, never diagnoses it, and lets each caller decide.
  const { booleanOption } = primitives;
  const diagnostics = [];
  assert.equal(booleanOption(undefined, "auto_slide", diagnostics, true), undefined);
  assert.equal(booleanOption(null, "auto_slide", diagnostics, true), undefined);
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
  assert.deepEqual(result.diagnostics, [invalid("views", "scale", core.FALLBACK.AUTOMATIC)]);
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

test("every view-entry diagnosis names the path, the written value and what is used instead", () => {
  const { FALLBACK, createDiagnostic, fallbackValue } = core;
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
    [
      [{ type: "scale", options: { bogus: 1, other: 2 } }],
      [
        createDiagnostic("config.foreign_key", { path: "views[0].options.bogus" }),
        createDiagnostic("config.foreign_key", { path: "views[0].options.other" }),
      ],
    ],
    [[{ type: "scale", options: { show_comfort_band: "yes" } }], [invalid("views[0].options.show_comfort_band", "yes", fallbackValue(true))]],
    [[{ type: "scale", options: { markers: "some" } }], [invalid("views[0].options.markers", "some", fallbackValue("extremes"))]],
    // A key with nothing after it is not a request.
    [[{ type: "scale", options: { markers: null } }], []],
  ];
  for (const [input, expected] of cases) {
    const { diagnostics } = views.normalizeViewsConfig(input, COLLABORATORS);
    assert.deepEqual(diagnostics, expected, JSON.stringify(input));
  }
});

test("an invalid enabled: falls back to auto rather than dropping the view", () => {
  const { views: result } = views.normalizeViewsConfig([{ type: "scale", enabled: "yes" }], COLLABORATORS);
  assert.deepEqual(result, [{ type: "scale", enabled: "auto", options: {} }]);
});

test("an explicit auto delegates, an omitted enabled does not", () => {
  const { views: result } = views.normalizeViewsConfig(
    [{ type: "scale", enabled: "auto" }, { type: "range", enabled: false }, { type: "extremes" }],
    COLLABORATORS
  );
  assert.deepEqual(result.map((r) => r.enabled), ["auto", false, true]);
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

test("an unknown view type is dropped with its options, and named once", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "bogus", options: { anything: 1 } }],
    COLLABORATORS
  );
  assert.deepEqual(result, [], "no renderer exists for it, so nothing downstream sees it");
  assert.deepEqual(
    diagnostics,
    [invalid("views[0].type", "bogus", core.FALLBACK.IGNORED)],
    "its options belong to no schema and are not judged"
  );
});

test("a repeated view type keeps its first entry and names the repetition", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "scale", options: { markers: "all" } }, { type: "scale", options: { markers: "bogus" } }],
    COLLABORATORS
  );
  assert.deepEqual(result, [{ type: "scale", enabled: true, options: { markers: "all" } }]);
  assert.deepEqual(
    diagnostics,
    [invalid("views[1].type", "scale", core.FALLBACK.IGNORED)],
    "the repeated entry's own options are never read"
  );
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
