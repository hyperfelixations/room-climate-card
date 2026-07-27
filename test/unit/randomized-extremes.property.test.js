"use strict";

// Permanent randomized/property tests (v2.16.0 audit, section 10): generates
// many pseudo-random, deliberately extreme configurations and checks a
// broad set of invariants that must hold no matter what — fixed-seed
// (0xC1A6E) for a deterministic, reproducible CI run; ROOM_CLIMATE_CARD_FUZZ_SEEDS
// (comma-separated extra seeds) for ad-hoc additional random runs (see
// `npm run test:fuzz`, package.json). Uses test/helpers/seeded-random.js
// (mulberry32) rather than a `fast-check` dependency — see that file's
// header comment for why.
//
// On failure: prints the seed and the full generated config, then attempts
// a lightweight, dependency-free shrink (fewer rooms, smaller magnitudes,
// default decimals) against the SAME failing predicate, reporting the
// smallest variant that still reproduces it — an intentionally simpler
// approximation of "minimized counterexample" than a real shrinking
// library, appropriate for this project's minimal-tooling philosophy (see
// "Entwicklungsumgebung und Tooling" in readme climate card.md).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { SeededRandom } = require("../helpers/seeded-random.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const DEFAULT_SEED = 0xc1a6e;
const ITERATIONS = 500;

const DEVICE_CLASS_BY_METRIC = { temperature: "temperature", humidity: "humidity", co2: "carbon_dioxide", pm25: "pm25" };
const LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh"];

// Deliberately extreme value pools per metric, including physically invalid
// ones (negative humidity/co2, negative pm25) so DATA-02's invalidWhen
// filtering gets exercised, not just "normal" random numbers.
function extremeValuePool(metricType, rng) {
  const pools = {
    temperature: [-273, -100, -40, 0, 15, 21, 50, 100, 1000],
    humidity: [-50, -1, 0, 1, 45, 99, 100, 101, 200],
    co2: [-1000, -1, 0, 1, 400, 2000, 50000, 1e9],
    pm25: [-100, -1, 0, 0.001, 12, 500, 1e6],
  };
  return rng.pick(pools[metricType]);
}

function isPhysicallyValid(metricType, value) {
  if (metricType === "humidity") return value >= 0 && value <= 100;
  if (metricType === "co2") return value > 0;
  if (metricType === "pm25") return value >= 0;
  return true; // temperature: no invalidWhen
}

// Generates one randomized, deliberately extreme card configuration + hass
// state. roomCount is an explicit parameter (not drawn from rng) so the
// shrink pass can call this again with a smaller count using the same rng
// draws for everything else, without needing a full replay mechanism.
function genConfig(rng, roomCount) {
  const metricType = rng.pick(["temperature", "humidity", "co2", "pm25"]);
  const deviceClass = DEVICE_CLASS_BY_METRIC[metricType];
  const decimals = rng.bool(0.7) ? undefined : rng.int(0, 3);
  const language = rng.pick(LANGUAGES);

  const states = {};
  const primaryMissing = rng.bool(0.15);
  if (!primaryMissing) {
    const primaryState = rng.bool(0.1) ? rng.pick(["unavailable", "unknown", "none", ""]) : extremeValuePool(metricType, rng);
    states["sensor.avg"] = mkState("sensor.avg", primaryState, { device_class: deviceClass });
  }

  const rooms = [];
  const roomValues = [];
  for (let i = 0; i < roomCount; i++) {
    const entity = `sensor.room${i}`;
    const isUnavailable = rng.bool(0.15);
    const value = isUnavailable ? rng.pick(["unavailable", "unknown"]) : extremeValuePool(metricType, rng);
    states[entity] = mkState(entity, value, { device_class: deviceClass });
    rooms.push({ entity, name: rng.string(0, 24), short: rng.string(0, 6) });
    roomValues.push({ numeric: isUnavailable ? null : value });
  }

  let rangeEntity;
  if (rng.bool(0.5)) {
    const min = extremeValuePool(metricType, rng);
    const max = extremeValuePool(metricType, rng);
    states["sensor.range"] = mkState("sensor.range", Math.abs(max - min), { minimum: min, maximum: max });
    rangeEntity = "sensor.range";
  }

  const config = {
    entity: primaryMissing ? "sensor.does_not_exist" : "sensor.avg",
    rooms,
    language,
    // AP-04: unlike the old range_scale_view:true flag (which only ADDED
    // range_scale on top of the other views' own default availability),
    // views: is fully authoritative once present — so range/scale/extremes
    // must be listed too (as "auto", their own condition()-based
    // availability still decides) to keep this randomized property test's
    // coverage equivalent to before.
    views: rng.bool(0.5) ? [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }, { type: "extremes" }] : undefined,
  };
  if (decimals !== undefined) config.decimals = decimals;
  if (rangeEntity) config.range_entity = rangeEntity;

  return { config, hass: mkHass(states, language), metricType, roomValues };
}

