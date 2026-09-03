"use strict";

// Direct unit tests for src/domain/classification/*. The profile values are product
// decisions (which reading is optimal, where "too humid" begins); these tests pin each
// profile's data — thresholds, ordering, zones, bands, validity rules, icon tiers — and
// sweep every tier boundary just below, on, and just above.
// Tier selection is re-implemented here from the documented rule (first tier whose `min`
// the value passes, under the profile's own operator); the production path is covered by
// the element-level suites. See interne Doku §5 „Classification und Profile".

const test = require("node:test");
const assert = require("node:assert/strict");

let registry;
let zones;
let icons;
let classify;

const KINDS = ["temperature", "humidity", "co2", "pm25"];
const EXPECTED_PROFILE_IDS = {
  temperature: ["indoor", "outdoor", "fridge"],
  humidity: ["indoor"],
  co2: ["indoor"],
  pm25: ["indoor"],
};

test.before(async () => {
  registry = await import("../../../src/domain/classification/registry.js");
  zones = await import("../../../src/domain/classification/zones.js");
  icons = await import("../../../src/domain/classification/icons.js");
  classify = await import("../../../src/domain/classification/classify.js");
});

function allProfiles() {
  const out = [];
  for (const kind of KINDS) {
    for (const [id, profile] of Object.entries(registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles)) {
      out.push({ kind, id, profile });
    }
  }
  return out;
}

function selectTier(profile, value) {
  return profile.tiers.find((tier) => (profile.comparison === ">" ? value > tier.min : value >= tier.min));
}

// ------------------------------------------------------------------ zones --

test("the zone vocabulary is closed and frozen", () => {
  assert.deepEqual(zones.CLASSIFICATION_ZONES, ["optimal", "comfort", "outside", "invalid"]);
  assert.equal(Object.isFrozen(zones.CLASSIFICATION_ZONES), true);
});

// --------------------------------------------------------------- registry --

test("every metric kind registers its expected profiles and a valid default", () => {
  assert.deepEqual(Object.keys(registry.CLASSIFICATION_PROFILE_REGISTRY).sort(), [...KINDS].sort());
  for (const kind of KINDS) {
    const entry = registry.CLASSIFICATION_PROFILE_REGISTRY[kind];
    assert.deepEqual(Object.keys(entry.profiles), EXPECTED_PROFILE_IDS[kind], `${kind}: profile ids`);
    assert.ok(entry.profiles[entry.defaultProfile], `${kind}: defaultProfile "${entry.defaultProfile}" must exist`);
    assert.equal(entry.defaultProfile, "indoor", `${kind}: indoor stays the default`);
  }
});

test("each profile declares the id and metric kind it is registered under", () => {
  for (const { kind, id, profile } of allProfiles()) {
    assert.equal(profile.id, id, `${kind}/${id}: id must match its registry key`);
    assert.equal(profile.metricKind, kind, `${kind}/${id}: metricKind must match its registry key`);
  }
});

