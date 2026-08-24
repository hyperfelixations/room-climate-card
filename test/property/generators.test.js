"use strict";

// The generators, tested. A weighted generator whose realised distribution has drifted from
// its declared weights is the exact failure mode this suite has already lived through: the
// previous randomized test drew perfectly good random numbers and produced a population in
// which nothing interesting could happen, and nothing measured that.
//
// So the weights are not just declared, they are checked — and so is the claim that each
// axis actually reaches the values it says it reaches. A generator that has, say, quietly
// stopped producing misspelled attribute keys is still green everywhere else; only this
// file notices.

const test = require("node:test");
const assert = require("node:assert/strict");

const { SeededRandom } = require("../helpers/seeded-random.js");
const {
  generateDescription,
  weighted,
  WEIGHTS,
  FOREIGN_UNITS,
  MISSPELLED_DEVICE_CLASS_KEYS,
  MISSPELLED_UNIT_KEYS,
  MALFORMED_STATES,
  ABSURD_NUMBERS,
} = require("./generators.js");
const { describeScenario } = require("../fixtures/scenario.js");
const { METRICS, METRIC_KINDS, LANGUAGES } = require("../contracts/product-surface.js");

const SAMPLE = 4000;

// Every description a sample of seeds produces, generated once and shared: these tests all
// ask different questions of the same population.
//
// Measured through describeScenario(), not on the raw generator output. A generator that
// leaves a field out is saying "the default", and the default is what the card will see —
// so counting raw output would measure the generator's shorthand rather than the population
// it actually produces. (It also silently reports zero for anything defaulted, which is how
// this file first failed.)
const population = (() => {
  const rng = new SeededRandom(0x9e3779b9);
  return Array.from({ length: SAMPLE }, () => describeScenario(generateDescription(rng.int(0, 0x7fffffff))));
})();

function everyEntity(description) {
  return description.primary ? [description.primary, ...description.rooms] : description.rooms;
}

function shareOf(predicate) {
  let hits = 0;
  let total = 0;
  for (const description of population) {
    for (const entity of everyEntity(description)) {
      total += 1;
      if (predicate(entity, description)) hits += 1;
    }
  }
  return total === 0 ? 0 : hits / total;
}

// ------------------------------------------------------- the weighting machinery --

test("weighted() honours its table", () => {
  const rng = new SeededRandom(7);
  const counts = { a: 0, b: 0, c: 0 };
  for (let index = 0; index < 20000; index++) counts[weighted(rng, [[70, "a"], [25, "b"], [5, "c"]])] += 1;
  assert.ok(Math.abs(counts.a / 20000 - 0.7) < 0.02, `a: ${counts.a / 20000}`);
  assert.ok(Math.abs(counts.b / 20000 - 0.25) < 0.02, `b: ${counts.b / 20000}`);
  assert.ok(Math.abs(counts.c / 20000 - 0.05) < 0.01, `c: ${counts.c / 20000}`);
});

test("weighted() does not need its table normalised", () => {
  const rng = new SeededRandom(11);
  const counts = { x: 0, y: 0 };
  for (let index = 0; index < 10000; index++) counts[weighted(rng, [[3, "x"], [1, "y"]])] += 1;
  assert.ok(Math.abs(counts.x / 10000 - 0.75) < 0.02, `x: ${counts.x / 10000}`);
});

test("every declared weight table is well formed", () => {
  for (const [axis, table] of Object.entries(WEIGHTS)) {
    assert.ok(Array.isArray(table) && table.length >= 2, `${axis}: needs at least two outcomes`);
    const labels = table.map(([, label]) => label);
    assert.equal(new Set(labels).size, labels.length, `${axis}: repeats an outcome`);
    for (const [weight, label] of table) {
      assert.ok(Number.isFinite(weight) && weight > 0, `${axis}/${label}: weight must be positive`);
    }
  }
});

// ------------------------------------------------ the population it actually makes --

test("the ordinary case dominates: most entities carry a correct device class and unit", () => {
  const correctClass = shareOf(
    (entity, description) =>
      entity.deviceClass &&
      entity.deviceClass.key === "device_class" &&
      entity.deviceClass.value === METRICS[description.metric].deviceClass
  );
  assert.ok(correctClass > 0.6 && correctClass < 0.85, `correct device class share is ${correctClass.toFixed(3)}`);

  const numericState = shareOf((entity) => typeof entity.state === "number");
  assert.ok(numericState > 0.7 && numericState < 0.9, `numeric state share is ${numericState.toFixed(3)}`);
});