function checkInvariants(el, data, metricType, roomValues) {
  const problems = [];
  const push = (cond, msg) => {
    if (!cond) problems.push(msg);
  };

  for (const [key, value] of Object.entries(data)) {
    if (/Pos$/.test(key) && typeof value === "number") {
      push(Number.isFinite(value), `${key}=${value} must be finite`);
      push(value >= 0 && value <= 100, `${key}=${value} must be in [0,100]`);
    }
  }

  if (!data.empty) {
    push(Number.isFinite(data.scaleMin) && Number.isFinite(data.scaleMax), "scaleMin/scaleMax must be finite");
    push(data.scaleMin < data.scaleMax, `scaleMin=${data.scaleMin} must be < scaleMax=${data.scaleMax}`);
    if (data.hasRoomsView) {
      push(data.coolest.value <= data.warmest.value, "coolest.value must be <= warmest.value");
      push(Number.isFinite(data.spread) && data.spread >= 0, `spread=${data.spread} must be finite and >= 0`);
      push(data.roomCount >= 0 && data.inComfort >= 0 && data.inComfort <= data.roomCount, `inComfort=${data.inComfort} must be in [0, roomCount=${data.roomCount}]`);
      // DATA-02: physically invalid room readings (co2<=0, pm25<0,
      // humidity outside [0,100]) must never be picked as coolest/warmest.
      push(isPhysicallyValid(metricType, data.coolest.value), `coolest.value=${data.coolest.value} must be physically valid for ${metricType}`);
      push(isPhysicallyValid(metricType, data.warmest.value), `warmest.value=${data.warmest.value} must be physically valid for ${metricType}`);
    }
    // hasRoomsView/roomCount must exactly reflect the physically-valid
    // subset of generated room values, not the raw configured room count —
    // the single most direct property-level check that invalid readings
    // are actually excluded from the pipeline, not just recolored.
    const expectedValidRoomCount = roomValues.filter((v) => v.numeric !== null && isPhysicallyValid(metricType, v.numeric)).length;
    push(
      data.hasRoomsView === expectedValidRoomCount >= 2,
      `hasRoomsView=${data.hasRoomsView} must match (expectedValidRoomCount=${expectedValidRoomCount} >= 2)`
    );
    if (data.hasRoomsView) {
      push(data.roomCount === expectedValidRoomCount, `roomCount=${data.roomCount} must equal expectedValidRoomCount=${expectedValidRoomCount}`);
    }

    const views = data.views || [];
    push(new Set(views).size === views.length, `views has duplicates: ${views.join(",")}`);
    push(views.filter((v) => v === "scale").length === 1, `"scale" must appear exactly once in views: ${views.join(",")}`);

    const holdSeq = el._holdSequence();
    const n = views.length;
    if (n >= 2) {
      push(holdSeq.length === 2 * n - 2, `hold sequence length=${holdSeq.length} must be 2*${n}-2=${2 * n - 2}`);
      for (let i = 1; i < holdSeq.length; i++) {
        push(Math.abs(holdSeq[i] - holdSeq[i - 1]) === 1, `hold sequence adjacent diff at [${i}] must be 1, got ${holdSeq[i - 1]}->${holdSeq[i]}`);
      }
      if (holdSeq.length > 1) {
        push(Math.abs(holdSeq[0] - holdSeq[holdSeq.length - 1]) === 1, "hold sequence wrap diff must be 1");
      }
    } else {
      push(holdSeq.length === 0, `hold sequence must be empty for n=${n} views`);
    }
  }

  const html = el.shadowRoot.innerHTML;
  push(!/\bNaN\b/.test(html), "rendered HTML must not contain the literal text NaN");
  push(!/\bInfinity\b/.test(html), "rendered HTML must not contain the literal text Infinity");
  push(el.shadowRoot.querySelectorAll("script, img[onerror]").length === 0, "rendered HTML must contain no injected script/img[onerror] nodes");

  return problems;
}

