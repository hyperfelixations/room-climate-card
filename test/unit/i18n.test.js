"use strict";

// Manual `language` config override and translation-key parity: every
// TRANSLATIONS language block must carry exactly the same key set as the
// "en" reference block. TRANSLATIONS itself is scoped inside the file's own
// IIFE closure (not exported), so key parity is verified the same way a
// real user would ever notice it: by spying on console.warn during script
// load and asserting the bundle's own self-check (verifyTranslationKeyParity()
// from src/i18n/integrity.js, invoked at the end of src/i18n/registry.js)
// never fires.
//
// This test needs its own console-instrumented realm (the shared helper's
// environment has already evaluated the bundle by the time a test runs), but
// it takes the artifact PATH from that helper — there is exactly one place in
// the suite that knows where the build output lives.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { createTestEnvironment, CARD_SOURCE_PATH } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Import the owning module directly so each test names its actual subject.
let access;

const CARD_SOURCE = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
// From the manifest, not written out again: this file iterates EVERY supported language,
// so it is exactly the kind of generic matrix that must not carry its own copy. See
// test/contracts/product-surface.js.
const { LANGUAGES: SUPPORTED_LANGUAGES } = require("../contracts/product-surface.js");

test("all TRANSLATIONS language blocks stay in sync with en (the file's own load-time self-check never warns)", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const warnings = [];
  dom.window.console.warn = (...args) => warnings.push(args.join(" "));
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.document.fonts = { ready: Promise.resolve() };
  vm.runInContext(CARD_SOURCE, dom.getInternalVMContext(), { filename: CARD_SOURCE_PATH });
  const i18nWarnings = warnings.filter((w) => w.includes("TRANSLATIONS"));
  assert.deepEqual(i18nWarnings, [], `translation key parity self-check must not warn: ${i18nWarnings.join("\n")}`);
});

let env;
test.before(async () => {
  internals = await loadCardInternals();
  access = await import("../../src/domain/metrics/access.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const hassDe = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) }, "de");

test("I18N-01: language:fr overrides hass.language:de", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "fr" }, hassDe);
  assert.equal(el._language(), "fr");
  assert.equal(el._t("value.homeAverage"), "Moy. maison");
  env.cleanup(el);
});

test("I18N-01: default language:auto keeps the existing hass-based auto-detection (de)", () => {
  const el = env.createCard({ entity: "sensor.avg" }, hassDe);
  assert.equal(el._language(), "de");
  env.cleanup(el);
});

test("I18N-01: an explicit 'auto' value behaves identically to omitting the field", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "auto" }, hassDe);
  assert.equal(el._language(), "de");
  env.cleanup(el);
});

test("I18N-01: an invalid language value falls back to auto (de), not to en, and does not throw", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "xx-not-real" }, hassDe);
  assert.equal(el._language(), "de");
  env.cleanup(el);
});

test("I18N-01: value is case-insensitive", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "FR" }, hassDe);
  assert.equal(el._language(), "fr");
  env.cleanup(el);
});

test("I18N-02: all supported base languages are individually selectable via config", () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._language(), lang);
    env.cleanup(el);
  }
});

test("I18N-02: regional HA locales resolve to the supported base language", () => {
  for (const [locale, expected] of [["es-MX", "es"], ["ru-RU", "ru"], ["pl-PL", "pl"], ["ko-KR", "ko"], ["ja-JP", "ja"], ["zh-CN", "zh"]]) {
    const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) }, locale);
    const el = env.createCard({ entity: "sensor.avg" }, hass);
    assert.equal(el._language(), expected, `locale=${locale}`);
    env.cleanup(el);
  }
});

test("I18N-02: every new language has native representative card text instead of English fallback", () => {
  const expected = {
    es: { title: "Temperatura", avg: "Media del hogar", noData: "Sin datos" },
    ru: { title: "Температура", avg: "Среднее по дому", noData: "Нет данных" },
    pl: { title: "Temperatura", avg: "Średnia dla domu", noData: "Brak danych" },
    ko: { title: "온도", avg: "집 전체 평균", noData: "데이터 없음" },
    ja: { title: "温度", avg: "住宅平均", noData: "データなし" },
    zh: { title: "温度", avg: "全屋平均", noData: "无数据" },
  };
  for (const [lang, text] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("title.temperature"), text.title, `lang=${lang}: title`);
    assert.equal(el._t("value.homeAverage"), text.avg, `lang=${lang}: average label`);
    assert.equal(el._t("status.noData"), text.noData, `lang=${lang}: no-data status`);
    env.cleanup(el);
  }
});