test("the rare cases are rare, but they do happen", () => {
  // Each of these is a mistake a real person makes in a template sensor. Each must appear
  // often enough to be exercised and seldom enough not to dominate the run.
  const axes = {
    "misspelled device_class key": shareOf(
      (entity) => entity.deviceClass && MISSPELLED_DEVICE_CLASS_KEYS.includes(entity.deviceClass.key)
    ),
    "misspelled unit key": shareOf((entity) => entity.unit && MISSPELLED_UNIT_KEYS.includes(entity.unit.key)),
    "unit from another domain entirely": shareOf((entity) => entity.unit && FOREIGN_UNITS.includes(entity.unit.value)),
    "no unit at all": shareOf((entity) => entity.unit === null),
    "no device class at all": shareOf((entity) => entity.deviceClass === null),
    "unavailable or unknown": shareOf((entity) => entity.state === "unavailable" || entity.state === "unknown"),
    "malformed state": shareOf((entity) => MALFORMED_STATES.includes(entity.state)),
    "absent from hass entirely": shareOf((entity) => entity.present === false),
    "an absurd number": shareOf((entity) => ABSURD_NUMBERS.includes(entity.state)),
  };
  for (const [name, share] of Object.entries(axes)) {
    assert.ok(share > 0.005, `${name} never or almost never happens (${share.toFixed(4)})`);
    assert.ok(share < 0.25, `${name} dominates the run (${share.toFixed(4)})`);
  }
});

test("every metric, every language and every room count is reached", () => {
  const metrics = new Set(population.map((description) => description.metric));
  assert.deepEqual([...metrics].sort(), [...METRIC_KINDS].sort());

  const languages = new Set(population.map((description) => description.language));
  for (const code of LANGUAGES) assert.ok(languages.has(code), `language ${code} is never generated`);
  assert.ok(
    [...languages].some((code) => !LANGUAGES.includes(code)),
    "an unsupported language code is never generated, so the fallback path is never taken"
  );

  const counts = population.map((description) => description.rooms.length);
  assert.equal(Math.min(...counts), 0, "a card with no rooms at all is never generated");
  assert.ok(Math.max(...counts) >= 9, `the largest generated card has only ${Math.max(...counts)} rooms`);
});

test("cards with mixed units are generated, and so are cards without a primary entity", () => {
  const mixed = population.filter((description) => {
    const units = new Set(everyEntity(description).map((entity) => (entity.unit ? entity.unit.value : null)));
    return units.size > 1;
  });
  assert.ok(mixed.length / SAMPLE > 0.05, `only ${mixed.length}/${SAMPLE} cards mix units`);

  const roomsOnly = population.filter((description) => description.primary === null);
  assert.ok(roomsOnly.length / SAMPLE > 0.05, `only ${roomsOnly.length}/${SAMPLE} cards have no primary entity`);
});

test("palettes and view lists cover their interesting shapes", () => {
  const palettes = population.map((description) => description.config.palette).filter((value) => value !== undefined);
  assert.ok(palettes.some((value) => typeof value === "string"), "no palette is ever named");
  assert.ok(palettes.some((value) => typeof value === "object" && value !== null), "no palette is ever written out");
  assert.ok(palettes.some((value) => typeof value === "number"), "a numeric colour scalar is never generated");

  const views = population.map((description) => description.config.views).filter((value) => value !== undefined);
  assert.ok(views.some((value) => Array.isArray(value) && !value.includes("scale")), "no views list omits scale");
  assert.ok(
    views.some((value) => Array.isArray(value) && new Set(value).size !== value.length),
    "a views list with duplicates is never generated"
  );
  assert.ok(views.some((value) => !Array.isArray(value)), "a views value that is not a list is never generated");
});

// --------------------------------------------------------------------- determinism --

test("the same seed always describes the same card", () => {
  // Without this a reported failure is not reproducible, and a shrunk case is a fiction.
  for (const seed of [1, 42, 0xc1a6e, 0x7fffffff]) {
    assert.deepEqual(generateDescription(seed), generateDescription(seed), `seed ${seed}`);
  }
});

test("different seeds describe different cards", () => {
  const distinct = new Set(population.slice(0, 500).map((description) => JSON.stringify(description)));
  assert.ok(distinct.size > 480, `only ${distinct.size}/500 descriptions are distinct`);
});
