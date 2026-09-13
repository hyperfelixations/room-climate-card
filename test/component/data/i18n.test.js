"use strict";

// Manual `language` config override, and translation-key parity: every TRANSLATIONS block
// must carry the same key set as "en". TRANSLATIONS is not exported, so parity is checked
// the way a user would notice it — spy on console.warn during a fresh script load and
// assert the bundle's own verifyTranslationKeyParity() (src/i18n/integrity.js) never
// fires. Uses its own console-instrumented realm; the artifact path comes from the shared
// helper, the one place that knows where the build output lives.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { createTestEnvironment, CARD_SOURCE_PATH } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Import the owning module directly so each test names its actual subject.
let access;

const CARD_SOURCE = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
// Every supported language is iterated here, so this matrix imports the list rather than
// copying it. See test/manifests/product-surface.js.
const { LANGUAGES: SUPPORTED_LANGUAGES } = require("../../manifests/product-surface.js");
const { TEMPERATURE, TEMPERATURE_C } = require("../../fixtures/attributes.js");

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
  access = await import("../../../src/domain/metrics/access.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const hassDe = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }, "de");

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
    const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }, locale);
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
    [1, "1 комната сейчас недоступна."],
    [2, "2 комнаты сейчас недоступны."],
    [5, "5 комнат сейчас недоступно."],
    [21, "21 комната сейчас недоступна."],
    [22, "22 комнаты сейчас недоступны."],
    [25, "25 комнат сейчас недоступно."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("hint.roomsUnavailable", { count }), expected, `rooms=${count}`);
  }
  const sourceExpected = new Map([
    [2, "2 источника сейчас недоступны."],
    [5, "5 источников сейчас недоступно."],
    [21, "21 источник сейчас недоступен."],
  ]);
  for (const [count, expected] of sourceExpected) {
    assert.equal(el._t("hint.several", { count }), expected, `sources=${count}`);
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
    [1, "1 pokój jest obecnie niedostępny."],
    [2, "2 pokoje są obecnie niedostępne."],
    [5, "5 pokoi jest obecnie niedostępnych."],
    [21, "21 pokoi jest obecnie niedostępnych."],
    [22, "22 pokoje są obecnie niedostępne."],
    [25, "25 pokoi jest obecnie niedostępnych."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("hint.roomsUnavailable", { count }), expected, `rooms=${count}`);
  }
  assert.equal(el._t("hint.several", { count: 2 }), "2 źródła są obecnie niedostępne.");
  assert.equal(el._t("hint.several", { count: 5 }), "5 źródeł jest obecnie niedostępnych.");
  env.cleanup(el);
});

test("I18N-02: Ukrainian room grammar follows one/few/many plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "uk" }, hassDe);
  const roomExpected = new Map([
    [1, "1 кімната зараз недоступна."],
    [2, "2 кімнати зараз недоступні."],
    [5, "5 кімнат зараз недоступно."],
    [21, "21 кімната зараз недоступна."],
    [22, "22 кімнати зараз недоступні."],
    [25, "25 кімнат зараз недоступно."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("hint.roomsUnavailable", { count }), expected, `rooms=${count}`);
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
  assert.equal(el._t("hint.several", { count: 2 }), "2 джерела зараз недоступні.");
  assert.equal(el._t("hint.several", { count: 5 }), "5 джерел зараз недоступно.");
  env.cleanup(el);
});

test("I18N-02: Korean, Japanese, and Chinese count phrases do not invent grammatical noun plurals", () => {
  const expected = {
    ko: ["방 1개를 현재 사용할 수 없습니다.", "방 5개를 현재 사용할 수 없습니다."],
    ja: ["1 部屋が現在利用できません。", "5 部屋が現在利用できません。"],
    zh: ["1 个房间当前不可用。", "5 个房间当前不可用。"],
  };
  for (const [lang, [one, many]] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("hint.roomsUnavailable", { count: 1 }), one, `lang=${lang}, count=1`);
    assert.equal(el._t("hint.roomsUnavailable", { count: 5 }), many, `lang=${lang}, count=5`);
    env.cleanup(el);
  }
});

test("I18N-02: Latvian room grammar follows the zero/one/other plural categories", () => {
  const el = env.createCard({ entity: "sensor.avg", language: "lv" }, hassDe);
  // zero: n%10=0 or n%100 in 11..19 (genitive plural "telpu");
  // one: n%10=1 and n%100!=11 (nominative singular "telpa");
  // other: everything else (nominative plural "telpas").
  const roomExpected = new Map([
    [1, "1 telpa pašlaik nav pieejama."],
    [2, "2 telpas pašlaik nav pieejamas."],
    [10, "10 telpu pašlaik nav pieejamas."],
    [11, "11 telpu pašlaik nav pieejamas."],
    [20, "20 telpu pašlaik nav pieejamas."],
    [21, "21 telpa pašlaik nav pieejama."],
  ]);
  for (const [count, expected] of roomExpected) {
    assert.equal(el._t("hint.roomsUnavailable", { count }), expected, `rooms=${count}`);
  }
  assert.equal(el._t("hint.several", { count: 2 }), "2 avoti pašlaik nav pieejami.");
  assert.equal(el._t("hint.several", { count: 11 }), "11 avotu pašlaik nav pieejami.");
  assert.equal(el._t("hint.several", { count: 21 }), "21 avots pašlaik nav pieejams.");
  // This sentence depends on v.total's own plural category, not count's: v.total >= 2 does
  // not collapse to one safe form for a zero/one/other language (10/11/20/21 differ).
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
    nb: { one: "1 rom er for øyeblikket utilgjengelig.", many: "5 rom er for øyeblikket utilgjengelige.", adjectivePlural: "varme" },
    sv: { one: "1 rum är för närvarande otillgängligt.", many: "5 rum är för närvarande otillgängliga.", adjectivePlural: "varma" },
  };
  for (const [lang, text] of Object.entries(expected)) {
    const el = env.createCard({ entity: "sensor.avg", language: lang }, hassDe);
    assert.equal(el._t("hint.roomsUnavailable", { count: 1 }), text.one, `lang=${lang}, count=1`);
    assert.equal(el._t("hint.roomsUnavailable", { count: 5 }), text.many, `lang=${lang}, count=5`);
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
  const hassUnknown = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }, "xx");
  const el = env.createCard({ entity: "sensor.avg" }, hassUnknown);
  assert.equal(el._language(), "en");
  env.cleanup(el);
});

test("a room that does not exist is a warning naming it, not a count in the subtitle", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
    // sensor.missing1 intentionally absent from hass.states
  }, "en");
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.missing1" }] },
    hass
  );
  // "does not exist", not "without data": an unknown entity is a configuration problem, told
  // apart from a room whose sensor is merely offline (that one keeps its `--` chip and a hint).
  assert.doesNotMatch(el._computeViewModel().subtitle, /sensor\.missing1|unavailable/);
  assert.equal(el.shadowRoot.querySelector(".rtc-warning-text").textContent, "sensor.missing1 does not exist in Home Assistant.");
  env.cleanup(el);
});
