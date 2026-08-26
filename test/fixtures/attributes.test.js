"use strict";

// The named attribute pairs, held against the manifest they are derived from.
//
// Their whole value is that they cannot drift from the product: a metric whose canonical unit
// changed has to break here, in one place, rather than leave several hundred fixtures quietly
// describing a sensor Home Assistant no longer produces.
//
// So this file checks two directions. Every constant still says what the manifest says, and
// the manifest has not grown a metric or a unit that nothing here covers — the second is the
// one that rots silently, because a missing constant looks exactly like a constant nobody
// needed.

const test = require("node:test");
const assert = require("node:assert/strict");

const A = require("./attributes.js");
const { METRICS, METRIC_KINDS } = require("../contracts/product-surface.js");

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
  // A unit the card does not know is still buildable, because a test that needs a WRONG
  // sensor needs to say so on the line it is written on rather than reach for a name.
  assert.deepEqual({ ...A.attributesFor("temperature", "hPa") }, {
    device_class: "temperature",
    unit_of_measurement: "hPa",
  });
});

test("a deliberately mismatched fixture is not given a name", () => {
  // The rule this file exists to keep. `temperature` reported in hectopascals is the subject
  // of several tests, and every one of them is about the mismatch — a constant called
  // TEMPERATURE_HPA would hide the very thing the reader has to see.
  const named = Object.entries(A.ALL).filter(([, attributes]) => {
    if (!("unit_of_measurement" in attributes)) return false;
    const metric = METRIC_KINDS.find((kind) => METRICS[kind].deviceClass === attributes.device_class);
    const allowed = [METRICS[metric].canonicalUnit, "°F", "K"];
    return !allowed.includes(attributes.unit_of_measurement);
  });
  assert.deepEqual(named, [], "a mismatched pair was given a name; write it inline with the reason instead");
});
