"use strict";

// The named attribute pairs, held against the manifest they are derived from. Their value
// is that they cannot drift from the product: a metric whose canonical unit changed must
// break here, not in several hundred fixtures. Checked both directions — every constant
// still says what the manifest says, and the manifest has not grown a metric or unit
// nothing here covers (the direction that rots, since a missing constant looks like one
// nobody needed).

const test = require("node:test");
const assert = require("node:assert/strict");

const A = require("./attributes.js");
const { METRICS, METRIC_KINDS } = require("../manifests/product-surface.js");

test("every named pair says what the manifest says", () => {
  for (const [name, attributes] of Object.entries(A.ALL)) {
    assert.equal(typeof attributes.device_class, "string", `${name}: device_class`);
    const metric = METRIC_KINDS.find((kind) => METRICS[kind].deviceClass === attributes.device_class);
    assert.ok(metric, `${name}: "${attributes.device_class}" is not a device class the card handles`);
    if ("unit_of_measurement" in attributes) {
      assert.equal(typeof attributes.unit_of_measurement, "string", `${name}: unit`);
    }
    assert.ok(Object.isFrozen(attributes), `${name}: a shared fixture must not be mutable`);
  }
});

test("every metric the card handles has a named pair, in its canonical unit and without one", () => {
  // The direction that rots. A fifth metric added to the manifest would otherwise leave this
  // file complete-looking and silently one short.
  const canonical = new Set(
    Object.values(A.ALL)
      .filter((attributes) => "unit_of_measurement" in attributes)
      .map((attributes) => `${attributes.device_class}|${attributes.unit_of_measurement}`)
  );
  const classOnly = new Set(
    Object.values(A.ALL)
      .filter((attributes) => !("unit_of_measurement" in attributes))
      .map((attributes) => attributes.device_class)
  );
  for (const metric of METRIC_KINDS) {
    const { deviceClass, canonicalUnit } = METRICS[metric];
    assert.ok(canonical.has(`${deviceClass}|${canonicalUnit}`), `no named pair for ${metric} in ${canonicalUnit}`);
    assert.ok(classOnly.has(deviceClass), `no class-only pair for ${metric}`);
  }
});

test("only temperature has a second unit, and both of its others are named", () => {
  // Asserted rather than assumed: a metric that gained a unit profile would need a constant
  // here, and nothing else in the suite would say so.
  const withAlternatives = METRIC_KINDS.filter((metric) => METRICS[metric].unitProfiles.length > 1);
  assert.deepEqual(withAlternatives, ["temperature"]);
  assert.equal(A.TEMPERATURE_F.unit_of_measurement, "°F");
  assert.equal(A.TEMPERATURE_K.unit_of_measurement, "K");
  assert.equal(METRICS.temperature.unitProfiles.length, 3, "celsius, fahrenheit, kelvin — one constant each");
});

test("attributesFor() and classOnly() build the same thing the constants are", () => {
  assert.deepEqual({ ...A.attributesFor("temperature") }, { ...A.TEMPERATURE_C });
  assert.deepEqual({ ...A.attributesFor("temperature", "°F") }, { ...A.TEMPERATURE_F });
  assert.deepEqual({ ...A.classOnly("co2") }, { ...A.CO2_CLASS_ONLY });
  // A unit the card does not know is still buildable — a wrong-sensor test says so on its own line.
  assert.deepEqual({ ...A.attributesFor("temperature", "hPa") }, {
    device_class: "temperature",
    unit_of_measurement: "hPa",
  });
});

test("a deliberately mismatched fixture is not given a name", () => {
  // `temperature` in hectopascals is the subject of several tests; a TEMPERATURE_HPA constant would hide the mismatch.
  const named = Object.entries(A.ALL).filter(([, attributes]) => {
    if (!("unit_of_measurement" in attributes)) return false;
    const metric = METRIC_KINDS.find((kind) => METRICS[kind].deviceClass === attributes.device_class);
    const allowed = [METRICS[metric].canonicalUnit, "°F", "K"];
    return !allowed.includes(attributes.unit_of_measurement);
  });
  assert.deepEqual(named, [], "a mismatched pair was given a name; write it inline with the reason instead");
});