test("profile ids are unique within a metric kind", () => {
  for (const kind of KINDS) {
    const ids = Object.values(registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles).map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${kind}: duplicate profile id`);
  }
});

test("no two profiles share an object identity", () => {
  // A reused object would make an edit to one profile silently change another.
  const seen = new Set();
  for (const { kind, id, profile } of allProfiles()) {
    assert.equal(seen.has(profile), false, `${kind}/${id} is the same object as another profile`);
    seen.add(profile);
  }
});

// ------------------------------------------------------ structural contract --

test("every profile has a well-formed, strictly descending tier list", () => {
  for (const { kind, id, profile } of allProfiles()) {
    const label = `${kind}/${id}`;
    assert.ok(Array.isArray(profile.tiers) && profile.tiers.length > 0, `${label}: tiers`);
    assert.ok([">=", ">"].includes(profile.comparison), `${label}: comparison must be ">=" or ">"`);
    for (let i = 1; i < profile.tiers.length; i++) {
      assert.ok(
        profile.tiers[i].min < profile.tiers[i - 1].min,
        `${label}: tier ${i} (min ${profile.tiers[i].min}) must be below tier ${i - 1} (min ${profile.tiers[i - 1].min})`
      );
    }
    const last = profile.tiers[profile.tiers.length - 1];
    assert.equal(last.min, -Infinity, `${label}: the final tier must be the open-ended default`);
    assert.equal(
      profile.tiers.filter((t) => t.min === -Infinity).length,
      1,
      `${label}: exactly one open-ended tier`
    );
  }
});

// No colours: a built-in tier says how far it is from optimal and lets the palette say what
// that looks like, so a hard-coded hex would ignore the configured palette.
test("every tier carries a distance from optimal, a level key and a known zone, and no colour", () => {
  for (const { kind, id, profile } of allProfiles()) {
    for (const [i, tier] of profile.tiers.entries()) {
      const label = `${kind}/${id} tier ${i}`;
      assert.ok(Number.isInteger(tier.score), `${label}: score ${tier.score} must be a whole distance from optimal`);
      assert.equal(typeof tier.levelKey, "string", `${label}: levelKey`);
      assert.match(tier.levelKey, /^level\./, `${label}: levelKey namespace`);
      assert.equal(tier.color, undefined, `${label}: must name no colour of its own`);
      assert.ok(zones.CLASSIFICATION_ZONES.includes(tier.zone), `${label}: zone "${tier.zone}"`);
    }
    // Every built-in has an optimal tier and reaches at most as far as the shipped palette's
    // wings, so colours come out one to one.
    const scores = profile.tiers.map((tier) => tier.score);
    assert.ok(scores.includes(0), `${kind}/${id}: has an optimal tier`);
    assert.ok(Math.max(...scores) <= 5, `${kind}/${id}: reaches at most 5 above optimal`);
    assert.ok(Math.min(...scores) >= -5, `${kind}/${id}: reaches at most 5 below optimal`);
  }
});

test("tier scores descend together with the thresholds", () => {
  for (const { kind, id, profile } of allProfiles()) {
    for (let i = 1; i < profile.tiers.length; i++) {
      assert.ok(
        profile.tiers[i].score < profile.tiers[i - 1].score,
        `${kind}/${id}: score at tier ${i} must be below tier ${i - 1}`
      );
    }
  }
});

// `optimal ⊆ comfort` holds for every profile by definition. The reference range is where
// the axis starts, not what a reading means, so it is asserted only where declared, and its
// relation to the bands is a property of the built-ins rather than a rule.
test("optimal is contained in comfort, and every declared reference range is ordered", () => {
  for (const { kind, id, profile } of allProfiles()) {
    const label = `${kind}/${id}`;
    assert.ok(profile.comfort.min < profile.comfort.max, `${label}: comfort band width`);
    assert.ok(profile.optimal.min < profile.optimal.max, `${label}: optimal band width`);
    assert.ok(profile.optimal.min >= profile.comfort.min, `${label}: optimal.min inside comfort`);
    assert.ok(profile.optimal.max <= profile.comfort.max, `${label}: optimal.max inside comfort`);
    assert.ok(profile.step > 0, `${label}: step must be positive`);
    if (profile.scale === null) {
      assert.equal(profile.anchorScale, false, `${label}: only an unanchored profile may declare no reference range`);
      continue;
    }
    assert.ok(profile.scale.min < profile.scale.max, `${label}: scale width`);
    assert.ok(profile.scale.min <= profile.comfort.min, `${label}: scale covers comfort.min`);
    assert.ok(profile.scale.max >= profile.comfort.max, `${label}: scale covers comfort.max`);
  }
});

// The other direction: an anchored profile has to have something to anchor to.
test("every anchored built-in profile declares a reference range", () => {
  for (const { kind, id, profile } of allProfiles()) {
    if (profile.anchorScale === false) continue;
    assert.ok(profile.scale, `${kind}/${id}: an anchored axis needs a reference range`);
  }
});

test("exactly one tier per profile is the optimal zone, and it contains the optimal band", () => {
  for (const { kind, id, profile } of allProfiles()) {
    const optimalTiers = profile.tiers.filter((t) => t.zone === "optimal");
    assert.equal(optimalTiers.length, 1, `${kind}/${id}: exactly one optimal tier`);
    const midpoint = (profile.optimal.min + profile.optimal.max) / 2;
    assert.equal(
      selectTier(profile, midpoint).zone,
      "optimal",
      `${kind}/${id}: the middle of the optimal band (${midpoint}) must classify as optimal`
    );
  }
});

// ----------------------------------------------------- boundary behaviour --

test("every tier boundary behaves correctly just below, exactly on, and just above", () => {
  // For all six profiles: the threshold belongs to the tier that names it. The operator is
  // asserted, not branched on, so a profile that stopped matching its neighbours fails by name.
  const EPS = 1e-9;
  for (const { kind, id, profile } of allProfiles()) {
    assert.equal(profile.comparison, ">=", `${kind}/${id}: every built-in profile is inclusive`);
    for (const [i, tier] of profile.tiers.entries()) {
      if (!Number.isFinite(tier.min)) continue;
      const label = `${kind}/${id} tier ${i} (min ${tier.min})`;
      const lower = profile.tiers[i + 1];

      assert.equal(selectTier(profile, tier.min + EPS), tier, `${label}: just above`);
      assert.equal(selectTier(profile, tier.min), tier, `${label}: exactly on`);
      assert.equal(selectTier(profile, tier.min - EPS), lower, `${label}: just below`);
    }
  }
});

test("a value below every threshold lands in the open-ended default tier", () => {
  for (const { kind, id, profile } of allProfiles()) {
    const last = profile.tiers[profile.tiers.length - 1];
    for (const value of [-1e6, -273.15, Number.MIN_SAFE_INTEGER]) {
      assert.equal(selectTier(profile, value), last, `${kind}/${id}: value ${value}`);
    }
  }
});

test("a value above every threshold lands in the top tier", () => {
  for (const { kind, id, profile } of allProfiles()) {
    for (const value of [1e6, Number.MAX_SAFE_INTEGER]) {
      assert.equal(selectTier(profile, value), profile.tiers[0], `${kind}/${id}: value ${value}`);
    }
  }
});

test("non-finite values never crash tier selection", () => {
  for (const { kind, id, profile } of allProfiles()) {
    assert.equal(selectTier(profile, Infinity), profile.tiers[0], `${kind}/${id}: +Infinity`);
    // Every built-in is inclusive, so -Infinity lands in the open-ended tier. Only a YAML `>`
    // profile does not — see domain-services-modules.test.js.
    assert.equal(selectTier(profile, -Infinity), profile.tiers[profile.tiers.length - 1], `${kind}/${id}: -Infinity`);
    assert.equal(selectTier(profile, NaN), undefined, `${kind}/${id}: NaN matches no tier`);
  }
});

// ---------------------------------------------------------- validity rules --

test("every profile declares the limits of what its measurement can be", () => {
  // For all four: the limit itself is a reading, and only what lies past it is impossible.
  // 0 ppm, 0 % and 100 % humidity and absolute zero are valid; the invalid cases start beyond.
  const cases = {
    temperature: { invalid: [-273.16, -274, -1e6], valid: [-273.15, -40, 0, 21, 1e6] },
    humidity: { invalid: [-0.1, 100.1, -5, 150], valid: [0, 50, 100] },
    co2: { invalid: [-0.1, -1], valid: [0, 1, 400, 5000] },
    pm25: { invalid: [-0.1, -5], valid: [0, 12, 500] },
  };
  for (const [kind, { invalid, valid }] of Object.entries(cases)) {
    for (const id of EXPECTED_PROFILE_IDS[kind]) {
      const profile = registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles[id];
      assert.equal(typeof profile.invalidWhen, "function", `${kind}/${id}: invalidWhen`);
      for (const value of invalid) assert.equal(profile.invalidWhen(value), true, `${kind}/${id}: ${value} must be invalid`);
      for (const value of valid) assert.equal(profile.invalidWhen(value), false, `${kind}/${id}: ${value} must be valid`);
    }
  }
});

test("a profile's limits travel as a range, so they can be re-expressed in another unit", () => {
  // The predicate alone is a Celsius comparison; `validRange` is the same statement as data,
  // which projectProfileToDisplayUnit() converts so a Fahrenheit card rejects the same
  // physical readings rather than the same numbers.
  for (const id of EXPECTED_PROFILE_IDS.temperature) {
    const profile = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles[id];
    assert.deepEqual(profile.validRange, { min: -273.15, max: null, minInclusive: true, maxInclusive: true }, id);
  }
  assert.deepEqual(registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.validRange, {
    min: 0,
    max: 100,
    minInclusive: true,
    maxInclusive: true,
  });
  for (const kind of ["co2", "pm25"]) {
    assert.deepEqual(
      registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles.indoor.validRange,
      { min: 0, max: null, minInclusive: true, maxInclusive: true },
      kind
    );
  }
});

test("an impossible reading takes the neutral invalid classification, however the profile got there", () => {
  // humidity, co2 and pm25 name it themselves; the temperature profiles use classify.js's
  // fallback. Both arrive at the same place, so this asks what a reading is classified as.
  const impossible = { temperature: -300, humidity: 150, co2: -1, pm25: -1 };
  for (const [kind, value] of Object.entries(impossible)) {
    for (const id of EXPECTED_PROFILE_IDS[kind]) {
      const result = classify.classifyNumericValue(registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles[id], value);
      assert.equal(result.invalid, true, `${kind}/${id}`);
      assert.equal(result.zone, "invalid", `${kind}/${id}`);
      assert.equal(result.levelKey, "level.invalidReading", `${kind}/${id}`);
      assert.equal(result.explicitColor, null, `${kind}/${id}: the palette owns the invalid colour`);
    }
  }
});

// ----------------------------------------------------- per-profile values --

test("temperature/indoor keeps its documented bands, tiers and icons", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor;
  assert.equal(p.comparison, ">=");
  assert.deepEqual(p.comfort, { min: 20, max: 24 });
  assert.deepEqual(p.optimal, { min: 21, max: 23 });
  assert.deepEqual(p.scale, { min: 19, max: 25 });
  assert.equal(p.step, 1);
  assert.equal(p.anchorScale, undefined, "indoor uses the anchored default");
  assert.deepEqual(p.tiers.map((t) => t.min), [28, 26, 25, 24, 23, 21, 20, 19, 18, 16, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [28, 26, 20, 18, -Infinity]);
  assert.equal(selectTier(p, 22).levelKey, "level.optimal");
  assert.equal(selectTier(p, 24).zone, "outside", "24 °C is already outside comfort by tier");
});

test("temperature/outdoor follows live data instead of a fixed axis", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.outdoor;
  assert.equal(p.anchorScale, false, "the rendered axis must not be pinned to the reference scale");
  assert.deepEqual(p.comfort, { min: 14, max: 26 });
  assert.deepEqual(p.optimal, { min: 18, max: 22 });
  assert.equal(p.scale, null, "the one profile that declares no reference range");
  assert.equal(p.step, 1);
  assert.deepEqual(p.tiers.map((t) => t.min), [35, 30, 28, 26, 22, 18, 14, 10, 5, 0, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [35, 30, 14, 5, -Infinity]);
  assert.equal(selectTier(p, 20).levelKey, "level.optimal");
  assert.equal(selectTier(p, -3).levelKey, "level.veryCold");
});

test("temperature/fridge keeps its food-safety band and its anchored axis", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.fridge;
  assert.deepEqual(p.comfort, { min: 1, max: 6 });
  assert.deepEqual(p.optimal, { min: 3, max: 5 });
  assert.deepEqual(p.scale, { min: 0, max: 8 });
  assert.equal(p.step, 1);
  assert.equal(p.anchorScale, undefined, "a fridge has a well-defined operating band, so the axis stays fixed");
  assert.deepEqual(p.tiers.map((t) => t.min), [12, 10, 8, 6, 5, 3, 1, 0, -2, -4, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [12, 10, 1, -2, -Infinity]);
  assert.equal(selectTier(p, 4).levelKey, "level.optimal");
  assert.equal(selectTier(p, 8).zone, "outside", "8 °C is the start of the cited danger zone");
});

test("the three temperature profiles are genuinely different scales", () => {
  const { indoor, outdoor, fridge } = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles;
  assert.notDeepEqual(indoor.comfort, outdoor.comfort);
  assert.notDeepEqual(indoor.comfort, fridge.comfort);
  assert.notDeepEqual(outdoor.comfort, fridge.comfort);
  // The same reading must be judged differently by each profile.
  assert.equal(selectTier(indoor, 22).levelKey, "level.optimal");
  assert.equal(selectTier(outdoor, 22).levelKey, "level.slightlyWarm");
  assert.equal(selectTier(fridge, 22).levelKey, "level.veryHot");
});

test("humidity/indoor keeps its symmetric band and icon tiers", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor;
  assert.equal(p.comparison, ">=");
  assert.deepEqual(p.comfort, { min: 40, max: 60 });
  assert.deepEqual(p.optimal, { min: 42, max: 58 });
  assert.deepEqual(p.scale, { min: 35, max: 65 });
  assert.equal(p.step, 5);
  assert.equal(p.oneSided, undefined, "humidity has both a too-dry and a too-humid side");
  assert.deepEqual(p.tiers.map((t) => t.min), [75, 70, 65, 60, 58, 42, 40, 35, 30, 25, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [75, 60, 40, -Infinity]);
  assert.equal(selectTier(p, 50).levelKey, "level.optimal");
});

test("co2/indoor is one-sided with explicit headroom", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor;
  assert.equal(p.comparison, ">=");
  assert.equal(p.oneSided, true, "there is no 'too little CO2' for a room");
  assert.equal(p.headroom, 100);
  assert.deepEqual(p.comfort, { min: 0, max: 1000 });
  assert.deepEqual(p.optimal, { min: 0, max: 800 });
  assert.deepEqual(p.scale, { min: 0, max: 1200 });
  assert.equal(p.step, 200);
  assert.deepEqual(p.tiers.map((t) => t.min), [2000, 1600, 1200, 1000, 800, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [2000, -Infinity]);
  assert.equal(selectTier(p, 500).levelKey, "level.optimal");
  assert.equal(selectTier(p, 2000).levelKey, "level.critical");
});

test("pm25/indoor reads its thresholds the way every other built-in profile does", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor;
  assert.equal(p.comparison, ">=", "the threshold itself belongs to the tier that names it");
  assert.equal(p.oneSided, true);
  assert.equal(p.headroom, undefined);
  assert.deepEqual(p.comfort, { min: 0, max: 15 });
  assert.deepEqual(p.optimal, { min: 0, max: 5 });
  assert.deepEqual(p.scale, { min: 0, max: 20 });
  assert.equal(p.step, 5);
  assert.deepEqual(p.tiers.map((t) => t.min), [50, 35, 25, 15, 5, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [50, 25, 5, -Infinity]);
  assert.equal(selectTier(p, 4.99).levelKey, "level.optimal");
  assert.equal(selectTier(p, 5).levelKey, "level.slightlyElevated", "exactly 5 is the tier 5 names");
});

// ------------------------------------------------------------ icon tables --

// The icon every built-in profile shows at every threshold and on either side of it. Read
// out of the card as shipped, so this is evidence rather than a restatement of the data
// below it: any profile whose icons move shows up here. The three PM2.5 thresholds sit one
// row higher than then because the profile now reads them inclusively like its neighbours.
const SHIPPED_ICONS = {
  "temperature/indoor": [
    [[-100, 0, 15, 15.99, 16, 16.01, 17, 17.99], "mdi:snowflake"],
    [[18, 18.01, 18.99, 19, 19.01, 19.99], "mdi:thermometer-low"],
    [[
      20, 20.01, 20.99, 21, 21.01, 22, 22.99, 23, 23.01, 23.99, 24, 24.01, 24.99, 25,
      25.01, 25.99,
    ], "mdi:thermometer"],
    [[26, 26.01, 27, 27.99], "mdi:thermometer-high"],
    [[28, 28.01, 29, 1000], "mdi:fire-alert"],
  ],
  "temperature/outdoor": [
    [[-100, -1, -0.01, 0, 0.01, 1, 4, 4.99], "mdi:snowflake"],
    [[5, 5.01, 6, 9, 9.99, 10, 10.01, 11, 13, 13.99], "mdi:thermometer-low"],
    [[
      14, 14.01, 15, 17, 17.99, 18, 18.01, 19, 21, 21.99, 22, 22.01, 23, 25, 25.99, 26,
      26.01, 27, 27.99, 28, 28.01, 29, 29.99,
    ], "mdi:thermometer"],
    [[30, 30.01, 31, 34, 34.99], "mdi:thermometer-high"],
    [[35, 35.01, 36, 1000], "mdi:fire-alert"],
  ],
  "temperature/fridge": [
    [[-100, -5, -4.01, -4, -3.99, -3, -2.01], "mdi:snowflake"],
    [[-2, -1.99, -1, -0.01, 0, 0.01, 0.99], "mdi:thermometer-low"],
    [[
      1, 1.01, 2, 2.99, 3, 3.01, 4, 4.99, 5, 5.01, 5.99, 6, 6.01, 7, 7.99, 8, 8.01, 9,
      9.99,
    ], "mdi:thermometer"],
    [[10, 10.01, 11, 11.99], "mdi:thermometer-high"],
    [[12, 12.01, 13, 1000], "mdi:fire-alert"],
  ],
  "humidity/indoor": [
    [[
      -100, 0, 24, 24.99, 25, 25.01, 26, 29, 29.99, 30, 30.01, 31, 34, 34.99, 35, 35.01,
      36, 39, 39.99,
    ], "mdi:water-minus"],
    [[40, 40.01, 41, 41.99, 42, 42.01, 43, 57, 57.99, 58, 58.01, 59, 59.99], "mdi:water-percent"],
    [[
      60, 60.01, 61, 64, 64.99, 65, 65.01, 66, 69, 69.99, 70, 70.01, 71, 74, 74.99,
    ], "mdi:water-plus"],
    [[75, 75.01, 76, 1000], "mdi:water-percent-alert"],
  ],
  "co2/indoor": [
    [[
      -100, -1, -0.01, 0, 0.01, 1, 799, 799.99, 800, 800.01, 801, 999, 999.99, 1000,
      1000.01, 1001, 1199, 1199.99, 1200, 1200.01, 1201, 1599, 1599.99, 1600, 1600.01,
      1601, 1999, 1999.99,
    ], "mdi:molecule-co2"],
    [[2000, 2000.01, 2001], "mdi:alert-circle-outline"],
  ],
  "pm25/indoor": [
    [[-100, -1, -0.01, 0, 0.01, 1, 4, 4.99], "mdi:molecule"],
    [[
      5, 5.01, 6, 14, 14.99, 15, 15.01, 16, 19, 19.99, 20, 20.01, 21, 24, 24.99,
    ], "mdi:weather-hazy"],
    [[25, 25.01, 26, 34, 34.99, 35, 35.01, 36, 49, 49.99], "mdi:weather-dust"],
    [[50, 50.01, 51, 1000], "mdi:alert-circle-outline"],
  ],
};

test("every built-in profile shows the icons it has always shown", () => {
  let probes = 0;
  for (const { kind, id, profile } of allProfiles()) {
    const runs = SHIPPED_ICONS[`${kind}/${id}`];
    assert.ok(runs, `${kind}/${id}: has a recorded icon table`);
    for (const [values, icon] of runs) {
      for (const value of values) {
        assert.equal(icons.profileIconForValue(value, profile), icon, `${kind}/${id} @ ${value}`);
        probes++;
      }
    }
  }
  assert.equal(probes, 248, "the whole recorded table was replayed");
});

// One icon-tier shape for every measurement.
test("every profile's icon tiers descend and end open-ended", () => {
  for (const { kind, id, profile } of allProfiles()) {
    const tiers = profile.iconTiers;
    assert.ok(Array.isArray(tiers) && tiers.length > 0, `${kind}/${id}: icon tiers`);
    for (let i = 1; i < tiers.length; i++) {
      assert.ok(tiers[i].min < tiers[i - 1].min, `${kind}/${id}: icon tier ${i} descends`);
    }
    assert.equal(tiers[tiers.length - 1].min, -Infinity, `${kind}/${id}: the last icon tier is open-ended`);
    for (const tier of tiers) {
      assert.ok(typeof tier.icon === "string" && tier.icon.startsWith("mdi:"), `${kind}/${id}: ${tier.icon}`);
    }
  }
});
