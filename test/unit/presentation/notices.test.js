"use strict";

// Direct unit tests for presentation/view-model/notices.js: how a diagnostic is worded, and
// what the subtitle line shows. Boundary: the config and application tests decide which
// diagnostics exist; rendering/subtitle.test.js shows the same rules on a card. See internal
// dev doc §4 "Diagnosevertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { cfg } = require("../../fixtures/presentation-models.js");

let notices;
let core;
let translate;

test.before(async () => {
  notices = await import("../../../src/presentation/view-model/notices.js");
  core = await import("../../../src/core/diagnostics.js");
  translate = await import("../../../src/i18n/translate.js");
});

const t = (language) => (key, vars) => translate.translate(language, key, vars);
const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });
const words = (language, diagnostic) => notices.renderMessage(notices.messageForDiagnostic(diagnostic), t(language));

// ---------------------------------------------------------------- wording --

test("an invalid value is named with its path and what the card uses instead", () => {
  const { FALLBACK, fallbackValue } = core;
  assert.equal(words("en", invalid("auto_slide", "yes", fallbackValue(true))), '"yes" is not a valid value for auto_slide. Using default: true.');
  assert.equal(words("en", invalid("views", "scale", FALLBACK.AUTOMATIC)), '"scale" is not a valid value for views. Using the automatic setting.');
  assert.equal(words("en", invalid("views[0]", 42, FALLBACK.IGNORED)), "42 is not a valid value for views[0]. It is ignored.");
  assert.equal(
    words("en", invalid("start_view", "sclae", FALLBACK.FIRST_VIEW)),
    '"sclae" is not a valid value for start_view. Starting on the first available view.'
  );
  assert.equal(words("en", invalid("show", [], FALLBACK.DEFAULTS)), "[] is not a valid value for show. Using the defaults.");
  assert.equal(
    words("de", invalid("show.icon", "", fallbackValue(true))),
    "(leer) ist kein gültiger Wert für show.icon. Es gilt der Standard: true.",
    "an empty value is named as empty, in the card's language"
  );
});

test("a foreign key and rooms of different measurements have sentences of their own", () => {
  assert.equal(
    words("en", core.createDiagnostic("config.foreign_key", { path: "avg_label" })),
    "avg_label is not an option of this card. It is ignored."
  );
  assert.equal(
    words("en", core.createDiagnostic("sources.mixed")),
    "The rooms measure different things. Set entity or align device_class."
  );
});

test("each way of falling back has a clause of its own", () => {
  const { FALLBACK, fallbackOption } = core;
  assert.equal(
    words("en", invalid("rooms[0].tap_action.action", "explode", FALLBACK.CARD_ACTION)),
    '"explode" is not a valid value for rooms[0].tap_action.action. Using the card\'s action.'
  );
  assert.equal(
    words("en", invalid("classification.tiers[1].min", 24, fallbackOption("classification", "auto"))),
    "24 is not a valid value for classification.tiers[1].min. Using classification: auto.",
    "a whole object fell back, so the clause names the object"
  );
  assert.equal(
    words("de", invalid("palette.above[2]", "nope", fallbackOption("palette", "pastel"))),
    '"nope" ist kein gültiger Wert für palette.above[2]. Es gilt palette: pastel.'
  );
});

test("decimals fall back to the precision of the card's measurement", () => {
  const diagnostic = invalid("decimals", 3, core.FALLBACK.METRIC_DECIMALS);
  const render = (metricKind) => notices.renderMessage(notices.messageForDiagnostic(diagnostic, { metricKind }), t("en"));
  assert.equal(render("temperature"), "3 is not a valid value for decimals. Using default: 1.");
  assert.equal(render("co2"), "3 is not a valid value for decimals. Using default: 0.");
  assert.equal(render(null), "3 is not a valid value for decimals. Using default: 1.", "the precision the card formats with");
  const built = notices.buildNotices({ configDiagnostics: [diagnostic], domainDiagnostics: { warnings: [], hints: [] }, metricKind: "co2" });
  assert.equal(notices.renderMessage(built.warnings[0], t("en")), "3 is not a valid value for decimals. Using default: 0.");
});

