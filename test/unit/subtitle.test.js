"use strict";

// The subtitle's "which room stands out most" logic
// must compare |value-avg| (distance to the average), not distance to the
// comfort-band edge. Exact ties are covered separately.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("comfort 20-24 with avg 23.9 names the room farthest from the average", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23.9, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.cool": mkState("sensor.cool", 19.8, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.warm": mkState("sensor.warm", 24.2, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "CoolRoom", entity: "sensor.cool" }, { name: "WarmRoom", entity: "sensor.warm" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.ok(data.average.value >= 20 && data.average.value <= 24, "avg itself must be within the 20-24 comfort band");
  assert.equal(data.extremes.warmest.name, "WarmRoom");
  assert.equal(data.extremes.coolest.name, "CoolRoom");
  assert.match(data.subtitle, /CoolRoom/, `subtitle should name the room farther from avg: "${data.subtitle}"`);
  assert.doesNotMatch(data.subtitle, /WarmRoom/, `subtitle must not name the closer room: "${data.subtitle}"`);
  env.cleanup(el);
});

test("mirrored counterexample: warmest farther from avg than coolest -> names the warmest room", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 20.1, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.cool": mkState("sensor.cool", 19.8, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.warm": mkState("sensor.warm", 24.2, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "CoolRoom", entity: "sensor.cool" }, { name: "WarmRoom", entity: "sensor.warm" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.match(data.subtitle, /WarmRoom/, data.subtitle);
  assert.doesNotMatch(data.subtitle, /CoolRoom/, data.subtitle);
  env.cleanup(el);
});

test("regression: exact tie at the extreme value names the same room as the warmest/coolest cards (alphabetically-last on a tie)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.az": mkState("sensor.az", 24.6, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.ku": mkState("sensor.ku", 24.6, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "Arbeitszimmer", entity: "sensor.az" }, { name: "Kueche", entity: "sensor.ku" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.equal(data.extremes.warmest.name, "Kueche", "warmest picks the alphabetically-last name on an exact tie");
  assert.match(data.subtitle, /Kueche/, data.subtitle);
  assert.doesNotMatch(data.subtitle, /Arbeitszimmer/, data.subtitle);
  env.cleanup(el);
});

test("only one side outside comfort: names that side without a distance comparison", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.cool": mkState("sensor.cool", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.warm": mkState("sensor.warm", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "CoolRoom", entity: "sensor.cool" }, { name: "WarmRoom", entity: "sensor.warm" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.match(data.subtitle, /CoolRoom/, "only the cool room is outside the 20-24 comfort band");
  env.cleanup(el);
});

test("avg itself out of comfort: subtitle uses the aboveComfort/belowComfort wording, not the issue-room wording", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 26, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 27, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(data.average.value > 24, "avg must be above the comfort max for this branch");
  assert.match(data.subtitle, /above comfort/i, data.subtitle);
  env.cleanup(el);
});

test("all rooms within comfort: subtitle reports the all-good case, no room named", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.match(data.subtitle, /within target range|all good|all rooms/i, data.subtitle);
  env.cleanup(el);
});

// ------------------------------------------------- the subtitle: option ----

// `title:` sets a NAME and takes a string. The subtitle is different in kind — it is the
// card describing its own state — so its option answers two questions at once: what it
// reads, and what happens when it does not fit. Both spellings of that are tested here,
// including the shorthand where the value IS the overflow mode.

const OK_HASS = () =>
  mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });

function headerOf(subtitle) {
  const el = env.createCard(subtitle === undefined ? { entity: "sensor.avg" } : { entity: "sensor.avg", subtitle }, OK_HASS());
  const result = {
    text: el.shadowRoot.querySelector(".rtc-subtitle")?.textContent ?? null,
    overflow: el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"),
  };
  env.cleanup(el);
  return result;
}

test("a subtitle can be written as text, as an overflow mode, as both, or not at all", () => {
  const automatic = headerOf(undefined).text;
  assert.ok(automatic && automatic.length > 0, "the card writes one by itself");

  assert.deepEqual(headerOf("Ground floor"), { text: "Ground floor", overflow: null });
  // The one ambiguity, and it is deliberate: these two words alone are the mode.
  assert.deepEqual(headerOf("wrap"), { text: automatic, overflow: "wrap" });
  assert.deepEqual(headerOf("clip"), { text: automatic, overflow: null });
  assert.deepEqual(headerOf("  WRAP  "), { text: automatic, overflow: "wrap" }, "trimmed and case-insensitive");
  // ...and it has an escape hatch that needs no guessing.
  assert.deepEqual(headerOf({ text: "wrap" }), { text: "wrap", overflow: null });

  assert.deepEqual(headerOf({ text: "Ground floor", overflow: "wrap" }), { text: "Ground floor", overflow: "wrap" });
  assert.deepEqual(headerOf({ overflow: "wrap" }), { text: automatic, overflow: "wrap" });
});

// "" means "show no line", which is not the same as "not configured" — and no line means
// no NODE, because an empty div keeps its margin and its line box.
test("an empty subtitle removes the line rather than leaving an empty one", () => {
  assert.equal(headerOf("").text, null);
  assert.equal(headerOf({ text: "" }).text, null);
  assert.equal(headerOf("   ").text, null, "whitespace is not a subtitle either");
});

// A malformed value falls back to the default rather than throwing, like every other
// purely cosmetic option.
test("a nonsense subtitle falls back instead of breaking the card", () => {
  const automatic = headerOf(undefined).text;
  for (const nonsense of [5, true, ["a"], { overflow: "sideways" }, { text: 7 }]) {
    assert.deepEqual(headerOf(nonsense), { text: automatic, overflow: null }, JSON.stringify(nonsense));
  }
});

// THE ORDER, and it is not the order `title` uses. When there is nothing to show, the
// reason is the only thing worth saying: a card showing `--` under a cheerful custom line
// would be withholding the one fact its reader needs.
test("a no-data explanation outranks a custom subtitle, and gives way again when data returns", () => {
  const el = env.createCard(
    { entity: "sensor.avg", subtitle: { text: "Ground floor", overflow: "wrap" } },
    mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }) })
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "The value is currently unavailable.");
  // The overflow choice is the user's either way — a long explanation is exactly when
  // wrapping helps most.
  assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"), "wrap");

  el.hass = OK_HASS();
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "Ground floor");
  env.cleanup(el);
});

// Even an explicitly removed subtitle comes back for an explanation: the line was removed
// because it had nothing to say, and now it has.
test("a removed subtitle still reappears to explain a card with no data", () => {
  const el = env.createCard(
    { entity: "sensor.avg", subtitle: "" },
    mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }) })
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "The value is currently unavailable.");
  el.hass = OK_HASS();
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle"), null);
  env.cleanup(el);
});

// A subtitle change arrives through setConfig() with the entity states untouched, so the
// data signature has not moved. setConfig() invalidates it deliberately — without that, a
// purely cosmetic edit would be skipped and the dashboard editor would look broken.
test("editing only the subtitle updates a card that is already on screen", () => {
  const el = env.createCard({ entity: "sensor.avg", subtitle: "First" }, OK_HASS());
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "First");

  el.setConfig({ entity: "sensor.avg", subtitle: { text: "Second", overflow: "wrap" } });
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "Second");
  assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"), "wrap");

  el.setConfig({ entity: "sensor.avg", subtitle: "Third" });
  assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"), null, "and the attribute goes away again");

  el.setConfig({ entity: "sensor.avg", subtitle: "" });
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle"), null, "removing the line removes the node");
  env.cleanup(el);
});