// Reuses the single shared jsdom environment declared above (creating a
// fresh jsdom window + re-evaluating the ~4700-line card script per
// iteration would make 500+ iterations prohibitively slow) — matches
// load-card.jsdom.js's own documented usage contract ("call once per test
// file... not once per test case").
function runOne(seed, roomCount) {
  const rng = new SeededRandom(seed);
  const { config, hass, metricType, roomValues } = genConfig(rng, roomCount);
  let problems;
  let threw = null;
  let el;
  try {
    el = env.createCard(config, hass);
    const data = el._computeData();
    problems = checkInvariants(el, data, metricType, roomValues);
  } catch (err) {
    threw = err;
    problems = [`threw: ${err.stack || err}`];
  } finally {
    if (el) env.cleanup(el);
  }
  return { config, problems, threw };
}

function shrink(seed, originalRoomCount) {
  // Fewer rooms first (cheapest, most common source of interesting edge
  // cases: 0, 1, exactly-2 room-count boundaries), then stop as soon as a
  // smaller count no longer reproduces the failure.
  let smallest = originalRoomCount;
  for (let count = 0; count < originalRoomCount; count++) {
    const { problems, threw } = runOne(seed, count);
    if (problems.length > 0 || threw) {
      smallest = count;
      break;
    }
  }
  return smallest;
}

test(`randomized extremes property test (seed 0x${DEFAULT_SEED.toString(16)}, ${ITERATIONS} iterations)`, () => {
  const seedRng = new SeededRandom(DEFAULT_SEED);
  const failures = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const iterationSeed = seedRng.int(0, 0x7fffffff);
    const roomCount = new SeededRandom(iterationSeed).int(0, 20);
    const { config, problems, threw } = runOne(iterationSeed, roomCount);
    if (problems.length > 0 || threw) {
      failures.push({ iterationSeed, roomCount, config, problems });
    }
  }

  if (failures.length > 0) {
    const first = failures[0];
    const smallestRoomCount = shrink(first.iterationSeed, first.roomCount);
    const shrunk = runOne(first.iterationSeed, smallestRoomCount);
    const report = [
      `${failures.length}/${ITERATIONS} randomized iterations failed. First failure:`,
      `  seed=0x${first.iterationSeed.toString(16)}, roomCount=${first.roomCount}`,
      `  problems: ${first.problems.join("; ")}`,
      `  minimized (shrunk) roomCount=${smallestRoomCount}: ${JSON.stringify(shrunk.config)}`,
      `  minimized problems: ${shrunk.problems.join("; ")}`,
    ].join("\n");
    assert.fail(report);
  }
});

// ROOM_CLIMATE_CARD_FUZZ_SEEDS=1234,5678 npm run test:unit -- runs the same
// property test again with each additional seed — off by default so the
// standard `npm test` run stays fast and fully deterministic; intended for
// manual/nightly extra-confidence runs (see `test:fuzz` in package.json and
// the dev readme's Tooling section — no working GitHub Actions nightly
// exists yet, same documented limitation as the rest of this project's CI).
const extraSeeds = (process.env.ROOM_CLIMATE_CARD_FUZZ_SEEDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

for (const extraSeed of extraSeeds) {
  test(`randomized extremes property test (extra seed 0x${extraSeed.toString(16)}, ${ITERATIONS} iterations)`, () => {
    const seedRng = new SeededRandom(extraSeed);
    const failures = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const iterationSeed = seedRng.int(0, 0x7fffffff);
      const roomCount = new SeededRandom(iterationSeed).int(0, 20);
      const { problems, threw } = runOne(iterationSeed, roomCount);
      if (problems.length > 0 || threw) failures.push({ iterationSeed, roomCount, problems });
    }
    assert.equal(failures.length, 0, `seed 0x${extraSeed.toString(16)}: ${failures.length}/${ITERATIONS} failed — first: ${JSON.stringify(failures[0])}`);
  });
}
