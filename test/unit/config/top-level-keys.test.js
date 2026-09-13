"use strict";

// Direct unit tests for the top-level key check and the suggestion every unknown key gets
// (config/suggest.js). Boundary: config-normalize-modules.test.js is about what a known key
// normalizes to; this file is about the key itself — whether the card owns it, whether Home
// Assistant handed it over, and which option a mistyped key was reaching for. The suggestion
// rule: the nearest allowed key, within two edits, and only when it is the only one that close.

const test = require("node:test");
const assert = require("node:assert/strict");
const { MISSPELLED_CONFIG_KEYS } = require("../../property/vocabulary.js");

let keys;
let suggest;
let core;

test.before(async () => {
  keys = await import("../../../src/config/top-level-keys.js");
  suggest = await import("../../../src/config/suggest.js");
  core = await import("../../../src/core/diagnostics.js");
});

// Runs the check the way normalizeConfig() does and returns what it recorded.
function check(config) {
  const diagnostics = [];
  keys.checkTopLevelKeys(config, diagnostics);
  return diagnostics;
}

test("every misspelling the property generator writes is answered with the option meant", () => {
  // The generator's list is the population to cover, not examples chosen to pass.
  const expected = {
    entiy: "entity",
    entitiy: "entity",
    roomz: "rooms",
    room: "rooms",
    pallete: "palette",
    palete: "palette",
    subtitel: "subtitle",
    sub_title: "subtitle",
    titel: "title",
    view: "views",
    vieuws: "views",
    decimal: "decimals",
    rotation_second: "rotation_seconds",
    hide_foter: "hide_footer",
    "tap-action": "tap_action",
    tapAction: "tap_action",
  };
  assert.deepEqual(
    [...MISSPELLED_CONFIG_KEYS].sort(),
    Object.keys(expected).sort(),
    "the generator's misspellings and this expectation have drifted apart"
  );
  for (const [written, intended] of Object.entries(expected)) {
    assert.equal(suggest.nearestKey(written, keys.TOP_LEVEL_KEYS), intended, written);
  }
});

test("a key that resembles nothing gets no suggestion", () => {
  for (const written of ["wibble", "completely_made_up", "x", ""]) {
    assert.equal(suggest.nearestKey(written, keys.TOP_LEVEL_KEYS), null, written);
  }
});

test("case alone is not a mistake worth a different answer", () => {
  assert.equal(suggest.nearestKey("Palette", keys.TOP_LEVEL_KEYS), "palette");
  assert.equal(suggest.nearestKey("ROOMS", keys.TOP_LEVEL_KEYS), "rooms");
});

test("two options equally close produce no suggestion at all", () => {
  // Two options one edit away: naming either would send a reader to fix a key they did not
  // write.
  assert.equal(suggest.nearestKey("titl", new Set(["title", "titel"])), null);
  assert.equal(suggest.nearestKey("swipes", new Set(["swipe", "swiper"])), null);
  // One alone is answered, so the silence above is about the tie, not the distance.
  assert.equal(suggest.nearestKey("titl", new Set(["title"])), "title");
});

test("the suggestion never reaches further than two edits", () => {
  assert.equal(suggest.nearestKey("iconic", new Set(["icon"])), "icon", "two edits still answers");
  assert.equal(suggest.nearestKey("iconics", new Set(["icon"])), null, "three does not");
});

test("a key the card owns produces no diagnostic", () => {
  for (const key of keys.TOP_LEVEL_KEYS) {
    assert.deepEqual(check({ [key]: "whatever" }), [], key);
  }
});

test("a key Home Assistant writes produces no diagnostic either", () => {
  for (const key of keys.FRAMEWORK_KEYS) {
    assert.deepEqual(check({ [key]: "whatever" }), [], key);
  }
});

test("a typo of an option stops the card and names the option meant", () => {
  for (const written of MISSPELLED_CONFIG_KEYS) {
    const intended = suggest.nearestKey(written, keys.TOP_LEVEL_KEYS);
    assert.throws(
      () => check({ entity: "sensor.a", [written]: 1 }),
      { name: "ConfigError", message: `Invalid configuration: ${written} is not an option of this card. Did you mean ${intended}?` },
      written
    );
  }
});

test("the first typo written is the one named", () => {
  assert.throws(() => check({ titel: 1, pallete: 2 }), { message: /^Invalid configuration: titel is not an option/ });
});

test("a key close to no option, or closest to a Home Assistant key, is foreign: noted and ignored", () => {
  // A near miss of a framework key is somebody else's option, not the card's to correct.
  assert.deepEqual(check({ entity: "sensor.a", wibble: 1, avg_label: 2, "card-mod": 3, grid_option: 4 }), [
    core.createDiagnostic("config.foreign_key", { path: "wibble" }),
    core.createDiagnostic("config.foreign_key", { path: "avg_label" }),
    core.createDiagnostic("config.foreign_key", { path: "card-mod" }),
    core.createDiagnostic("config.foreign_key", { path: "grid_option" }),
  ]);
});

test("nothing unknown produces nothing to say", () => {
  assert.deepEqual(check({}), []);
  assert.deepEqual(check({ entity: "sensor.a", type: "custom:room-climate-card" }), []);
});
