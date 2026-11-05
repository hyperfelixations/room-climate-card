"use strict";

// The automatic room-chip column count: derived from the typical reading of the measurement as
// a chip writes it (digits, separators, unit) and the chip's typography, never from the card's
// width. Formatting goes through the card's own number formatter, so a locale or number format
// counts exactly as the chip shows it. No count is fixed here: the tests hold the computation's
// rules, and test/browser/geometry/room-chip-fit.spec.js holds its result against Chromium.
// See internal dev doc §5 "Raumchip-Passung".

const test = require("node:test");
const assert = require("node:assert/strict");
const { LANGUAGES, METRIC_KINDS } = require("../../manifests/product-surface.js");

let fit;
let metrics;
let metricMeta;
let formatProfile;
let formatters;
let definitions;

test.before(async () => {
  fit = await import("../../../src/presentation/view-model/room-chip-fit.js");
  metrics = await import("../../../src/presentation/view-model/room-chip-metrics.js");
  metricMeta = await import("../../../src/presentation/view-model/metric-meta.js");
  formatProfile = await import("../../../src/i18n/format-profile.js");
  formatters = await import("../../../src/i18n/formatters.js");
  definitions = await import("../../../src/domain/metrics/definitions.js");
});

// The columns a card of this measurement, unit and configuration gets, formatted as the card does.
function columns(metricKind, { profileKey, language = "de", numberFormat, decimals = null } = {}) {
  const definition = definitions.METRIC_DEFINITIONS[metricKind];
  const key = profileKey ?? definition.canonicalProfileKey;
  const profile = formatProfile.resolveFormatProfile({ language, numberFormat }, undefined);
  const digits = metricMeta.readingDigits(metricKind, key, decimals);
  return fit.autoRoomColumnsFor({
    metricKind,
    displayUnitProfile: definition.unitProfiles[key],
    fmt: (value) => formatters.formatNumber(profile, value, digits),
  });
}

// Every language with every number format, each written as a chip writes it.
function* everyFormat() {
  for (const language of LANGUAGES) {
    for (const numberFormat of formatProfile.NUMBER_FORMATS) yield { language, numberFormat };
  }
}

test("every measurement in every unit, precision, language and number format gets a whole count between 1 and the room_columns ceiling", () => {
  for (const format of everyFormat()) {
    for (const kind of METRIC_KINDS) {
      for (const profileKey of Object.keys(definitions.METRIC_DEFINITIONS[kind].unitProfiles)) {
        for (const decimals of [null, 0, 1, 2]) {
          const count = columns(kind, { profileKey, decimals, ...format });
          const where = `${kind} in ${profileKey}, decimals ${decimals}, ${format.language}/${format.numberFormat}`;
          assert.ok(Number.isInteger(count) && count >= 1 && count <= fit.MAX_AUTO_COLUMNS, `${where}: ${count}`);
        }
      }
    }
  }
});

test("a reading written wider than its measurement's standard never fits more chips into a row", () => {
  const standard = columns("temperature");
  assert.ok(columns("temperature", { profileKey: "kelvin" }) <= standard, "308,2K: three integer digits");
  assert.ok(columns("temperature", { decimals: 2 }) <= standard, "35,00°C");
  assert.ok(columns("humidity", { decimals: 2 }) <= columns("humidity"), "80,00%");
  assert.ok(columns("co", { profileKey: "ppb" }) <= columns("co", { profileKey: "ppm" }), "10.305ppb against 10,3ppm");
});

test("the two-letter short code beside its mark limits every chip, also one with a narrow reading", () => {
  const shortCodeOnly = fit.autoRoomColumns({ valueTexts: [""], unitText: "" });
  for (const kind of METRIC_KINDS) {
    assert.ok(columns(kind, { decimals: 0 }) <= shortCodeOnly, kind);
  }
});

test("the chip's own formatter writes the typical readings", () => {
  const sized = (fmt) => fit.autoRoomColumnsFor({ metricKind: "co2", displayUnitProfile: null, fmt });
  assert.ok(sized(() => "2.000.000.000") < sized(() => "2"), "a longer text fits fewer chips");
  const written = [];
  const fahrenheit = definitions.METRIC_DEFINITIONS.temperature.unitProfiles.fahrenheit;
  fit.autoRoomColumnsFor({
    metricKind: "temperature",
    displayUnitProfile: fahrenheit,
    fmt: (value) => {
      written.push(value);
      return "";
    },
  });
  assert.deepEqual(written, [50, 95], "10–35 °C, converted into the display unit");
});

test("a wider text never fits more chips, and the count stays between 1 and the room_columns ceiling", () => {
  const texts = ["", "1", "12", "12,3", "123,4", "1.234,5", "12.345,67", "123.456.789,01"];
  let previous = Infinity;
  for (const text of texts) {
    const count = fit.autoRoomColumns({ valueTexts: [text], unitText: "°C" });
    assert.ok(count <= previous, `${text}: ${count} after ${previous}`);
    assert.ok(Number.isInteger(count) && count >= 1 && count <= fit.MAX_AUTO_COLUMNS, `${text}: ${count}`);
    previous = count;
  }
  assert.equal(fit.autoRoomColumns({ valueTexts: ["123.456.789.012.345,67"], unitText: "µg/m³" }), 1, "never fewer than one");
  // The widest of several texts decides.
  assert.equal(
    fit.autoRoomColumns({ valueTexts: ["1,0", "308,2"], unitText: "K" }),
    fit.autoRoomColumns({ valueTexts: ["308,2"], unitText: "K" })
  );
});

test("a character outside the measured table counts as the widest one of its role", () => {
  const known = fit.autoRoomColumns({ valueTexts: ["35,0"], unitText: "mg/m³" });
  const unknown = fit.autoRoomColumns({ valueTexts: ["35,0"], unitText: "mg/m⁴" });
  assert.ok(unknown <= known);
  assert.equal(fit.autoRoomColumns({ valueTexts: ["٣٥"], unitText: "°C" }), fit.autoRoomColumns({ valueTexts: ["00"], unitText: "°C" }), "a digit the table lacks counts as a digit");
});

test("an unknown measurement is sized like temperature, in its canonical unit", () => {
  const fmt = (value) => formatters.formatNumber(formatProfile.resolveFormatProfile({ language: "de" }, undefined), value, 1);
  assert.equal(fit.autoRoomColumnsFor({ metricKind: null, displayUnitProfile: null, fmt }), 7);
  assert.equal(fit.autoRoomColumnsFor({ metricKind: "pressure", displayUnitProfile: null, fmt }), 7);
});

test("the glyph table covers every unit the card writes", () => {
  for (const definition of Object.values(definitions.METRIC_DEFINITIONS)) {
    for (const profile of Object.values(definition.unitProfiles)) {
      for (const character of profile.displayUnit) {
        assert.ok(Object.hasOwn(metrics.GLYPH_ADVANCE_EM.unit, character), `${profile.displayUnit}: ${character}`);
      }
    }
  }
  for (const character of metrics.REFERENCE_SHORT_LABEL) {
    assert.ok(Object.hasOwn(metrics.GLYPH_ADVANCE_EM.label, character), character);
  }
});
