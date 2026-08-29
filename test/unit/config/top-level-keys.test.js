"use strict";

// Direct unit tests for the top-level key check and its suggestion.
//
// Split out of config-normalize-modules.test.js next door, which is about what a KNOWN key
// normalizes to. This file is about the key itself: whether the card owns it, whether it was
// handed the key by Home Assistant, and — for one it has never heard of — which option the
// writer was probably reaching for.
//
// The suggestion is the part worth testing hard. It is offered in a sentence that tells
// somebody to go and edit their YAML, so a wrong one costs more than none at all: it sends
// them to change a key they did not write. What that buys is one rule — the nearest allowed
// key, and only when it is the only one that close.

const test = require("node:test");
const assert = require("node:assert/strict");
const { MISSPELLED_CONFIG_KEYS } = require("../../property/vocabulary.js");

let keys;

test.before(async () => {
  keys = await import("../../../src/config/top-level-keys.js");
});

test("every misspelling the property generator writes is answered with the option meant", () => {
  // The generator's list is what a person actually mistypes, so it is the population this
  // has to cover rather than a set of examples chosen to pass.
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
    assert.equal(keys.nearestKey(written, keys.TOP_LEVEL_KEYS), intended, written);
  }
});

test("a key that resembles nothing gets no suggestion", () => {
  for (const written of ["wibble", "completely_made_up", "x", ""]) {
    assert.equal(keys.nearestKey(written, keys.TOP_LEVEL_KEYS), null, written);
  }
});

test("case alone is not a mistake worth a different answer", () => {
  assert.equal(keys.nearestKey("Palette", keys.TOP_LEVEL_KEYS), "palette");
  assert.equal(keys.nearestKey("ROOMS", keys.TOP_LEVEL_KEYS), "rooms");
});

test("two options equally close produce no suggestion at all", () => {
  // `title` and `rooms` are both one edit from these, and naming either would send a reader
  // to fix a key they did not write.
  assert.equal(keys.nearestKey("titl", new Set(["title", "titel"])), null);
  assert.equal(keys.nearestKey("swipes", new Set(["swipe", "swiper"])), null);
  // One of them alone is answered, so the silence above is about the tie and not about
  // the distance.
  assert.equal(keys.nearestKey("titl", new Set(["title"])), "title");
});

test("the suggestion never reaches further than two edits", () => {
  assert.equal(keys.nearestKey("iconic", new Set(["icon"])), "icon", "two edits still answers");
  assert.equal(keys.nearestKey("iconics", new Set(["icon"])), null, "three does not");
});

test("a key the card owns produces no diagnostic", () => {
  for (const key of keys.TOP_LEVEL_KEYS) {
    assert.deepEqual(keys.unknownTopLevelKeys({ [key]: "whatever" }), [], key);
  }
});

test("a key Home Assistant writes produces no diagnostic either", () => {
  for (const key of keys.FRAMEWORK_KEYS) {
    assert.deepEqual(keys.unknownTopLevelKeys({ [key]: "whatever" }), [], key);
  }
});

test("each unknown key gets its own line, in the order it was written", () => {
  assert.deepEqual(keys.unknownTopLevelKeys({ entity: "sensor.a", pallete: 1, wibble: 2 }), [
    'pallete: ignoring an unknown top-level option; did you mean "palette"?',
    "wibble: ignoring an unknown top-level option",
  ]);
});

test("nothing unknown produces nothing to say", () => {
  assert.deepEqual(keys.unknownTopLevelKeys({}), []);
  assert.deepEqual(keys.unknownTopLevelKeys({ entity: "sensor.a", type: "custom:room-climate-card" }), []);
});
