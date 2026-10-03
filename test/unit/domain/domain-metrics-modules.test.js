"use strict";

// Direct unit tests for src/domain/metrics/* and src/domain/units/*: which metric kind an
// entity reports, which unit it is in, and how to move a value between units without ever
// mixing an absolute reading with a difference. A mistake here produces a plausible number
// wrong by 32, or classifies humidity against temperature tiers. See internal dev doc §5
// "Unit-, Range-, Trend- und Scale-System".

const test = require("node:test");
const assert = require("node:assert/strict");

let definitions;
let resolution;
let homeAssistant;
let conversion;
let unitToken;

const METRIC_KINDS = ["temperature", "humidity", "co2", "pm25"];

test.before(async () => {
  definitions = await import("../../../src/domain/metrics/definitions.js");
  resolution = await import("../../../src/domain/metrics/resolution.js");
  homeAssistant = await import("../../../src/domain/metrics/home-assistant.js");
  conversion = await import("../../../src/domain/units/conversion.js");
  unitToken = await import("../../../src/domain/units/unit-token.js");
});

// ------------------------------------------------------------- definitions --

test("exactly the four supported metric kinds are registered", () => {
  assert.deepEqual(Object.keys(definitions.METRIC_DEFINITIONS).sort(), [...METRIC_KINDS].sort());
});

test("the kinds keep one order, the one they are registered in", () => {
  assert.deepEqual([...definitions.METRIC_KIND_ORDER], ["temperature", "humidity", "co2", "pm25"]);
  assert.deepEqual(Object.keys(definitions.METRIC_DEFINITIONS), [...definitions.METRIC_KIND_ORDER]);
  assert.ok(Object.isFrozen(definitions.METRIC_KIND_ORDER));
});

