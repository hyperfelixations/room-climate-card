"use strict";

// DATA-01 (v2.15.0 audit): the subtitle's "which room stands out most" logic
// must compare |value-avg| (distance to the average), not distance to the
// comfort-band edge — the 2.15.0 regression compared to the edge instead,
// picking the wrong room whenever the two distances disagree. Covers the
// audit's exact counterexample plus the earlier (already-fixed) exact-tie
// regression from a prior round.

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

test("audit counterexample: comfort 20-24, avg 23.9, coolest 19.8 (4.1 from avg), warmest 24.2 (0.3 from avg) -> names the coolest room", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23.9, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.cool": mkState("sensor.cool", 19.8, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.warm": mkState("sensor.warm", 24.2, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "CoolRoom", entity: "sensor.cool" }, { name: "WarmRoom", entity: "sensor.warm" }] },
    hass
  );
  const data = el._computeData();
  assert.ok(data.avg >= 20 && data.avg <= 24, "avg itself must be within the 20-24 comfort band");
  assert.equal(data.warmest.name, "WarmRoom");
  assert.equal(data.coolest.name, "CoolRoom");
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
  const data = el._computeData();
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
  const data = el._computeData();
  assert.equal(data.warmest.name, "Kueche", "warmest picks the alphabetically-last name on an exact tie");
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
  const data = el._computeData();
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
  const data = el._computeData();
  assert.ok(data.avg > 24, "avg must be above the comfort max for this branch");
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
  const data = el._computeData();
  assert.match(data.subtitle, /within target range|all good|all rooms/i, data.subtitle);
  env.cleanup(el);
});
