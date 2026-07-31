"use strict";

// I18N-01 (v2.15.0 audit): manual `language` config override, plus the
// "Translation-Key-Paritaet aller Sprachen" audit checklist item — every
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
const { computeLegacyData } = require("../helpers/legacy-dto.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// The compositions the element used to expose only for tests (see the helper).
let internals;

// The modules under test, imported directly. These used to be reached through
// thin delegating methods on the custom element; the element no longer carries
// them, and naming the real module is what makes each test say where its subject
// actually lives.
let access;

const CARD_SOURCE = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
const SUPPORTED_LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh", "nb", "sv", "lv"];

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
  assert.equal(el._t("avg.label"), "Moy. maison");
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
    es: { title: "Temperatura", avg: "Media del hogar", empty: "No hay datos disponibles." },
    ru: { title: "Температура", avg: "Среднее по дому", empty: "Нет доступных данных." },
    pl: { title: "Temperatura", avg: "Średnia dla domu", empty: "Brak dostępnych danych." },
    ko: { title: "온도", avg: "집 전체 평균", empty: "사용 가능한 데이터가 없습니다." },
    ja: { title: "温度", avg: "住宅平均", empty: "利用可能なデータがありません。" },
    zh: { title: "温度", avg: "全屋平均", empty: "暂无可用数据。" },
  };
  for (const [lang, text] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("title.temperature"), text.title, `lang=${lang}: title`);
    assert.equal(el._t("avg.label"), text.avg, `lang=${lang}: average label`);
    assert.equal(el._t("empty.title"), text.empty, `lang=${lang}: empty title`);
    env.cleanup(el);
  }
});

test("I18N-02: every function-valued translation executes with the full runtime variable contract in all supported languages", () => {
  const functionKeys = [
    "avg.tooltip",
    "avg.tooltipCalculated",
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
    "empty.hintMissingRooms",
  ];
  const vars = {
    label: "Test label",
    value: "22.0 °C",
    diff: "2.0 °C",
    count: 2,
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

test("I18N-02: Russian room/entity grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "ru" }, hassDe);
  const roomExpected = new Map([
    [1, " 1 комната без данных."],
    [2, " 2 комнаты без данных."],
    [5, " 5 комнат без данных."],
    [21, " 21 комната без данных."],
    [22, " 22 комнаты без данных."],
    [25, " 25 комнат без данных."],
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
  assert.match(el._t("empty.hintMissingRooms", { count: 1 }), /^1 настроенная сущность отсутствует/);
  assert.match(el._t("empty.hintMissingRooms", { count: 2 }), /^2 настроенные сущности отсутствуют/);
  assert.match(el._t("empty.hintMissingRooms", { count: 5 }), /^5 настроенных сущностей отсутствуют/);
  env.cleanup(el);
});

test("I18N-02: Polish room/entity grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "pl" }, hassDe);
  const roomExpected = new Map([
    [1, " 1 pokój bez danych."],
    [2, " 2 pokoje bez danych."],
    [5, " 5 pokoi bez danych."],
    [21, " 21 pokoi bez danych."],
    [22, " 22 pokoje bez danych."],
    [25, " 25 pokoi bez danych."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  assert.match(el._t("empty.hintMissingRooms", { count: 1 }), /^1 skonfigurowana encja jest niedostępna/);
  assert.match(el._t("empty.hintMissingRooms", { count: 2 }), /^2 skonfigurowane encje są niedostępne/);
  assert.match(el._t("empty.hintMissingRooms", { count: 5 }), /^5 skonfigurowanych encji jest niedostępnych/);
  env.cleanup(el);
});

test("I18N-02: Korean, Japanese, and Chinese count phrases do not invent grammatical noun plurals", () => {
  const expected = {
    ko: [" 1개 방은 데이터 없음.", " 5개 방은 데이터 없음."],
    ja: [" 1室はデータなし。", " 5室はデータなし。"],
    zh: [" 1个房间无数据。", " 5个房间无数据。"],
  };
  for (const [lang, [one, many]] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("subtitle.missingRooms", { count: 1 }), one, `lang=${lang}, count=1`);
    assert.equal(el._t("subtitle.missingRooms", { count: 5 }), many, `lang=${lang}, count=5`);
    env.cleanup(el);
  }
});

test("I18N-02: Latvian room/entity grammar follows the zero/one/other plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "lv" }, hassDe);
  // zero: n%10=0 or n%100 in 11..19 (genitive plural "telpu"/"entītiju");
  // one: n%10=1 and n%100!=11 (nominative singular "telpa"/"entītija");
  // other: everything else (nominative plural "telpas"/"entītijas").
  const roomExpected = new Map([
    [0, " 0 telpu bez datiem."],
    [1, " 1 telpa bez datiem."],
    [2, " 2 telpas bez datiem."],
    [11, " 11 telpu bez datiem."],
    [20, " 20 telpu bez datiem."],
    [21, " 21 telpa bez datiem."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("subtitle.missingRooms", { count }), expected, `rooms=${count}`);
  }
  assert.match(el._t("empty.hintMissingRooms", { count: 1 }), /^1 konfigurēta entītija trūkst/);
  assert.match(el._t("empty.hintMissingRooms", { count: 2 }), /^2 konfigurētas entītijas trūkst/);
  assert.match(el._t("empty.hintMissingRooms", { count: 11 }), /^11 konfigurētu entītiju trūkst/);
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
    nb: { one: " 1 rom uten data.", many: " 5 rom uten data.", adjectivePlural: "varme" },
    sv: { one: " 1 rum utan data.", many: " 5 rum utan data.", adjectivePlural: "varma" },
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
  const data = computeLegacyData(el);
  assert.match(data.subtitle, /1 room without data/);
  env.cleanup(el);
});