// Each names what is wrong — the class, the unit, the measurement — so the fix follows from it.
const SOURCE_FAULTS = [
  ["entity.not_found", null, "sensor.hall does not exist in Home Assistant."],
  ["entity.foreign_measurement", { deviceClass: "battery" }, 'sensor.hall has device_class "battery", which this card does not show.'],
  ["entity.unknown_device_class", { deviceClass: "co2" }, 'sensor.hall has device_class "co2", which Home Assistant does not define.'],
  ["entity.unit_ambiguous", { unit: "ppm" }, 'sensor.hall needs a device_class: "ppm" fits several measurements.'],
  ["entity.unidentified", null, "sensor.hall has neither a device_class nor a unit_of_measurement."],
  ["entity.unit_unknown", { unit: "lx" }, 'sensor.hall has no device_class, and the card does not know the unit "lx".'],
  ["entity.unit_missing", { measurement: "temperature" }, "sensor.hall has no unit_of_measurement; Temperature needs one."],
  ["entity.unit_unreadable", { unit: "°R", measurement: "temperature" }, 'sensor.hall reports "°R", which is not a unit of Temperature.'],
  ["entity.other_measurement", { measurement: "humidity", cardMeasurement: "temperature" }, "sensor.hall measures Humidity, not Temperature, and is ignored."],
];

test("a source that stays unusable is named by its entity and its cause", () => {
  for (const [code, params, sentence] of SOURCE_FAULTS) {
    assert.equal(words("en", core.createDiagnostic(code, { entity: "sensor.hall", params })), sentence, code);
  }
  assert.equal(
    words("de", core.createDiagnostic("entity.unit_unreadable", { entity: "sensor.hall", params: { unit: "°R", measurement: "humidity" } })),
    'sensor.hall meldet "°R", keine Einheit für Luftfeuchtigkeit.'
  );
});

test("a source that is momentarily out is a hint, and several are counted by source", () => {
  const hint = (code, params) => notices.messageForDiagnostic(core.createDiagnostic(code, { entity: "sensor.x", params }));
  const text = (hints, language = "en") => notices.hintText(hints, t(language));
  assert.equal(text([]), null);
  assert.equal(text([hint("hint.rooms_unavailable", { count: 1 })]), "1 room is currently unavailable.");
  assert.equal(text([hint("hint.rooms_unavailable", { count: 3 })]), "3 rooms are currently unavailable.");
  assert.equal(text([hint("hint.primary_unavailable")]), "Main sensor currently unavailable; average from the rooms.");
  assert.equal(text([hint("hint.range_unavailable")]), "Today's span currently unavailable.");
  assert.equal(text([hint("hint.trend_unavailable")]), "Trend currently unavailable.");
  assert.equal(text([hint("hint.rooms_unavailable", { count: 2 }), hint("hint.trend_unavailable")]), "3 sources are currently unavailable.");
  assert.equal(text([hint("hint.primary_unavailable"), hint("hint.range_unavailable")], "de"), "2 Quellen sind derzeit nicht verfügbar.");
});

test("a hint joins the line after its sentence, or after a separator when the line has no sentence end", () => {
  const { composeSubtitle } = notices;
  const hint = "Trend currently unavailable.";
  const line = (config, automatic = "Avg. in comfort.") => composeSubtitle({ config: cfg(config), automatic, hintText: hint });
  // While a hint is there the line wraps, so the hint is read in full; the card's own
  // overflow applies again once the source is back.
  assert.deepEqual(line({}), { subtitle: "Avg. in comfort. Trend currently unavailable.", hasSubtitle: true, subtitleOverflow: "wrap" });
  assert.equal(composeSubtitle({ config: cfg(), automatic: "Avg. in comfort." }).subtitleOverflow, "clip");
  assert.equal(line({ subtitle: { text: "Ground floor", overflow: "clip" } }).subtitle, "Ground floor · Trend currently unavailable.");
  assert.equal(line({ subtitle: { text: "Ground floor!", overflow: "clip" } }).subtitle, "Ground floor! Trend currently unavailable.");
  assert.equal(line({ subtitle: { text: "一階です。", overflow: "clip" } }).subtitle, "一階です。Trend currently unavailable.", "no space after a full-width stop");
  // A hint never brings back a line nobody wants, nor changes how an absent line behaves.
  assert.deepEqual(line({ subtitle: { text: "", overflow: "clip" } }), { subtitle: "", hasSubtitle: false, subtitleOverflow: "clip" });
  assert.equal(line({ show: { subtitle: false } }).hasSubtitle, false);
  assert.equal(line({ show: { subtitle: false } }).subtitleOverflow, "clip");
  // A no-data reason is the whole line.
  assert.equal(composeSubtitle({ config: cfg(), automatic: null, noDataReason: "No value.", hintText: hint }).subtitle, "No value.");
});

