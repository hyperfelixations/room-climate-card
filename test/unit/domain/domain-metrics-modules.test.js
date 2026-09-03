"use strict";

// Direct unit tests for src/domain/metrics/* and src/domain/units/*: which metric kind an
// entity reports, which unit it is in, and how to move a value between units without ever
// mixing an absolute reading with a difference. A mistake here produces a plausible number
// wrong by 32, or classifies humidity against temperature tiers. See interne Doku §5
// „Unit-, Range-, Trend- und Scale-System".

const test = require("node:test");
const assert = require("node:assert/strict");

let definitions;
let resolution;
let conversion;
let unitToken;

const METRIC_KINDS = ["temperature", "humidity", "co2", "pm25"];

test.before(async () => {
  definitions = await import("../../../src/domain/metrics/definitions.js");
  resolution = await import("../../../src/domain/metrics/resolution.js");
  conversion = await import("../../../src/domain/units/conversion.js");
  unitToken = await import("../../../src/domain/units/unit-token.js");
});

// ------------------------------------------------------------- definitions --

test("exactly the four supported metric kinds are registered", () => {
  assert.deepEqual(Object.keys(definitions.METRIC_DEFINITIONS).sort(), [...METRIC_KINDS].sort());
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

test("the device_class map covers Home Assistant's four sensor classes", () => {
  assert.deepEqual(resolution.METRIC_TYPE_BY_DEVICE_CLASS, {
    temperature: "temperature",
    humidity: "humidity",
    carbon_dioxide: "co2",
    pm25: "pm25",
  });
});

test("METRIC_TYPE_BY_UNIT is derived from every registered unit alias", () => {
  // The index is derived, not hand-maintained: every alias in every unitProfile resolves.
  // This answers which measurement uses a unit; whether that identifies a sensor is tested
  // below.
  for (const [kind, definition] of Object.entries(definitions.METRIC_DEFINITIONS)) {
    for (const profile of Object.values(definition.unitProfiles)) {
      for (const unit of profile.units) {
        const token = unitToken.normalizeUnitToken(unit);
        assert.equal(
          resolution.METRIC_TYPE_BY_UNIT[token],
          kind,
          `unit "${unit}" (token "${token}") must resolve to ${kind}`
        );
      }
    }
  }
});

test("the derived index contains no entries beyond the registered aliases", () => {
  const expected = new Set();
  for (const definition of Object.values(definitions.METRIC_DEFINITIONS)) {
    for (const profile of Object.values(definition.unitProfiles)) {
      for (const unit of profile.units) expected.add(unitToken.normalizeUnitToken(unit));
    }
  }
  assert.deepEqual(Object.keys(resolution.METRIC_TYPE_BY_UNIT).sort(), [...expected].sort());
});

// -------------------------------------- when a unit may stand in for a device class ---

// The card asks for device_class first; the unit is a fallback for template sensors that
// never got one, and it applies only where the unit belongs to one measurement — a wrong
// guess shows a real number against the wrong scale and colour.
test("a unit stands in for a device class only when one measurement uses it", () => {
  for (const unit of ["°C", "°F", "K", "celsius", "kelvin", "%"]) {
    assert.equal(resolution.unitPredictsMetricKind(unit), true, unit);
  }
  // Home Assistant defines five sensor device classes reporting ppm and eleven reporting
  // µg/m³, so neither says what is being measured.
  for (const unit of ["ppm", "µg/m³", "ug/m3", "μg/m³"]) {
    assert.equal(resolution.unitPredictsMetricKind(unit), false, unit);
  }
  for (const nothing of [null, undefined, ""]) {
    assert.equal(resolution.unitPredictsMetricKind(nothing), false, JSON.stringify(nothing));
  }
});

// The rule is written as data, so a shared unit loses its fallback by itself.
test("the ambiguity table is what decides, not a list of exceptions", () => {
  for (const [unit, deviceClasses] of Object.entries(resolution.DEVICE_CLASSES_BY_UNIT)) {
    assert.ok(deviceClasses.length >= 1, unit);
    assert.equal(
      resolution.unitPredictsMetricKind(unit),
      deviceClasses.length === 1,
      `${unit} is claimed by ${deviceClasses.length} device class(es)`
    );
  }
  // And the two the card itself measures in a shared unit are genuinely in there.
  assert.ok(resolution.DEVICE_CLASSES_BY_UNIT.ppm.includes("carbon_dioxide"));
  assert.ok(resolution.DEVICE_CLASSES_BY_UNIT["µg/m³"].includes("pm25"));

  // Two questions, two tables: a profile written in ppm is a CO2 profile (there is only
  // one), while a sensor reporting ppm is a guess.
  assert.equal(resolution.METRIC_TYPE_BY_UNIT.ppm, "co2", "which measurement uses ppm");
  assert.equal(resolution.metricKindFromUnitAlone("ppm"), null, "but a sensor reporting it is not identified");
  assert.equal(resolution.metricKindFromUnitAlone("°C"), "temperature");
  assert.equal(resolution.metricKindFromUnitAlone("parsecs"), null);
});

test("the Home Assistant unit ambiguity table preserves every owning device class", () => {
  assert.deepEqual(resolution.DEVICE_CLASSES_BY_UNIT, {
    "°C": ["temperature"],
    "°F": ["temperature"],
    K: ["temperature"],
    "%": ["humidity"],
    ppm: [
      "carbon_dioxide",
      "carbon_monoxide",
      "nitrogen_dioxide",
      "ozone",
      "volatile_organic_compounds_parts",
    ],
    "µg/m³": [
      "absolute_humidity",
      "carbon_monoxide",
      "nitrogen_dioxide",
      "nitrogen_monoxide",
      "ozone",
      "pm1",
      "pm10",
      "pm25",
      "pm4",
      "sulphur_dioxide",
      "volatile_organic_compounds",
    ],
  });
});

// A declared device_class always wins, so nothing changes for a sensor that has one.
test("a declared device class is unaffected by the unit rule", () => {
  assert.equal(resolution.METRIC_TYPE_BY_DEVICE_CLASS.carbon_dioxide, "co2");
  assert.equal(resolution.METRIC_TYPE_BY_DEVICE_CLASS.pm25, "pm25");
  // And the unit still resolves to its profile once the kind is settled.
  assert.equal(resolution.resolveUnitProfileKey("co2", "ppm"), "ppm");
  assert.equal(resolution.resolveUnitProfileKey("pm25", "µg/m³"), "microgram_per_m3");
});

test("temperature word and bare-letter aliases all resolve", () => {
  for (const unit of ["°C", "c", "celsius", "°F", "f", "fahrenheit", "K", "kelvin"]) {
    assert.equal(
      resolution.METRIC_TYPE_BY_UNIT[unitToken.normalizeUnitToken(unit)],
      "temperature",
      `unit "${unit}"`
    );
  }
});

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