test("I18N-02: every function-valued translation executes with the full runtime variable contract in all supported languages", () => {
  const functionKeys = [
    "value.tooltip",
    "value.tooltipCalculated",
    "subtitle.aboveComfort",
    "subtitle.aboveComfortNoRooms",
    "subtitle.belowComfort",
    "subtitle.belowComfortNoRooms",
    "subtitle.inComfortIssue",
    "subtitle.missingRooms",
    "footer.comfort",
    "footer.spread",
    "footer.trend",
    "trend.direction.rising",
    "trend.direction.stable",
    "trend.direction.falling",
    "trend.aria",
    "scale.comfortLabel",
    "scale.optimalLabel",
    "rangeScale.footer",
    "card.ariaOpen",
    "room.ariaOpen",
    "availability.entitiesMissing",
  ];
  const vars = {
    label: "Test label",
    value: "22.0 °C",
    diff: "2.0 °C",
    count: 2,
    entities: "sensor.one, sensor.two",
    total: 4,
    adjective: "test adjective",
    name: "Test room",
    sign: "+",
    unit: "°C/h",
    direction: "rising",
    range: "20–24 °C",
    span: "5.0 °C",
    min: "18.0 °C",
    minTime: "06:00",
    max: "23.0 °C",
    maxTime: "15:00",
  };
  for (const lang of SUPPORTED_LANGUAGES) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    for (const key of functionKeys) {
      const text = el._t(key, vars);
      assert.equal(typeof text, "string", `lang=${lang}, key=${key}: must return a string`);
      assert.ok(text.length > 0, `lang=${lang}, key=${key}: must not be empty`);
      assert.doesNotMatch(text, /undefined|\[object Object\]/, `lang=${lang}, key=${key}: all runtime vars must resolve`);
    }
    env.cleanup(el);
  }
});

test("I18N-02: new language locales drive decimal/group separators and keep 24-hour time", () => {
  const expectedNumbers = {
    es: "1234,5",
    ru: "1\u00a0234,5",
    pl: "1234,5",
    ko: "1,234.5",
    ja: "1,234.5",
    zh: "1,234.5",
  };
  for (const [lang, expectedNumber] of Object.entries(expectedNumbers)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._fmt(1234.5, 1), expectedNumber, `lang=${lang}: number locale`);
    assert.match(el._formatTime("2026-07-24T13:05:00Z"), /^\d{2}:\d{2}$/, `lang=${lang}: 24-hour time`);
    env.cleanup(el);
  }
});

test("I18N-02: JS-derived classification is localized, while HA-provided value_level stays verbatim", () => {
  const expectedDerivedLevel = {
    es: "Caluroso",
    ru: "Жарко",
    pl: "Gorąco",
    ko: "더움",
    ja: "暑い",
    zh: "炎热",
  };
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 26, {
      device_class: "temperature",
      unit_of_measurement: "°C",
      value_level: "SERVER-PROVIDED LEVEL",
      value_color: "#123456",
    }),
  }, "de");
  for (const [lang, expected] of Object.entries(expectedDerivedLevel)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hass);
    const profile = access.getUnitProfile("temperature", "celsius");
    assert.equal(internals.fallbackTone(el, 26, "temperature", profile).label, expected, `lang=${lang}: derived fallback`);
    assert.equal(
      internals.averageTone(el, 26, "sensor.avg", "temperature", profile).label,
      "SERVER-PROVIDED LEVEL",
      `lang=${lang}: HA attribute must remain verbatim`
    );
    env.cleanup(el);
  }
});