test("a card without data and without a reason of its own has no line unless it wrote one", () => {
  const { composeSubtitle } = notices;
  assert.deepEqual(composeSubtitle({ config: cfg(), automatic: null, noDataReason: null }), { subtitle: "", hasSubtitle: false, subtitleOverflow: "clip" });
  assert.deepEqual(composeSubtitle({ config: cfg({ subtitle: { text: "Hall", overflow: "wrap" } }), automatic: null, noDataReason: null }), {
    subtitle: "Hall",
    hasSubtitle: true,
    subtitleOverflow: "wrap",
  });
});

test("a refused configuration is worded from its code, and its English is what config/ throws", async () => {
  const { ConfigError, CONFIG_ERROR_CODES } = await import("../../../src/config/errors.js");
  const cases = [
    ["config.not_object", {}],
    ["config.unknown_key", { key: "show.ikon", suggestion: "show.icon" }],
    ["config.unknown_key", { key: "show.footer", suggestion: null }],
    ["config.no_source", {}],
    ["config.must_be_entity_id", { key: "rooms[0].entity" }],
    ["config.must_be_list", { key: "rooms" }],
    ["config.must_be_object", { key: "rooms[2]" }],
    ["config.duplicate_room", { entity: "sensor.a" }],
  ];
  assert.deepEqual([...new Set(cases.map(([code]) => code))].sort(), [...CONFIG_ERROR_CODES].sort(), "every code of the catalog");
  for (const [code, params] of cases) {
    const error = new ConfigError(code, params);
    assert.equal(notices.renderMessage(notices.messageForConfigError(error), t("en")), error.message, code);
  }
  assert.equal(
    notices.renderMessage(notices.messageForConfigError(new ConfigError("config.unknown_key", { key: "show.ikon", suggestion: "show.icon" })), t("de")),
    "Ungültige Konfiguration: show.ikon ist keine Option dieser Karte. Meintest du show.icon?"
  );
});

test("an older spelling names what replaces it", () => {
  const deprecated = core.createDiagnostic("config.deprecated", {
    path: "views[1].options.footer",
    params: { written: "views[1].options.footer: false", replacement: "views[1].options.show_footer: false" },
  });
  assert.equal(
    words("en", deprecated),
    "views[1].options.footer: false is outdated and will be removed. Use views[1].options.show_footer: false."
  );
});

test("every warning stays one short sentence in English", () => {
  // A single warning is read in full, so it has to stay short.
  const samples = [
    invalid("views[0].options.show_comfort_band", "a fairly long value", core.fallbackValue("extremes")),
    invalid("rotation_seconds", "fourteen", core.FALLBACK.AUTOMATIC),
    invalid("start_view", "sclae", core.FALLBACK.FIRST_VIEW),
    invalid("show", "yes", core.FALLBACK.DEFAULTS),
    invalid("views[3]", "extremes", core.FALLBACK.IGNORED),
    invalid("rooms[11].hold_action.action", "explode", core.FALLBACK.CARD_ACTION),
    invalid("decimals", 3, core.FALLBACK.METRIC_DECIMALS),
    invalid("classification.bands.optimal.min", 19, core.fallbackOption("classification", "auto")),
    core.createDiagnostic("config.foreign_key", { path: "avg_label" }),
    core.createDiagnostic("config.deprecated", { path: "unavailable_values", params: { written: "unavailable_values: hide", replacement: "show.unavailable_rooms: false" } }),
    core.createDiagnostic("sources.mixed"),
    ...SOURCE_FAULTS.map(([code, params]) => core.createDiagnostic(code, { entity: "sensor.living_room_temperature", params })),
  ];
  for (const diagnostic of samples) {
    const sentence = words("en", diagnostic);
    const count = sentence.split(/\s+/).length;
    assert.ok(count <= 15, `${count} words: ${sentence}`);
  }
});

