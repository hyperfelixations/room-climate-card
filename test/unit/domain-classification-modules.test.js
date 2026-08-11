"use strict";

// Direct unit tests for src/domain/classification/*.
//
// The profile values are product decisions: which reading counts as optimal,
// where "too humid" begins and what a fridge may drift to. These tests pin
// each profile's data — thresholds,
// ordering, zones, bands, validity rules and icon tiers — and sweep every tier
// boundary from just below, exactly on, and just above.
//
// Tier selection is re-implemented here from the documented rule (first tier
// whose `min` the value passes, using the profile's own comparison operator).
// The production path is covered by the element-level suites; what needs its
// own guard is that the profile data still satisfies that rule after being
// moved.

const test = require("node:test");
const assert = require("node:assert/strict");

let registry;
let zones;

const KINDS = ["temperature", "humidity", "co2", "pm25"];
const EXPECTED_PROFILE_IDS = {
  temperature: ["indoor", "outdoor", "fridge"],
  humidity: ["indoor"],
  co2: ["indoor"],
  pm25: ["indoor"],
};

test.before(async () => {
  registry = await import("../../src/domain/classification/registry.js");
  zones = await import("../../src/domain/classification/zones.js");
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
  // A copy-paste that reused one object would make an edit to one profile
  // silently change another.
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

test("every tier carries a score, a level key, a hex colour and a known zone", () => {
  for (const { kind, id, profile } of allProfiles()) {
    for (const [i, tier] of profile.tiers.entries()) {
      const label = `${kind}/${id} tier ${i}`;
      assert.equal(typeof tier.score, "number", `${label}: score`);
      assert.equal(typeof tier.levelKey, "string", `${label}: levelKey`);
      assert.match(tier.levelKey, /^level\./, `${label}: levelKey namespace`);
      assert.match(tier.color, /^#[0-9A-Fa-f]{6}$/, `${label}: colour`);
      assert.ok(zones.CLASSIFICATION_ZONES.includes(tier.zone), `${label}: zone "${tier.zone}"`);
    }
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

// `optimal ⊆ comfort` is semantic and holds for every profile: "optimal" is by
// definition a narrowing of "comfortable". The reference range is a different kind of
// statement — it is where the AXIS starts, not what the reading means — so it is
// asserted only for the profiles that declare one, and its relation to the bands is a
// property of the built-ins rather than a rule (a configured profile may declare a
// narrower one, and the bar clips the bands into whatever axis it draws).
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

// The other direction of the same rule, and the one that would otherwise go unstated:
// an anchored profile has to have something to anchor to.
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
  const EPS = 1e-9;
  for (const { kind, id, profile } of allProfiles()) {
    for (const [i, tier] of profile.tiers.entries()) {
      if (!Number.isFinite(tier.min)) continue;
      const label = `${kind}/${id} tier ${i} (min ${tier.min}, comparison "${profile.comparison}")`;
      const lower = profile.tiers[i + 1];

      // Just above the boundary always selects this tier.
      assert.equal(selectTier(profile, tier.min + EPS), tier, `${label}: just above`);

      // Exactly on the boundary depends on the profile's own operator.
      if (profile.comparison === ">=") {
        assert.equal(selectTier(profile, tier.min), tier, `${label}: exactly on (inclusive)`);
      } else {
        assert.equal(selectTier(profile, tier.min), lower, `${label}: exactly on (exclusive -> next lower)`);
      }

      // Just below always falls through to the next lower tier.
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
    assert.equal(
      selectTier(profile, -Infinity),
      profile.comparison === ">" ? undefined : profile.tiers[profile.tiers.length - 1],
      `${kind}/${id}: -Infinity`
    );
    assert.equal(selectTier(profile, NaN), undefined, `${kind}/${id}: NaN matches no tier`);
  }
});

// ---------------------------------------------------------- validity rules --

test("humidity, co2 and pm25 declare physical validity limits with an invalid classification", () => {
  const cases = {
    humidity: { invalid: [-0.1, 100.1, -5, 150], valid: [0, 50, 100] },
    co2: { invalid: [0, -1], valid: [1, 400, 5000] },
    pm25: { invalid: [-0.1, -5], valid: [0, 12, 500] },
  };
  for (const [kind, { invalid, valid }] of Object.entries(cases)) {
    const profile = registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles.indoor;
    assert.equal(typeof profile.invalidWhen, "function", `${kind}: invalidWhen`);
    for (const value of invalid) assert.equal(profile.invalidWhen(value), true, `${kind}: ${value} must be invalid`);
    for (const value of valid) assert.equal(profile.invalidWhen(value), false, `${kind}: ${value} must be valid`);
    assert.equal(profile.invalidClassification.zone, "invalid", `${kind}: invalid zone`);
    assert.equal(profile.invalidClassification.levelKey, "level.invalidReading", `${kind}: invalid level key`);
    assert.match(profile.invalidClassification.color, /^#[0-9A-Fa-f]{6}$/, `${kind}: invalid colour`);
  }
});

test("temperature profiles deliberately declare no physical validity limit", () => {
  // Any finite temperature is a possible reading; there is no "impossible"
  // value the way there is for a negative concentration.
  for (const id of EXPECTED_PROFILE_IDS.temperature) {
    const profile = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles[id];
    assert.equal(profile.invalidWhen, undefined, `temperature/${id}`);
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
  assert.deepEqual(p.iconThresholds, { fire: 28, high: 26, normal: 20, low: 18 });
  assert.equal(p.iconTiers, undefined);
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
  assert.deepEqual(p.iconThresholds, { fire: 35, high: 30, normal: 14, low: 5 });
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
  assert.deepEqual(p.iconThresholds, { fire: 12, high: 10, normal: 1, low: -2 });
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
  assert.equal(p.iconThresholds, undefined);
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

test("pm25/indoor uses the exclusive comparison so a value on a boundary stays lower", () => {
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor;
  assert.equal(p.comparison, ">", "PM2.5 boundaries are exclusive");
  assert.equal(p.oneSided, true);
  assert.equal(p.headroom, undefined);
  assert.deepEqual(p.comfort, { min: 0, max: 15 });
  assert.deepEqual(p.optimal, { min: 0, max: 5 });
  assert.deepEqual(p.scale, { min: 0, max: 20 });
  assert.equal(p.step, 5);
  assert.deepEqual(p.tiers.map((t) => t.min), [50, 35, 25, 15, 5, -Infinity]);
  assert.deepEqual(p.iconTiers.map((t) => t.min), [50, 25, 5, -Infinity]);
  // Exactly 5 is NOT "slightly elevated" because the comparison is exclusive.
  assert.equal(selectTier(p, 5).levelKey, "level.optimal");
  assert.equal(selectTier(p, 5.1).levelKey, "level.slightlyElevated");
});

// ------------------------------------------------------------ icon tables --

test("temperature icon thresholds descend from fire to low", () => {
  for (const id of EXPECTED_PROFILE_IDS.temperature) {
    const t = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles[id].iconThresholds;
    assert.ok(t.fire > t.high, `temperature/${id}: fire > high`);
    assert.ok(t.high > t.normal, `temperature/${id}: high > normal`);
    assert.ok(t.normal > t.low, `temperature/${id}: normal > low`);
  }
});

test("non-temperature icon tiers descend and end open-ended", () => {
  for (const kind of ["humidity", "co2", "pm25"]) {
    const tiers = registry.CLASSIFICATION_PROFILE_REGISTRY[kind].profiles.indoor.iconTiers;
    for (let i = 1; i < tiers.length; i++) {
      assert.ok(tiers[i].min < tiers[i - 1].min, `${kind}: icon tier ${i} must be below ${i - 1}`);
    }
    assert.equal(tiers[tiers.length - 1].min, -Infinity, `${kind}: final icon tier is open-ended`);
    for (const tier of tiers) assert.match(tier.icon, /^mdi:/, `${kind}: icon name`);
  }
});