test("I18N-02: Russian room grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "ru" }, hassDe);
  const roomExpected = new Map([
    [1, " 1 комната не найдена."],
    [2, " 2 комнаты не найдены."],
    [5, " 5 комнат не найдено."],
    [21, " 21 комната не найдена."],
    [22, " 22 комнаты не найдены."],
    [25, " 25 комнат не найдено."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  assert.match(
    el._t("subtitle.aboveComfort", { diff: "1 °C", count: 21, total: 21, adjective: "тепло" }),
    /в 21 комнате из 21 комнаты тепло\.$/,
    "21 must use the numeral-governed singular forms in both positions"
  );
  assert.match(
    el._t("subtitle.belowComfort", { diff: "1 °C", count: 22, total: 25, adjective: "прохладно" }),
    /в 22 комнатах из 25 комнат прохладно\.$/,
    "few/many categories must remain grammatically correct in the comfort sentence"
  );
  env.cleanup(el);
});

test("I18N-02: Polish room grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "pl" }, hassDe);
  const roomExpected = new Map([
    [1, " 1 pokój nie został znaleziony."],
    [2, " 2 pokoje nie zostały znalezione."],
    [5, " 5 pokoi nie zostało znalezionych."],
    [21, " 21 pokoi nie zostało znalezionych."],
    [22, " 22 pokoje nie zostały znalezione."],
    [25, " 25 pokoi nie zostało znalezionych."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  env.cleanup(el);
});

test("I18N-02: Ukrainian room grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "uk" }, hassDe);
  const roomExpected = new Map([
    [1, " 1 налаштована кімната не знайдена."],
    [2, " 2 налаштовані кімнати не знайдені."],
    [5, " 5 налаштованих кімнат не знайдено."],
    [21, " 21 налаштована кімната не знайдена."],
    [22, " 22 налаштовані кімнати не знайдені."],
    [25, " 25 налаштованих кімнат не знайдено."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  assert.match(
    el._t("subtitle.aboveComfort", { diff: "1 °C", count: 1, total: 21, adjective: "тепло" }),
    /1\/21 кімната: тепло\.$/,
    "total=21 must use the singular room form"
  );
  assert.match(
    el._t("subtitle.belowComfort", { diff: "1 °C", count: 2, total: 25, adjective: "прохолодно" }),
    /2\/25 кімнат: прохолодно\.$/,
    "total=25 must use the many room form"
  );
  assert.match(
    el._t("availability.entitiesMissing", { count: 1, entities: "sensor.room" }),
    /^Налаштовану сутність кімнати не знайдено \(1\):/,
    "a single missing entity must use singular agreement"
  );
  env.cleanup(el);
});

test("I18N-02: Korean, Japanese, and Chinese count phrases do not invent grammatical noun plurals", () => {
  const expected = {
    ko: [" 구성된 방 1개를 찾을 수 없습니다.", " 구성된 방 5개를 찾을 수 없습니다."],
    ja: [" 設定された部屋が 1 件見つかりません。", " 設定された部屋が 5 件見つかりません。"],
    zh: [" 未找到 1 个已配置的房间。", " 未找到 5 个已配置的房间。"],
  };
  for (const [lang, [one, many]] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("subtitle.missingRooms", { count: 1 }), one, `lang=${lang}, count=1`);
    assert.equal(el._t("subtitle.missingRooms", { count: 5 }), many, `lang=${lang}, count=5`);
    env.cleanup(el);
  }
});

test("I18N-02: Latvian room grammar follows the zero/one/other plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "lv" }, hassDe);
  // zero: n%10=0 or n%100 in 11..19 (genitive plural "telpu");
  // one: n%10=1 and n%100!=11 (nominative singular "telpa");
  // other: everything else (nominative plural "telpas").
  const roomExpected = new Map([
    [0, " 0 telpu nav atrastas."],
    [1, " 1 telpa nav atrasta."],
    [2, " 2 telpas nav atrastas."],
    [11, " 11 telpu nav atrastas."],
    [20, " 20 telpu nav atrastas."],
    [21, " 21 telpa nav atrasta."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  // The "count/total rooms" comfort sentence depends on v.total's OWN
  // category, same as the existing Russian test above — v.total >= 2 does
  // NOT collapse this to a single safe form for a zero/one/other language
  // (10, 11, 20, 21 are all >= 2 but land in different categories).
  assert.match(
    el._t("subtitle.aboveComfort", { diff: "1 °C", count: 1, total: 11, adjective: "siltas" }),
    /1\/11 telpu ir siltas\.$/,
    "total=11 must use the genitive-plural zero-category noun form"
  );
  assert.match(
    el._t("subtitle.aboveComfort", { diff: "1 °C", count: 1, total: 21, adjective: "siltas" }),
    /1\/21 telpa ir siltas\.$/,
    "total=21 must use the nominative-singular one-category noun form"
  );
  env.cleanup(el);
});

test("I18N-02: Norwegian and Swedish keep 'rom'/'rum' plural-invariant while still inflecting the predicative adjective", () => {
  const expected = {
    nb: { one: " 1 konfigurerte rom ble ikke funnet.", many: " 5 konfigurerte rom ble ikke funnet.", adjectivePlural: "varme" },
    sv: { one: " 1 konfigurerade rum hittades inte.", many: " 5 konfigurerade rum hittades inte.", adjectivePlural: "varma" },
  };
  for (const [lang, text] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("subtitle.missingRooms", { count: 1 }), text.one, `lang=${lang}, count=1`);
    assert.equal(el._t("subtitle.missingRooms", { count: 5 }), text.many, `lang=${lang}, count=5`);
    assert.equal(el._t("adjective.warm"), text.adjectivePlural, `lang=${lang}: adjective must be the plural predicative form`);
    env.cleanup(el);
  }
});

test("I18N-01: cache invalidates on a config-only language change with the same hass object", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "en" }, hassDe);
  assert.equal(el._language(), "en");
  el.setConfig({ entity: "sensor.avg", language: "it" });
  assert.equal(el._language(), "it", "cache must not still return the pre-change language");
  env.cleanup(el);
});

test("_t(): an unknown key falls back to the key itself, never throws or returns undefined", () => {
  const el = env.createCard({ entity: "sensor.avg" }, hassDe);
  assert.equal(el._t("this.key.does.not.exist"), "this.key.does.not.exist");
  env.cleanup(el);
});

test("_t(): unsupported hass.language falls back cleanly to English (2.9.1 default)", () => {
  const hassUnknown = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) }, "xx");
  const el = env.createCard({ entity: "sensor.avg" }, hassUnknown);
  assert.equal(el._language(), "en");
  env.cleanup(el);
});

test("pluralization: missingRooms uses singular/plural correctly for 1 vs N missing entities", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    // sensor.missing1 intentionally absent from hass.states
  }, "en");
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.missing1" }] },
    hass
  );
  const data = el._computeViewModel();
  // "not found", not "without data": a room whose entity Home Assistant does not know
  // is a configuration problem, and the card must not describe it the same way it
  // describes a room whose sensor is merely offline — that one keeps its `--` chip.
  assert.match(data.subtitle, /1 configured room was not found/);
  env.cleanup(el);
});