test("a code without wording is a programming error", () => {
  assert.throws(
    () => notices.messageForDiagnostic({ code: "value.unworded", severity: "warning" }),
    /no message for "value\.unworded"/
  );
});

// ---------------------------------------------------------- which warnings --

test("the configuration comes first, then the sources, each at its own level", () => {
  const built = notices.buildNotices({
    configDiagnostics: [core.createDiagnostic("config.foreign_key", { path: "wibble" })],
    domainDiagnostics: { warnings: [core.createDiagnostic("sources.mixed")], hints: [] },
  });
  assert.deepEqual(built.warnings.map((message) => message.key), ["warning.foreignKey", "warning.mixedMeasurements"]);
  assert.deepEqual(built.hints, []);
});

test("one warning is shown in full, several are counted", () => {
  const one = [notices.messageForDiagnostic(invalid("swipe", "yes", core.fallbackValue(true)))];
  assert.equal(notices.warningText([], t("en")), null);
  assert.equal(notices.warningText(one, t("en")), '"yes" is not a valid value for swipe. Using default: true.');
  assert.equal(notices.warningText([...one, ...one], t("en")), "2 problems with this card. Details in the browser console.");
  assert.equal(notices.warningText([...one, ...one, ...one], t("de")), "3 Probleme mit dieser Karte. Details in der Browserkonsole.");
});

// ---------------------------------------------------------- the warnings block --

test("the warnings block is visible while a warning exists and show.warnings allows it", () => {
  const one = [notices.messageForDiagnostic(invalid("swipe", "yes", core.fallbackValue(true)))];
  assert.deepEqual(notices.buildWarningBlock({ config: cfg(), warnings: one, t: t("en") }), {
    visible: true,
    text: '"yes" is not a valid value for swipe. Using default: true.',
    label: "Warning",
  });
  assert.equal(notices.buildWarningBlock({ config: cfg({ show: { warnings: false } }), warnings: one, t: t("en") }).visible, false);
  assert.deepEqual(notices.buildWarningBlock({ config: cfg(), warnings: [], t: t("en") }), { visible: false, text: "", label: "Warning" });
  assert.equal(notices.buildWarningBlock({ config: cfg(), warnings: one, t: t("de") }).label, "Warnung");
});

// --------------------------------------------------------- the subtitle line --

test("the no-data reason, then the card's own text, then the automatic sentence", () => {
  const { composeSubtitle } = notices;
  for (const overflow of ["clip", "wrap"]) {
    assert.deepEqual(
      composeSubtitle({ config: cfg({ show: { subtitle: false }, subtitle: { text: "", overflow } }), automatic: null, noDataReason: "No value." }),
      { subtitle: "No value.", hasSubtitle: true, subtitleOverflow: "wrap" },
      `a no-data reason is forced into view and wraps, so it is read in full (overflow ${overflow})`
    );
  }
  assert.equal(composeSubtitle({ config: cfg(), automatic: "Avg.", noDataReason: "No value." }).subtitleOverflow, "wrap", "the default clip included");
  assert.deepEqual(
    composeSubtitle({ config: cfg({ subtitle: { text: "Ground floor", overflow: "clip" } }), automatic: "Avg." }),
    { subtitle: "Ground floor", hasSubtitle: true, subtitleOverflow: "clip" }
  );
  assert.deepEqual(composeSubtitle({ config: cfg(), automatic: "Avg." }), { subtitle: "Avg.", hasSubtitle: true, subtitleOverflow: "clip" });
  assert.equal(composeSubtitle({ config: cfg({ subtitle: { text: "", overflow: "clip" } }), automatic: "Avg." }).hasSubtitle, false);
  assert.equal(composeSubtitle({ config: cfg({ show: { subtitle: false } }), automatic: "Avg." }).hasSubtitle, false);
});
