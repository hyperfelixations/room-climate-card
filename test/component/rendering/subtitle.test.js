"use strict";

// The subtitle line, and the one judgement it makes: "which room stands out most" compares
// |value - avg| (distance to the average), not distance to the comfort-band edge. The two
// agree often, so the wrong rule looks right until every room is inside the band. Also here:
// the text/overflow contract -- "clip"/"wrap" alone set the mode, so those words are
// reserved. Exact ties are covered by the domain-layer tie-break rules.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("comfort 20-24 with avg 23.9 names the room farthest from the average", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23.9, TEMPERATURE_C),
    "sensor.cool": mkState("sensor.cool", 19.8, TEMPERATURE_C),
    "sensor.warm": mkState("sensor.warm", 24.2, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 20.1, TEMPERATURE_C),
    "sensor.cool": mkState("sensor.cool", 19.8, TEMPERATURE_C),
    "sensor.warm": mkState("sensor.warm", 24.2, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.az": mkState("sensor.az", 24.6, TEMPERATURE_C),
    "sensor.ku": mkState("sensor.ku", 24.6, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
    "sensor.cool": mkState("sensor.cool", 19, TEMPERATURE_C),
    "sensor.warm": mkState("sensor.warm", 22, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 26, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 25, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 27, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(data.average.value > 24, "avg must be above the comfort max for this branch");
  assert.match(data.subtitle, /above comfort/i, data.subtitle);
  env.cleanup(el);
});

test("all rooms within comfort: subtitle reports the all-good case, no room named", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.match(data.subtitle, /within target range|all good|all rooms/i, data.subtitle);
  env.cleanup(el);
});

// ------------------------------------------------- the subtitle: option ----

// Unlike `title:` (a name, string only), the subtitle option answers two questions: what it
// reads, and what happens when it does not fit -- including the shorthand where the value is
// the overflow mode.

const OK_HASS = () =>
  mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });

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

// "" means "show no line" (not "not configured"), and no line means no node.
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

// When there is nothing to show, the reason outranks a custom line -- a card showing `--` under a cheerful subtitle withholds the fact its reader needs.
test("a no-data explanation outranks a custom subtitle, and gives way again when data returns", () => {
  const el = env.createCard(
    { entity: "sensor.avg", subtitle: { text: "Ground floor", overflow: "wrap" } },
    mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", TEMPERATURE_C) })
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
    mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", TEMPERATURE_C) })
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "The value is currently unavailable.");
  el.hass = OK_HASS();
  assert.equal(el.shadowRoot.querySelector(".rtc-subtitle"), null);
  env.cleanup(el);
});

// ------------------------------------------------- the subtitle beside a warning ----

// A warning has its own block (rendering/warnings-block.test.js); the line keeps saying what
// it would say without one, in the overflow it was given.
test("a warning leaves every form of subtitle exactly as configured", () => {
  for (const subtitle of [undefined, "Ground floor", "", "wrap", { text: "Ground floor", overflow: "clip" }]) {
    const expected = headerOf(subtitle);
    const el = env.createCard(
      { entity: "sensor.avg", auto_slide: "yes", ...(subtitle === undefined ? {} : { subtitle }) },
      OK_HASS()
    );
    const actual = {
      text: el.shadowRoot.querySelector(".rtc-subtitle")?.textContent ?? null,
      overflow: el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"),
    };
    assert.deepEqual(actual, expected, JSON.stringify(subtitle));
    assert.ok(el.shadowRoot.querySelector(".rtc-warning"), "while the warning is shown in its block");
    env.cleanup(el);
  }
  const hidden = env.createCard({ entity: "sensor.avg", auto_slide: "yes", show: { subtitle: false } }, OK_HASS());
  assert.equal(hidden.shadowRoot.querySelector(".rtc-subtitle"), null, "a switched-off line stays off");
  env.cleanup(hidden);
});

// ------------------------------------------------- a source that is momentarily out ----

// A hint rides on the line the card shows anyway: after its sentence, never in place of it,
// never bringing back a line nobody wants, wrapped so it is read in full, and gone with the
// outage.
const TWO_ROOMS = [{ entity: "sensor.r1", name: "Kitchen" }, { entity: "sensor.r2", name: "Bedroom" }];
const withOutage = (r2 = mkState("sensor.r2", "unavailable", TEMPERATURE_C), extra = {}) =>
  mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C), "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C), "sensor.r2": r2, ...extra });
const lineOf = (el) => el.shadowRoot.querySelector(".rtc-subtitle")?.textContent ?? null;

test("a room that is momentarily out follows the automatic sentence, and leaves with its outage", () => {
  const el = env.createCard({ entity: "sensor.avg", rooms: TWO_ROOMS }, withOutage());
  assert.match(lineOf(el), /\. 1 room is currently unavailable\.$/);
  assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"), "wrap", "the line wraps while the hint is there");
  el.hass = withOutage(mkState("sensor.r2", 23, TEMPERATURE_C));
  assert.doesNotMatch(lineOf(el), /unavailable/);
  assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-subtitle"), null, "and clips again without it");
  env.cleanup(el);
});

test("a hint follows the card's own subtitle after a separator, and several are counted by source", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: TWO_ROOMS, trend_entity: "sensor.trend", subtitle: "Ground floor" },
    withOutage(undefined, { "sensor.trend": mkState("sensor.trend", "unavailable", {}) })
  );
  assert.equal(lineOf(el), "Ground floor · 2 sources are currently unavailable.");
  env.cleanup(el);
});

test("after a full-width stop the hint follows without a space", () => {
  const el = env.createCard({ entity: "sensor.avg", rooms: TWO_ROOMS, language: "ja", subtitle: "一階です。" }, withOutage());
  assert.equal(lineOf(el), "一階です。1 部屋が現在利用できません。");
  env.cleanup(el);
});

test("a hint never brings back a line that was switched off or emptied", () => {
  for (const config of [{ show: { subtitle: false } }, { subtitle: "" }]) {
    const el = env.createCard({ entity: "sensor.avg", rooms: TWO_ROOMS, ...config }, withOutage());
    assert.equal(el.shadowRoot.querySelector(".rtc-subtitle"), null, JSON.stringify(config));
    env.cleanup(el);
  }
});

// A subtitle-only setConfig() does not move the data signature; setConfig() invalidates it deliberately so a cosmetic edit is not skipped.
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
