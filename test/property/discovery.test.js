"use strict";

// The installation generator behind the browse-path property run, tested: the realised
// population is measured against DISCOVERY_WEIGHTS, and every axis and distractor is checked
// to actually occur. Its boundary: this file measures what is generated; the invariants that
// population is thrown at live in discovery.js and run in discovery.property.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SeededRandom } = require("../helpers/seeded-random.js");
const { METRICS, METRIC_KINDS } = require("../manifests/product-surface.js");
const { DISCOVERY_WEIGHTS, DISTRACTORS, generateInstallation } = require("./discovery.js");
const V = require("./vocabulary.js");

const SAMPLE = 3000;

const population = (() => {
  const rng = new SeededRandom(0x5eed_d15c);
  return Array.from({ length: SAMPLE }, () => generateInstallation(rng.int(0, 0x7fffffff)));
})();

const isDistractor = (sensor) => sensor.id.includes(".distractor_");
const climateSensors = population.flatMap((description) => description.sensors.filter((sensor) => !isDistractor(sensor)));
const kindOf = (sensor) => METRIC_KINDS.find((kind) => sensor.id.includes(`_${kind}_`));

function weightShare(table, label) {
  const total = table.reduce((sum, [weight]) => sum + weight, 0);
  return table.find(([, entry]) => entry === label)[0] / total;
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual.toFixed(3)}, expected ${expected.toFixed(3)} ± ${tolerance}`);
}

test("every declared weight table is well formed and actually drawn from", () => {
  const source = fs.readFileSync(path.join(__dirname, "discovery.js"), "utf8");
  for (const [axis, table] of Object.entries(DISCOVERY_WEIGHTS)) {
    assert.ok(table.length >= 2, `${axis}: needs at least two outcomes`);
    assert.equal(new Set(table.map(([, label]) => label)).size, table.length, `${axis}: repeats an outcome`);
    assert.ok(source.includes(`DISCOVERY_WEIGHTS.${axis}`), `DISCOVERY_WEIGHTS.${axis} is declared and never drawn from`);
  }
});

test("the same seed always describes the same installation", () => {
  assert.deepEqual(generateInstallation(42), generateInstallation(42));
  assert.notDeepEqual(generateInstallation(42), generateInstallation(43));
});

test("areas, devices and distractors per installation follow their weights", () => {
  for (const [, label] of DISCOVERY_WEIGHTS.areaCount) {
    const share = population.filter((description) => description.areas.length === Number(label)).length / SAMPLE;
    assertNear(share, weightShare(DISCOVERY_WEIGHTS.areaCount, label), 0.03, `${label} areas`);
  }
  for (const [, label] of DISCOVERY_WEIGHTS.deviceCount) {
    const share = population.filter((description) => Object.keys(description.devices).filter((id) => id !== "device_child").length === Number(label)).length / SAMPLE;
    assertNear(share, weightShare(DISCOVERY_WEIGHTS.deviceCount, label), 0.03, `${label} devices`);
  }
  for (const [, label] of DISCOVERY_WEIGHTS.distractors) {
    const share = population.filter((description) => description.sensors.filter(isDistractor).length === Number(label)).length / SAMPLE;
    assertNear(share, weightShare(DISCOVERY_WEIGHTS.distractors, label), 0.03, `${label} distractors`);
  }
});

test("every measurement reaches every count from zero to five, and some installations have none at all", () => {
  const without = weightShare(DISCOVERY_WEIGHTS.installation, "withoutClimateSensors");
  for (const kind of METRIC_KINDS) {
    for (const [, label] of DISCOVERY_WEIGHTS.sensorsPerKind) {
      const share = population.filter((description) => description.sensors.filter((sensor) => !isDistractor(sensor) && kindOf(sensor) === kind).length === Number(label)).length / SAMPLE;
      const expected = (1 - without) * weightShare(DISCOVERY_WEIGHTS.sensorsPerKind, label) + (label === "0" ? without : 0);
      assertNear(share, expected, 0.03, `${kind}: ${label} sensors`);
    }
  }
  const empty = population.filter((description) => description.sensors.every(isDistractor)).length / SAMPLE;
  assert.ok(empty >= without - 0.02, `installations without a climate sensor: ${empty}`);
});

test("sensors are declared, placed, named and registered in the declared proportions", () => {
  const share = (predicate) => climateSensors.filter(predicate).length / climateSensors.length;
  const canonicalOf = (sensor) => METRICS[kindOf(sensor)].deviceClass;
  assertNear(share((sensor) => sensor.attributes.device_class === canonicalOf(sensor)), weightShare(DISCOVERY_WEIGHTS.deviceClass, "correct"), 0.02, "correct device class");
  assertNear(share((sensor) => !("device_class" in sensor.attributes)), weightShare(DISCOVERY_WEIGHTS.deviceClass, "missing"), 0.015, "missing device class");
  assertNear(share((sensor) => V.FOREIGN_DEVICE_CLASSES.includes(sensor.attributes.device_class)), weightShare(DISCOVERY_WEIGHTS.deviceClass, "foreign"), 0.015, "foreign device class");
  assertNear(share((sensor) => sensor.registry === null), weightShare(DISCOVERY_WEIGHTS.registry, "none"), 0.015, "no registry entry");
  assertNear(share((sensor) => sensor.registry?.hidden === true), weightShare(DISCOVERY_WEIGHTS.registry, "hidden"), 0.015, "hidden");
  assertNear(share((sensor) => sensor.registry?.entity_category === "diagnostic"), weightShare(DISCOVERY_WEIGHTS.registry, "diagnostic"), 0.015, "diagnostic");
  assertNear(share((sensor) => sensor.id.startsWith("number.")), weightShare(DISCOVERY_WEIGHTS.domain, "number"), 0.015, "number domain");
  assertNear(share((sensor) => sensor.state === "unavailable"), weightShare(DISCOVERY_WEIGHTS.state, "unavailable"), 0.015, "unavailable");
  assertNear(share((sensor) => sensor.name === undefined), weightShare(DISCOVERY_WEIGHTS.friendlyName, "missing"), 0.015, "nameless");
});

test("every way of placing a sensor, and every distractor, actually occurs", () => {
  const placements = {
    "own area": (sensor) => sensor.registry?.area_id?.startsWith("area_") && !sensor.registry.device_id,
    "device area": (sensor) => sensor.registry?.device_id && sensor.registry.device_id !== "device_child" && !sensor.registry.area_id,
    "parent device": (sensor) => sensor.registry?.device_id === "device_child",
    "deleted area": (sensor) => sensor.registry?.area_id === "area_deleted",
    "own area over device": (sensor) => sensor.registry?.area_id && sensor.registry.device_id,
    "no area": (sensor) => sensor.registry && !sensor.registry.area_id && !sensor.registry.device_id,
  };
  for (const [label, predicate] of Object.entries(placements)) {
    assert.ok(climateSensors.some(predicate), `${label} never occurs`);
  }
  const distractorIds = population.flatMap((description) => description.sensors.filter(isDistractor).map((sensor) => sensor.id));
  for (const [label] of DISTRACTORS) {
    assert.ok(distractorIds.some((id) => id.includes(`.distractor_${label}_`)), `distractor ${label} never occurs`);
  }
  const areaNames = population.flatMap((description) => description.areas.map(([, name]) => name));
  assert.ok(areaNames.some((name) => !name.trim()), "no blank area name");
  assert.ok(areaNames.some((name) => V.AWKWARD_TEXT.includes(name) && name.trim()), "no awkward area name");
  assert.ok(population.some((description) => new Set(description.areas.map(([, name]) => name)).size < description.areas.length), "no duplicate area name");
});