// References, not copies: a profile edited in classification/ is what the kind classifies by.
test("each kind's canonical tiers and bands are its default built-in profile's own", async () => {
  const { CLASSIFICATION_PROFILE_REGISTRY } = await import("../../../src/domain/classification/registry.js");
  for (const [kind, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    const registry = CLASSIFICATION_PROFILE_REGISTRY[kind];
    const profile = registry.profiles[registry.defaultProfile];
    assert.equal(definition.canonicalClassificationTiers, profile.tiers, `${kind}: tiers`);
    assert.equal(definition.canonicalComfortBand, profile.comfort, `${kind}: comfort`);
    assert.equal(definition.canonicalOptimalBand, profile.optimal, `${kind}: optimal`);
    assert.equal(definition.canonicalBaseScaleBand, profile.scale, `${kind}: scale`);
  }
});

test("every metric definition is internally consistent", () => {
  for (const [key, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    assert.equal(definition.metricKind, key, `${key}: metricKind must match its registry key`);
    assert.equal(typeof definition.canonicalUnit, "string", `${key}: canonicalUnit`);
    assert.ok(definition.canonicalUnit.length > 0, `${key}: canonicalUnit must not be empty`);
    assert.ok(
      definition.unitProfiles[definition.canonicalProfileKey],
      `${key}: canonicalProfileKey "${definition.canonicalProfileKey}" must name a registered unitProfile`
    );
    assert.equal(
      definition.unitProfiles[definition.canonicalProfileKey].displayUnit,
      definition.canonicalUnit,
      `${key}: the canonical profile's displayUnit must equal canonicalUnit`
    );
    for (const band of ["canonicalComfortBand", "canonicalOptimalBand", "canonicalBaseScaleBand"]) {
      assert.equal(typeof definition[band]?.min, "number", `${key}.${band}.min`);
      assert.equal(typeof definition[band]?.max, "number", `${key}.${band}.max`);
    }
    assert.ok(Array.isArray(definition.canonicalClassificationTiers), `${key}: canonicalClassificationTiers`);
    assert.ok(definition.canonicalClassificationTiers.length > 0, `${key}: tiers must not be empty`);
  }
});

test("the canonical units are the documented ones", () => {
  assert.equal(definitions.METRIC_DEFINITIONS.temperature.canonicalUnit, "°C");
  assert.equal(definitions.METRIC_DEFINITIONS.humidity.canonicalUnit, "%");
  assert.equal(definitions.METRIC_DEFINITIONS.co2.canonicalUnit, "ppm");
  assert.equal(definitions.METRIC_DEFINITIONS.pm25.canonicalUnit, "µg/m³");
});

test("every unit profile implements the full conversion contract", () => {
  for (const [kind, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    for (const [key, profile] of Object.entries(definition.unitProfiles)) {
      assert.equal(profile.key, key, `${kind}/${key}: key must match its registry key`);
      assert.ok(Array.isArray(profile.units) && profile.units.length > 0, `${kind}/${key}: units`);
      assert.equal(typeof profile.displayUnit, "string", `${kind}/${key}: displayUnit`);
      for (const fn of ["toCanonical", "fromCanonical", "deltaToCanonical", "deltaFromCanonical"]) {
        assert.equal(typeof profile[fn], "function", `${kind}/${key}: ${fn}`);
      }
      assert.equal(typeof profile.baseDisplayStep, "number", `${kind}/${key}: baseDisplayStep`);
      assert.ok(profile.baseDisplayStep > 0, `${kind}/${key}: baseDisplayStep must be positive`);
    }
  }
});

test("temperature registers exactly celsius, fahrenheit and kelvin", () => {
  assert.deepEqual(Object.keys(definitions.METRIC_DEFINITIONS.temperature.unitProfiles), [
    "celsius",
    "fahrenheit",
    "kelvin",
  ]);
  assert.equal(definitions.METRIC_DEFINITIONS.temperature.canonicalProfileKey, "celsius");
});

test("humidity, co2 and pm25 each register one identity unit profile", () => {
  for (const kind of ["humidity", "co2", "pm25"]) {
    const definition = definitions.METRIC_DEFINITIONS[kind];
    const keys = Object.keys(definition.unitProfiles);
    assert.equal(keys.length, 1, `${kind}: exactly one profile`);
    assert.equal(keys[0], definition.canonicalProfileKey, `${kind}: that profile is the canonical one`);
    const profile = definition.unitProfiles[keys[0]];
    for (const value of [0, 1, -5, 42.5, 1013]) {
      assert.equal(profile.toCanonical(value), value, `${kind}: toCanonical is identity`);
      assert.equal(profile.fromCanonical(value), value, `${kind}: fromCanonical is identity`);
      assert.equal(profile.deltaToCanonical(value), value, `${kind}: deltaToCanonical is identity`);
      assert.equal(profile.deltaFromCanonical(value), value, `${kind}: deltaFromCanonical is identity`);
    }
  }
});

// ------------------------------------------------------------ conversion ----

function tempProfile(key) {
  return definitions.METRIC_DEFINITIONS.temperature.unitProfiles[key];
}

test("absolute temperature conversion applies the Fahrenheit offset", () => {
  const c = tempProfile("celsius");
  const f = tempProfile("fahrenheit");
  for (const [celsius, fahrenheit] of [[0, 32], [100, 212], [-40, -40], [37, 98.6], [21, 69.8]]) {
    assert.ok(
      Math.abs(conversion.convertUnitValue(celsius, "absolute", c, f) - fahrenheit) < 1e-9,
      `${celsius} °C -> ${fahrenheit} °F`
    );
    assert.ok(
      Math.abs(conversion.convertUnitValue(fahrenheit, "absolute", f, c) - celsius) < 1e-9,
      `${fahrenheit} °F -> ${celsius} °C`
    );
  }
});

test("delta and rate temperature conversion never apply the offset", () => {
  const c = tempProfile("celsius");
  const f = tempProfile("fahrenheit");
  // A 0 °C difference is a 0 °F difference, not 32 °F.
  assert.equal(conversion.convertUnitValue(0, "delta", c, f), 0);
  assert.equal(conversion.convertUnitValue(0, "rate", c, f), 0);
  for (const [deltaC, deltaF] of [[1, 1.8], [5, 9], [-2.5, -4.5]]) {
    assert.ok(Math.abs(conversion.convertUnitValue(deltaC, "delta", c, f) - deltaF) < 1e-9, `${deltaC} -> ${deltaF}`);
    assert.ok(Math.abs(conversion.convertUnitValue(deltaC, "rate", c, f) - deltaF) < 1e-9, `rate ${deltaC}`);
  }
});

test("delta and rate share one conversion path", () => {
  const c = tempProfile("celsius");
  const f = tempProfile("fahrenheit");
  for (const value of [0, 0.1, 1, -3.7, 25]) {
    assert.equal(
      conversion.convertUnitValue(value, "delta", c, f),
      conversion.convertUnitValue(value, "rate", c, f),
      `value ${value}`
    );
  }
});

test("Kelvin differs from Celsius by a pure offset, so deltas are identical", () => {
  const c = tempProfile("celsius");
  const k = tempProfile("kelvin");
  assert.ok(Math.abs(conversion.convertUnitValue(0, "absolute", c, k) - 273.15) < 1e-9);
  assert.ok(Math.abs(conversion.convertUnitValue(273.15, "absolute", k, c) - 0) < 1e-9);
  assert.ok(Math.abs(conversion.convertUnitValue(21, "absolute", c, k) - 294.15) < 1e-9);
  for (const delta of [0, 1, -5, 12.5]) {
    assert.equal(conversion.convertUnitValue(delta, "delta", c, k), delta, `delta ${delta}`);
    assert.equal(conversion.convertUnitValue(delta, "delta", k, c), delta, `delta back ${delta}`);
  }
});

test("a round trip through any temperature profile returns the original value", () => {
  const keys = ["celsius", "fahrenheit", "kelvin"];
  for (const from of keys) {
    for (const to of keys) {
      for (const value of [-40, 0, 21.5, 100]) {
        const there = conversion.convertUnitValue(value, "absolute", tempProfile(from), tempProfile(to));
        const back = conversion.convertUnitValue(there, "absolute", tempProfile(to), tempProfile(from));
        assert.ok(Math.abs(back - value) < 1e-9, `${value} ${from} -> ${to} -> ${from} gave ${back}`);
      }
    }
  }
});

test("an unknown quantityKind throws instead of guessing a conversion path", () => {
  const c = tempProfile("celsius");
  const f = tempProfile("fahrenheit");
  for (const bogus of ["Absolute", "difference", "", null, undefined]) {
    assert.throws(
      () => conversion.convertUnitValue(1, bogus, c, f),
      /unknown quantityKind/,
      JSON.stringify(bogus)
    );
  }
});

test("non-finite values pass through conversion without becoming NaN-by-accident", () => {
  const c = tempProfile("celsius");
  const f = tempProfile("fahrenheit");
  assert.equal(conversion.convertUnitValue(Infinity, "absolute", c, f), Infinity);
  assert.equal(conversion.convertUnitValue(-Infinity, "absolute", c, f), -Infinity);
  assert.ok(Number.isNaN(conversion.convertUnitValue(NaN, "absolute", c, f)));
});

// ------------------------------------------------- threshold derivation ----

test("Fahrenheit classification thresholds are always whole numbers", () => {
  // A displayed boundary and the boundary used for classification must never disagree.
  const derived = conversion.deriveThresholdsForProfile(
    definitions.METRIC_DEFINITIONS.temperature.canonicalClassificationTiers,
    tempProfile("fahrenheit")
  );
  for (const tier of derived) {
    if (!Number.isFinite(tier.min)) continue;
    assert.equal(Number.isInteger(tier.min), true, `tier min ${tier.min} must be a whole °F value`);
  }
});

test("threshold derivation preserves tier metadata, order and infinite bounds", () => {
  const canonical = definitions.METRIC_DEFINITIONS.temperature.canonicalClassificationTiers;
  const derived = conversion.deriveThresholdsForProfile(canonical, tempProfile("fahrenheit"));
  assert.equal(derived.length, canonical.length);
  derived.forEach((tier, i) => {
    assert.equal(tier.levelKey, canonical[i].levelKey, `tier ${i} levelKey`);
    assert.equal(tier.color, canonical[i].color, `tier ${i} color`);
    assert.equal(tier.score, canonical[i].score, `tier ${i} score`);
    assert.equal(tier.zone, canonical[i].zone, `tier ${i} zone`);
  });
  assert.equal(derived[derived.length - 1].min, -Infinity, "the default tier keeps its -Infinity bound");
  for (let i = 1; i < derived.length; i++) {
    assert.ok(derived[i].min < derived[i - 1].min, `derived tiers stay strictly descending at index ${i}`);
  }
});

test("threshold derivation into the canonical profile is the identity", () => {
  const canonical = definitions.METRIC_DEFINITIONS.temperature.canonicalClassificationTiers;
  const derived = conversion.deriveThresholdsForProfile(canonical, tempProfile("celsius"));
  assert.deepEqual(derived.map((t) => t.min), canonical.map((t) => t.min));
});

test("band derivation converts both edges and rounds like the tiers", () => {
  const band = { min: 20, max: 24 };
  assert.deepEqual(conversion.deriveBandForProfile(band, tempProfile("celsius")), { min: 20, max: 24 });
  assert.deepEqual(conversion.deriveBandForProfile(band, tempProfile("fahrenheit")), { min: 68, max: 75 });
  // 20 °C = 68.0 °F exactly, 24 °C = 75.2 °F -> rounded to 75.
  const kelvin = conversion.deriveBandForProfile(band, tempProfile("kelvin"));
  assert.ok(Math.abs(kelvin.min - 293.15) < 1e-9);
  assert.ok(Math.abs(kelvin.max - 297.15) < 1e-9);
});

test("Fahrenheit declares dynamic display steps; Celsius and Kelvin do not", () => {
  assert.deepEqual(tempProfile("fahrenheit").dynamicDisplaySteps, [
    { maxSpan: 20, step: 2 },
    { maxSpan: 40, step: 5 },
    { maxSpan: Infinity, step: 10 },
  ]);
  assert.equal(tempProfile("celsius").dynamicDisplaySteps, undefined);
  assert.equal(tempProfile("kelvin").dynamicDisplaySteps, undefined);
  assert.equal(tempProfile("celsius").thresholdRounding, undefined, "identity derivation needs no rounding");
  assert.equal(typeof tempProfile("fahrenheit").thresholdRounding, "function");
});

// -------------------------------------------------------------- resolution --

test("each card kind is reached through its own device class, derived from its definition", () => {
  assert.deepEqual(resolution.METRIC_TYPE_BY_DEVICE_CLASS, {
    temperature: "temperature",
    humidity: "humidity",
    carbon_dioxide: "co2",
    pm25: "pm25",
  });
  assert.ok(Object.isFrozen(resolution.METRIC_TYPE_BY_DEVICE_CLASS));
  for (const [kind, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    assert.equal(resolution.METRIC_TYPE_BY_DEVICE_CLASS[definition.deviceClass], kind, kind);
  }
});

test("the unit index lists every registered alias under the kinds registering it, and nothing else", () => {
  const expected = {};
  for (const [kind, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    for (const profile of Object.values(definition.unitProfiles)) {
      for (const unit of profile.units) expected[unitToken.normalizeUnitToken(unit)] = [kind];
    }
  }
  assert.deepEqual(resolution.METRIC_KINDS_BY_UNIT, expected);
  assert.deepEqual(resolution.METRIC_KINDS_BY_UNIT.c, ["temperature"], "the word and letter aliases are in it");
  assert.ok(Object.isFrozen(resolution.METRIC_KINDS_BY_UNIT));
  for (const kinds of Object.values(resolution.METRIC_KINDS_BY_UNIT)) assert.ok(Object.isFrozen(kinds));
});

// Inverted by unit token, so µ/μ and ³/3 spellings meet in one entry.
test("Home Assistant's unit table is inverted by unit token, every reporting class kept", () => {
  assert.deepEqual(resolution.DEVICE_CLASSES_BY_UNIT, {
    "°c": ["temperature"],
    "°f": ["temperature"],
    k: ["temperature"],
    "%": ["humidity"],
    ppm: ["carbon_dioxide", "carbon_monoxide", "nitrogen_dioxide", "ozone", "volatile_organic_compounds_parts"],
    "ug/m3": [
      "pm1", "pm25", "pm4", "pm10", "carbon_monoxide", "nitrogen_dioxide", "ozone", "nitrogen_monoxide",
      "sulphur_dioxide", "nitrous_oxide", "volatile_organic_compounds",
    ],
    ppb: ["carbon_monoxide", "nitrogen_dioxide", "ozone", "nitrogen_monoxide", "sulphur_dioxide", "volatile_organic_compounds_parts"],
    "mg/m3": ["carbon_monoxide", "volatile_organic_compounds", "absolute_humidity"],
    "g/m3": ["absolute_humidity"],
    "bq/m3": ["radon"],
    "pci/l": ["radon"],
  });
  assert.ok(!resolution.DEVICE_CLASSES_BY_UNIT["ug/m3"].includes("absolute_humidity"), "absolute humidity is g/m³ or mg/m³");
  assert.ok(Object.isFrozen(resolution.DEVICE_CLASSES_BY_UNIT));
  for (const deviceClasses of Object.values(resolution.DEVICE_CLASSES_BY_UNIT)) assert.ok(Object.isFrozen(deviceClasses));
});

test("a registered unit names the one kind registering it", () => {
  assert.equal(resolution.metricKindOfUnit("ppm"), "co2", "a profile written in ppm is a CO2 profile");
  assert.equal(resolution.metricKindOfUnit(" °F "), "temperature");
  assert.equal(resolution.metricKindOfUnit("ug/m3"), "pm25");
  assert.equal(resolution.metricKindOfUnit("hPa"), null);
  for (const nothing of [undefined, null, "", 5]) {
    assert.equal(resolution.metricKindOfUnit(nothing), null, JSON.stringify(nothing));
  }
});

// -------------------------------------------- how a sensor's measurement is identified --

const identity = (metricKind, basis, unknownDeviceClass = false) => ({ metricKind, basis, unknownDeviceClass });

test("the ways a measurement can be identified are a closed vocabulary", () => {
  assert.deepEqual(resolution.MEASUREMENT_BASIS, {
    DEVICE_CLASS: "device_class",
    FOREIGN: "foreign",
    UNIT: "unit",
    UNIT_AMBIGUOUS: "unit_ambiguous",
    UNIT_UNKNOWN: "unit_unknown",
    NOTHING: "nothing",
  });
  assert.ok(Object.isFrozen(resolution.MEASUREMENT_BASIS));
});

// The card asks for device_class first; the unit is a fallback for template sensors that
// never got one, and it applies only where the unit belongs to one measurement — a wrong
// guess shows a real number against the wrong scale and colour.
test("a declared class decides; a unit decides only without one, and only when one measurement uses it", () => {
  const cases = [
    [["temperature", undefined], identity("temperature", "device_class")],
    [[" Carbon_Dioxide ", "ppm"], identity("co2", "device_class")],
    [["humidity", "°C"], identity("humidity", "device_class")],
    [["battery", "%"], identity(null, "foreign")],
    [[undefined, "°C"], identity("temperature", "unit")],
    [[null, " celsius "], identity("temperature", "unit")],
    [[undefined, "%"], identity("humidity", "unit")],
    [["temperatur", "°F"], identity("temperature", "unit", true)],
    // Home Assistant defines five sensor classes reporting ppm and eleven reporting µg/m³.
    [[undefined, "ppm"], identity(null, "unit_ambiguous")],
    [[undefined, "μg/m³"], identity(null, "unit_ambiguous")],
    [["co2", "ppm"], identity(null, "unit_ambiguous", true)],
    [[undefined, "lx"], identity(null, "unit_unknown")],
    // ppb is several classes' unit, but none of the card's, so it identifies nothing either way.
    [["co2", "ppb"], identity(null, "unit_unknown", true)],
    [[undefined, undefined], identity(null, "nothing")],
    [["   ", "   "], identity(null, "nothing")],
    [[5, 7], identity(null, "nothing")],
    [["pm2.5", null], identity(null, "nothing", true)],
  ];
  for (const [[deviceClass, unit], expected] of cases) {
    const actual = resolution.identifyMeasurement(deviceClass, unit);
    assert.deepEqual(actual, expected, JSON.stringify([deviceClass, unit]));
    assert.ok(Object.isFrozen(actual));
  }
});

test("unit and device class lookups never answer from the prototype chain", () => {
  for (const raw of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.deepEqual(resolution.identifyMeasurement(raw, raw), identity(null, "unit_unknown", true), raw);
    assert.equal(resolution.metricKindOfUnit(raw), null, `profile unit ${raw}`);
    assert.equal(resolution.resolveUnitProfileKey(raw, "°C"), null, `metric kind ${raw}`);
  }
});

// A kind that does not exist yet, assembled from the same parts, so the rules for a shared unit
// are pinned before a second kind in µg/m³ arrives.
test("units two kinds share decide nothing, while a unit one Home Assistant class reports does", () => {
  const ha = {
    haDeviceClasses: ["pm1", "pm25", "radon", "ozone"],
    haDeviceClassUnits: { pm1: ["μg/m³"], pm25: ["μg/m³"], radon: ["Bq/m³", "pCi/L"], ozone: ["ppm"] },
  };
  const kind = (metricKind, deviceClass, units) => ({ metricKind, deviceClass, unitProfiles: { only: { key: "only", units } } });
  const resolved = resolution.createMetricResolution({
    ...ha,
    definitions: {
      pm25: kind("pm25", "pm25", ["µg/m³"]),
      pm1: kind("pm1", "pm1", ["µg/m³", "shared"]),
      radon: kind("radon", "radon", ["Bq/m³", "shared"]),
      loudness: kind("loudness", "sound_pressure", ["dB"]),
      ozone: kind("ozone", "ozone", ["ppb"]),
    },
  });
  assert.deepEqual(resolved.METRIC_KINDS_BY_UNIT, { "ug/m3": ["pm25", "pm1"], shared: ["pm1", "radon"], "bq/m3": ["radon"], db: ["loudness"], ppb: ["ozone"] });
  assert.deepEqual(resolved.DEVICE_CLASSES_BY_UNIT, { "ug/m3": ["pm1", "pm25"], "bq/m3": ["radon"], "pci/l": ["radon"], ppm: ["ozone"] });
  assert.deepEqual(resolved.METRIC_TYPE_BY_DEVICE_CLASS, { pm25: "pm25", pm1: "pm1", radon: "radon", sound_pressure: "loudness", ozone: "ozone" });
  assert.equal(resolved.metricKindOfUnit("µg/m³"), null, "a profile in µg/m³ could be either");
  assert.equal(resolved.metricKindOfUnit("Bq/m³"), "radon");
  assert.deepEqual(resolved.identifyMeasurement(undefined, "µg/m³"), identity(null, "unit_ambiguous"));
  assert.deepEqual(resolved.identifyMeasurement(undefined, "shared"), identity(null, "unit_ambiguous"), "two kinds, no Home Assistant class");
  assert.deepEqual(resolved.identifyMeasurement(undefined, "Bq/m³"), identity("radon", "unit"));
  assert.deepEqual(resolved.identifyMeasurement("PM1", "ppm"), identity("pm1", "device_class"));
  assert.deepEqual(resolved.classifyDeviceClass("pm1"), { metricKind: "pm1", foreign: false });
  assert.equal(resolved.resolveUnitProfileKey("pm1", "ug/m3"), "only");
  // pm1 and pm25 allow one unit each, which their profiles read; radon allows two, the units of
  // sound_pressure are not in the table, and ozone's one unit is not the kind's.
  assert.deepEqual(resolved.IMPLIED_UNIT_PROFILE, { pm25: "only", pm1: "only" });
  assert.ok(Object.isFrozen(resolved));
});

// ------------------------------------------ the unit a declared class leaves no choice in --

// Home Assistant allows humidity only in %, CO2 only in ppm, PM2.5 only in µg/m³; temperature
// has three units, so a thermometer without one still says nothing about its scale.
test("a kind whose device class allows exactly one unit implies that unit's profile", () => {
  assert.deepEqual(resolution.IMPLIED_UNIT_PROFILE, { humidity: "percent", co2: "ppm", pm25: "microgram_per_m3" });
  assert.ok(Object.isFrozen(resolution.IMPLIED_UNIT_PROFILE));
});

test("a sensor's unit profile is its own unit's, or the implied one when it declared its class and reports none", () => {
  const { sensorUnitProfileKey } = resolution;
  assert.equal(sensorUnitProfileKey("humidity", "%", "device_class"), "percent");
  assert.equal(sensorUnitProfileKey("humidity", null, "device_class"), "percent");
  assert.equal(sensorUnitProfileKey("co2", undefined, "device_class"), "ppm");
  assert.equal(sensorUnitProfileKey("pm25", "   ", "device_class"), "microgram_per_m3", "a blank unit is no unit");
  assert.equal(sensorUnitProfileKey("temperature", null, "device_class"), null, "°C, °F or K: no choice to make for it");
  assert.equal(sensorUnitProfileKey("humidity", "ppm", "device_class"), null, "a reported unit is never overruled");
  assert.equal(sensorUnitProfileKey("temperature", "°F", "unit"), "fahrenheit");
  assert.equal(sensorUnitProfileKey("humidity", null, "unit"), null, "only a declaration implies a unit");
  assert.equal(sensorUnitProfileKey("constructor", null, "device_class"), null);
});

// ---------------------------------------------------- what a declared device class says --

test("a declared device class of the card names its measurement, whatever the spelling around it", () => {
  const cases = {
    temperature: "temperature",
    humidity: "humidity",
    carbon_dioxide: "co2",
    pm25: "pm25",
    " Temperature ": "temperature",
    HUMIDITY: "humidity",
  };
  for (const [raw, metricKind] of Object.entries(cases)) {
    assert.deepEqual(resolution.classifyDeviceClass(raw), { metricKind, foreign: false }, JSON.stringify(raw));
    assert.ok(Object.isFrozen(resolution.classifyDeviceClass(raw)));
  }
});

// The TIMMERFLOTTE battery reports % and declares battery: the declaration decides, not the unit.
test("a declared Home Assistant device class that is not the card's is a foreign measurement", () => {
  const theCards = new Set(Object.keys(resolution.METRIC_TYPE_BY_DEVICE_CLASS));
  for (const deviceClass of HA_SENSOR_DEVICE_CLASSES.filter((name) => !theCards.has(name))) {
    assert.deepEqual(resolution.classifyDeviceClass(deviceClass), { metricKind: null, foreign: true }, deviceClass);
  }
  assert.deepEqual(resolution.classifyDeviceClass(" Battery"), { metricKind: null, foreign: true });
  assert.ok(Object.isFrozen(resolution.classifyDeviceClass("battery")));
});

// A typo or an invented class is a declaration error, not a statement; the unit may still decide.
test("an absent, malformed or unknown device class declares nothing", () => {
  const nothing = { metricKind: null, foreign: false };
  for (const raw of [undefined, null, "", "   ", 5, true, {}, [], "temperatur", "temp", "rel_humidity", "pm2.5"]) {
    assert.deepEqual(resolution.classifyDeviceClass(raw), nothing, JSON.stringify(raw));
  }
  // Object-literal lookups must not answer from the prototype chain.
  for (const raw of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.deepEqual(resolution.classifyDeviceClass(raw), nothing, raw);
  }
  assert.ok(Object.isFrozen(resolution.classifyDeviceClass(undefined)));
});

// ----------------------------------------------------- Home Assistant's own tables --

// Home Assistant's SensorDeviceClass values (homeassistant/components/sensor/const.py),
// written out so every entry is pinned: a dropped class would let its unit decide again.
const HA_SENSOR_DEVICE_CLASSES = [
  "absolute_humidity", "apparent_power", "aqi", "area", "atmospheric_pressure", "battery",
  "blood_glucose_concentration", "carbon_dioxide", "carbon_monoxide", "conductivity", "current",
  "data_rate", "data_size", "date", "distance", "duration", "energy", "energy_distance",
  "energy_storage", "enum", "frequency", "gas", "humidity", "illuminance", "irradiance", "moisture",
  "monetary", "nitrogen_dioxide", "nitrogen_monoxide", "nitrous_oxide", "ozone", "ph", "pm1", "pm10",
  "pm25", "pm4", "power", "power_factor", "precipitation", "precipitation_intensity", "pressure",
  "radon", "reactive_energy", "reactive_power", "signal_strength", "sound_pressure", "speed",
  "sulphur_dioxide", "temperature", "temperature_delta", "timestamp", "uptime",
  "volatile_organic_compounds", "volatile_organic_compounds_parts", "voltage", "volume",
  "volume_flow_rate", "volume_storage", "water", "weight", "wind_direction", "wind_speed",
];

test("the Home Assistant device class vocabulary is complete and frozen", () => {
  assert.deepEqual([...homeAssistant.HA_SENSOR_DEVICE_CLASSES].sort(), HA_SENSOR_DEVICE_CLASSES);
  assert.equal(HA_SENSOR_DEVICE_CLASSES.length, 62);
  assert.ok(Object.isFrozen(homeAssistant.HA_SENSOR_DEVICE_CLASSES));
  assert.throws(() => homeAssistant.HA_SENSOR_DEVICE_CLASSES.push("made_up"), TypeError);
});

// DEVICE_CLASS_UNITS as Home Assistant writes it (μ is U+03BC), for the classes a climate card
// could be pointed at.
test("the Home Assistant unit table is copied verbatim for the climate classes", () => {
  assert.deepEqual(homeAssistant.HA_DEVICE_CLASS_UNITS, {
    temperature: ["°C", "°F", "K"],
    humidity: ["%"],
    carbon_dioxide: ["ppm"],
    pm1: ["μg/m³"],
    pm25: ["μg/m³"],
    pm4: ["μg/m³"],
    pm10: ["μg/m³"],
    carbon_monoxide: ["ppb", "ppm", "mg/m³", "μg/m³"],
    nitrogen_dioxide: ["ppb", "ppm", "μg/m³"],
    ozone: ["ppb", "ppm", "μg/m³"],
    nitrogen_monoxide: ["ppb", "μg/m³"],
    sulphur_dioxide: ["ppb", "μg/m³"],
    nitrous_oxide: ["μg/m³"],
    volatile_organic_compounds: ["μg/m³", "mg/m³"],
    volatile_organic_compounds_parts: ["ppm", "ppb"],
    absolute_humidity: ["g/m³", "mg/m³"],
    radon: ["Bq/m³", "pCi/L"],
  });
  assert.ok(Object.isFrozen(homeAssistant.HA_DEVICE_CLASS_UNITS));
  for (const [deviceClass, units] of Object.entries(homeAssistant.HA_DEVICE_CLASS_UNITS)) {
    assert.ok(Object.isFrozen(units), deviceClass);
    assert.ok(HA_SENSOR_DEVICE_CLASSES.includes(deviceClass), `${deviceClass} is a Home Assistant class`);
  }
});

// ------------------------------------------------------------ unit profiles --

test("resolveUnitProfileKey() maps a raw unit to its profile, or null", () => {
  assert.equal(resolution.resolveUnitProfileKey("temperature", "°C"), "celsius");
  assert.equal(resolution.resolveUnitProfileKey("temperature", "°F"), "fahrenheit");
  assert.equal(resolution.resolveUnitProfileKey("temperature", "K"), "kelvin");
  assert.equal(resolution.resolveUnitProfileKey("temperature", "kelvin"), "kelvin");
  assert.equal(resolution.resolveUnitProfileKey("humidity", "%"), "percent");
  assert.equal(resolution.resolveUnitProfileKey("co2", "ppm"), "ppm");
  assert.equal(resolution.resolveUnitProfileKey("pm25", "µg/m³"), "microgram_per_m3");
});

test("resolveUnitProfileKey() rejects an unknown kind, a missing unit, and a foreign unit", () => {
  assert.equal(resolution.resolveUnitProfileKey("pressure", "hPa"), null, "unknown metric kind");
  assert.equal(resolution.resolveUnitProfileKey("temperature", null), null, "missing unit");
  assert.equal(resolution.resolveUnitProfileKey("temperature", ""), null, "empty unit");
  assert.equal(resolution.resolveUnitProfileKey("temperature", "hPa"), null, "unit of another quantity");
  assert.equal(resolution.resolveUnitProfileKey("temperature", "%"), null, "unit of another metric kind");
});

// -------------------------------------------------------------- unit token --

test("normalizeUnitToken() folds representation differences only", () => {
  const pm25 = unitToken.normalizeUnitToken("µg/m³");
  for (const spelling of ["μg/m³", "µg/m3", "µg/m^3", " µg/m³ ", "µG/M³"]) {
    assert.equal(unitToken.normalizeUnitToken(spelling), pm25, `spelling "${spelling}"`);
  }
  assert.equal(unitToken.normalizeUnitToken("°C"), unitToken.normalizeUnitToken(" °c "));
});

test("normalizeUnitToken() does not fold genuinely different units together", () => {
  const tokens = ["°C", "°F", "K", "%", "ppm", "µg/m³"].map(unitToken.normalizeUnitToken);
  assert.equal(new Set(tokens).size, tokens.length, "distinct units must stay distinct");
  assert.notEqual(unitToken.normalizeUnitToken("hPa"), unitToken.normalizeUnitToken("ppm"));
});

test("normalizeUnitToken() returns an empty token for anything that is not a string", () => {
  for (const invalid of [null, undefined, 42, {}, []]) {
    assert.equal(unitToken.normalizeUnitToken(invalid), "", JSON.stringify(invalid));
  }
});
