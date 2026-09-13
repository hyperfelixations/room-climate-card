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

test("every warning stays one short sentence in English", () => {
  // A single warning is read in the subtitle, so it has to stay short.
  const samples = [
    invalid("views[0].options.show_comfort_band", "a fairly long value", core.fallbackValue("extremes")),
    invalid("rotation_seconds", "fourteen", core.FALLBACK.AUTOMATIC),
    invalid("start_view", "sclae", core.FALLBACK.FIRST_VIEW),
    invalid("show", "yes", core.FALLBACK.DEFAULTS),
    invalid("views[3]", "extremes", core.FALLBACK.IGNORED),
    core.createDiagnostic("config.foreign_key", { path: "avg_label" }),
    core.createDiagnostic("sources.mixed"),
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
  assert.deepEqual(
    composeSubtitle({ config: cfg({ show: { subtitle: false }, subtitle: { text: "", overflow: "wrap" } }), automatic: null, noDataReason: "No value." }),
    { subtitle: "No value.", hasSubtitle: true, subtitleOverflow: "wrap" },
    "a no-data reason is forced into view, in the card's own overflow"
  );
  assert.deepEqual(
    composeSubtitle({ config: cfg({ subtitle: { text: "Ground floor", overflow: "clip" } }), automatic: "Avg." }),
    { subtitle: "Ground floor", hasSubtitle: true, subtitleOverflow: "clip" }
  );
  assert.deepEqual(composeSubtitle({ config: cfg(), automatic: "Avg." }), { subtitle: "Avg.", hasSubtitle: true, subtitleOverflow: "clip" });
  assert.equal(composeSubtitle({ config: cfg({ subtitle: { text: "", overflow: "clip" } }), automatic: "Avg." }).hasSubtitle, false);
  assert.equal(composeSubtitle({ config: cfg({ show: { subtitle: false } }), automatic: "Avg." }).hasSubtitle, false);
});
