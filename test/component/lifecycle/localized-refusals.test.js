"use strict";

// What setConfig() throws is what Home Assistant shows in its error card, so a refused
// configuration is worded in the card's language — before any hass exists. The language is the
// card's own valid `language`, else the page's <html lang> that Home Assistant sets, else
// English. Boundary: which configurations are refused is the config tests' to pin; this file
// owns only the language a refusal is worded in, and that it stays a refusal.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => env.cleanupAll());

// What a fresh card throws for `config` on a page in `pageLanguage` (null: no lang attribute).
function refusalOf(config, pageLanguage = null) {
  const root = env.document.documentElement;
  const before = root.getAttribute("lang");
  if (pageLanguage === null) root.removeAttribute("lang");
  else root.setAttribute("lang", pageLanguage);
  const el = env.document.createElement("room-climate-card");
  try {
    el.setConfig(config);
    return null;
  } catch (error) {
    return { name: error.name, message: error.message };
  } finally {
    if (before === null) root.removeAttribute("lang");
    else root.setAttribute("lang", before);
  }
}

test("without a language anywhere, a refusal is English", () => {
  assert.deepEqual(refusalOf({ entity: "sensor.a", pallete: "vivid" }), {
    name: "ConfigError",
    message: "Invalid configuration: pallete is not an option of this card. Did you mean palette?",
  });
});

test("the page's language words a refusal before any hass exists", () => {
  assert.deepEqual(refusalOf({ entity: "sensor.a", pallete: "vivid" }, "de-DE"), {
    name: "ConfigError",
    message: "Ungültige Konfiguration: pallete ist keine Option dieser Karte. Meintest du palette?",
  });
});

test("the card's own language wins over the page's", () => {
  assert.equal(refusalOf({ entity: "sensor.a", language: "fr", rooms: "sensor.b" }, "de").message, "Configuration invalide : rooms doit être une liste.");
});

test("a language the card does not have leaves the choice to the page", () => {
  assert.equal(refusalOf({ entity: 5, language: "xx" }, "ja").message, "無効な設定: entity はエンティティ ID である必要があります。");
  assert.equal(refusalOf({}, "pt-BR").message, "Invalid configuration: set entity, or add at least one entry under rooms.", "a page language the card has no words for is English");
});

test("every refusal of the catalog is worded in the page's language", () => {
  const cases = [
    ["x", "Ungültige Konfiguration: Die Kartenkonfiguration muss ein YAML-Objekt sein."],
    [{ entity: "sensor.a", show: { footer: false } }, "Ungültige Konfiguration: show.footer ist keine Option dieser Karte."],
    [{}, "Ungültige Konfiguration: Setze entity oder füge unter rooms mindestens einen Eintrag hinzu."],
    [{ entity: 5 }, "Ungültige Konfiguration: entity muss eine Entity-ID sein."],
    [{ rooms: "sensor.a" }, "Ungültige Konfiguration: rooms muss eine Liste sein."],
    [{ rooms: ["sensor.a"] }, "Ungültige Konfiguration: rooms[0] muss ein Objekt sein."],
    [{ rooms: [{ entity: "sensor.a" }, { entity: "sensor.a" }] }, "Ungültige Konfiguration: sensor.a wird von mehr als einem Raum verwendet."],
  ];
  for (const [config, message] of cases) {
    assert.deepEqual(refusalOf(config, "de"), { name: "ConfigError", message }, JSON.stringify(config));
  }
});
