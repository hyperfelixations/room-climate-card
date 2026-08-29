"use strict";

// The generators, tested. A weighted generator whose realised distribution has drifted from
// its declared weights is the exact failure mode this suite has already lived through: the
// previous randomized test drew perfectly good random numbers and produced a population in
// which nothing interesting could happen, and nothing measured that.
//
// So the weights are not just declared, they are checked — and so is the claim that each
// axis actually reaches the values it says it reaches. A generator that has, say, quietly
// stopped producing misspelled attribute keys is still green everywhere else; only this file
// notices.

const test = require("node:test");
const assert = require("node:assert/strict");

const { SeededRandom } = require("../helpers/seeded-random.js");
const { generateDescription, weighted, WEIGHTS, OPTION_PRESENCE, ENUMS, OTHER_DOMAIN_UNITS } = require("./generators.js");
const V = require("./vocabulary.js");
const { describeScenario } = require("../fixtures/scenario.js");
const { METRICS, METRIC_KINDS, LANGUAGES, VIEWS } = require("../manifests/product-surface.js");
const fs = require("node:fs");
const path = require("node:path");

const SAMPLE = 5000;

// Every description a sample of seeds produces, generated once and shared: these tests all
// ask different questions of the same population.
//
// Measured through describeScenario(), not on the raw generator output. A generator that
// leaves a field out is saying "the default", and the default is what the card will see — so
// counting raw output would measure the generator's shorthand rather than the population it
// actually produces. (It also silently reports zero for anything defaulted, which is how this
// file first failed.)
const population = (() => {
  const rng = new SeededRandom(0x9e3779b9);
  return Array.from({ length: SAMPLE }, () => describeScenario(generateDescription(rng.int(0, 0x7fffffff))));
})();

function everyEntity(description) {
  const own = description.primary ? [description.primary, ...description.rooms] : description.rooms;
  return [...own, ...(description.extras || [])];
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

// How often a configuration key appears at all.
function configShare(key) {
  return population.filter((description) => key in description.config).length / SAMPLE;
}

// Every value a configuration key was ever given across the population.
function valuesOf(key) {
  return population.filter((description) => key in description.config).map((description) => description.config[key]);
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

test("every declared weight table is actually drawn from", () => {
  // An axis nobody draws is a table that documents an intention the generator does not have,
  // and it looks exactly like a table that works. Static rather than statistical because a
  // rare outcome and an unused one are indistinguishable in a sample: the question is whether
  // the code asks, not how often the answer comes back.
  const source = fs.readFileSync(path.join(__dirname, "generators.js"), "utf8");
  for (const axis of Object.keys(WEIGHTS)) {
    assert.ok(source.includes(`WEIGHTS.${axis}`), `WEIGHTS.${axis} is declared and never drawn from`);
  }
});

test("every optional configuration key really does appear sometimes", () => {
  // OPTION_PRESENCE is read through a dynamic key, so the static check above cannot see it.
  // The realised population can: an option nobody ever writes is a probability that documents
  // an intention the generator does not have.
  for (const key of Object.keys(OPTION_PRESENCE)) {
    // The one key that by construction never appears under its own name — it exists to
    // produce a MISSPELLING of a real key, which is how the run keeps proving BUG-09.
    if (key === "misspelledKey") continue;
    assert.ok(configShare(key) > 0, `${key} is declared in OPTION_PRESENCE and never generated`);
  }
  // And the misspelled one does turn up, spelled wrong.
  const known = new Set([...Object.keys(OPTION_PRESENCE), "entity", "rooms", "palette", "views"]);
  const strays = population.flatMap((description) => Object.keys(description.config).filter((key) => !known.has(key)));
  assert.ok(strays.length > 0, "no card was ever given a key nobody meant to type");
});

test("typo() damages a token without destroying it", () => {
  const rng = new SeededRandom(3);
  for (const word of ["clip", "wrap", "value_desc", "extremes", "device_class", "pastel"]) {
    const seen = new Set();
    for (let index = 0; index < 200; index++) seen.add(V.typo(rng, word));
    assert.ok(seen.size >= 5, `${word}: only ${seen.size} distinct misspellings`);
    for (const damaged of seen) {
      assert.equal(typeof damaged, "string");
      assert.notEqual(damaged, word, `${word}: typo() returned the original`);
      assert.ok(damaged.trim().length > 0, `${word}: typo() produced nothing`);
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
  assert.ok(correctClass > 0.55 && correctClass < 0.85, `correct device class share is ${correctClass.toFixed(3)}`);

  const numericState = shareOf((entity) => typeof entity.state === "number");
  assert.ok(numericState > 0.65 && numericState < 0.9, `numeric state share is ${numericState.toFixed(3)}`);
});

test("the rare cases are rare, but they do happen", () => {
  // Each of these is a mistake a real person makes in a template sensor. Each must appear
  // often enough to be exercised and seldom enough not to dominate the run.
  const axes = {
    "misspelled device_class key": shareOf(
      (entity) => entity.deviceClass && entity.deviceClass.key !== "device_class"
    ),
    "misspelled unit key": shareOf((entity) => entity.unit && entity.unit.key !== "unit_of_measurement"),
    "unit from another Home Assistant domain": shareOf(
      (entity) => entity.unit && OTHER_DOMAIN_UNITS.includes(entity.unit.value)
    ),
    "unit from no domain at all": shareOf((entity) => entity.unit && V.NON_HA_UNITS.includes(entity.unit.value)),
    "no unit at all": shareOf((entity) => entity.unit === null),
    "no device class at all": shareOf((entity) => entity.deviceClass === null),
    "a foreign device class": shareOf(
      (entity) => entity.deviceClass && V.FOREIGN_DEVICE_CLASSES.includes(entity.deviceClass.value)
    ),
    "unavailable or unknown": shareOf((entity) => entity.state === "unavailable" || entity.state === "unknown"),
    "malformed state": shareOf((entity) => V.MALFORMED_STATES.includes(entity.state)),
    "absent from hass entirely": shareOf((entity) => entity.present === false),
    "an absurd number": shareOf((entity) => V.ABSURD_NUMBERS.includes(entity.state)),
    "a physically impossible reading": shareOf(
      (entity, description) =>
        typeof entity.state === "number" &&
        ((description.metric === "temperature" && entity.state < -273.15) ||
          (description.metric === "humidity" && entity.state < 0) ||
          (description.metric === "co2" && entity.state < 0) ||
          (description.metric === "pm25" && entity.state < 0))
    ),
  };
  for (const [name, share] of Object.entries(axes)) {
    assert.ok(share > 0.005, `${name} never or almost never happens (${share.toFixed(4)})`);
    assert.ok(share < 0.3, `${name} dominates the run (${share.toFixed(4)})`);
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

// ------------------------------------------------------- the configuration surface --

test("every optional configuration key is generated, at roughly the rate declared", () => {
  // The check that keeps the YAML surface covered. A key that stops being generated — because
  // a refactor dropped it, or a weight went to zero — takes a whole configuration path out of
  // the run without failing anything else.
  for (const [key, expected] of Object.entries(OPTION_PRESENCE)) {
    if (key === "misspelledKey") continue; // measured separately below
    const actual = configShare(key);
    assert.ok(actual > expected / 3, `${key} appears in only ${(100 * actual).toFixed(1)} % of cards`);
    assert.ok(actual < expected * 3 + 0.05, `${key} appears in ${(100 * actual).toFixed(1)} % of cards, far above its weight`);
  }
});

test("view options are nested in entries, and misspelled top-level keys occur", () => {
  const entries = valuesOf("views").filter(Array.isArray).flat();
  assert.ok(entries.some((entry) => entry && typeof entry === "object" && entry.options), "per-view options are never configured");
  assert.ok(entries.some((entry) => entry && typeof entry === "object" && "enabled" in entry), "views[].enabled is never configured");
  assert.equal(configShare("view_options"), 0, "the generator invented the unsupported top-level view_options key");
  const misspelled = population.filter((description) =>
    Object.keys(description.config).some((key) => V.MISSPELLED_CONFIG_KEYS.includes(key))
  );
  assert.ok(misspelled.length / SAMPLE > 0.01, "a misspelled top-level key is never generated");
});

test("every enumerated option is written correctly, misspelled, and as the wrong type", () => {
  for (const [key, allowed] of Object.entries(ENUMS)) {
    // Reached through the title and the subtitle rather than as a key of its own, and
    // measured below where those two are.
    if (key === "header_overflow") continue;
    // Reached through the show: block, and measured with it.
    if (key === "show_rooms_part") continue;
    const values = valuesOf(key);
    assert.ok(values.length > 20, `${key}: only ${values.length} samples`);
    assert.ok(values.some((value) => allowed.includes(value)), `${key}: never written correctly`);
    assert.ok(
      values.some((value) => typeof value === "string" && !allowed.includes(value)),
      `${key}: never misspelled`
    );
    assert.ok(
      values.some((value) => typeof value !== "string" && !allowed.includes(value)),
      `${key}: never given the wrong type`
    );
  }
});

test("subtitle is generated in every shape it accepts, including both reserved words wrong", () => {
  // `subtitle: clip` sets the WRAPPING; `subtitle: Ground floor` sets the TEXT. Getting one
  // of those two words slightly wrong therefore changes the meaning entirely, which is
  // exactly the kind of mistake worth generating.
  const values = valuesOf("subtitle");
  assert.ok(values.length > 40, `only ${values.length} subtitles`);
  assert.ok(values.some((value) => value === "clip" || value === "wrap"), "the reserved words are never used");
  assert.ok(
    values.some((value) => typeof value === "string" && /^\s*(clip|wrap)\s*$/i.test(value) === false && /cl|wr/i.test(value)),
    "a near-miss of a reserved word is never generated"
  );
  assert.ok(values.some((value) => value && typeof value === "object"), "the object form is never used");
  assert.ok(values.some((value) => value === "" || value === null), "the empty forms are never used");
});

test("actions are generated valid, unknown, misspelled and malformed", () => {
  const roomActions = population.flatMap((description) => description.rooms.flatMap((room) => [room.tap_action, room.hold_action]));
  const actions = [...valuesOf("tap_action"), ...valuesOf("hold_action"), ...roomActions].filter((value) => value !== undefined);
  assert.ok(actions.length > 40, `only ${actions.length} actions`);
  const named = actions.filter((value) => value && typeof value === "object" && typeof value.action === "string");
  assert.ok(named.some((value) => V.VALID_ACTIONS.includes(value.action)), "no valid action is ever generated");
  assert.ok(named.some((value) => !V.VALID_ACTIONS.includes(value.action)), "no unknown action is ever generated");
  assert.ok(actions.some((value) => !value || typeof value !== "object"), "no malformed action is ever generated");
  assert.ok(population.some((description) => description.rooms.some((room) => room.hold_action !== undefined)), "room hold_action is never generated");
});

test("views are generated in every shape, including a list that omits scale", () => {
  const lists = valuesOf("views");
  assert.ok(lists.length > 40, `only ${lists.length} view lists`);
  const arrays = lists.filter(Array.isArray);
  assert.ok(arrays.some((value) => value.length && !value.includes("scale")), "no views list omits scale");
  assert.ok(arrays.some((value) => new Set(value).size !== value.length), "a views list with duplicates is never generated");
  assert.ok(arrays.some((value) => value.some((entry) => entry && typeof entry === "object")), "the object form is never used");
  assert.ok(
    arrays.some((value) => value.some((entry) => typeof entry === "string" && !VIEWS.includes(entry))),
    "an unknown view name is never generated"
  );
  assert.ok(lists.some((value) => !Array.isArray(value)), "a views value that is not a list is never generated");
});

test("palettes are generated in every shape the card accepts, and several it does not", () => {
  const palettes = valuesOf("palette");
  assert.ok(palettes.length > 100, `only ${palettes.length} palettes`);
  assert.ok(palettes.some((value) => typeof value === "string"), "no palette is ever named");
  assert.ok(palettes.some((value) => typeof value === "string" && value.split("-").length === 2), "no two-colour gradient is generated");
  assert.ok(palettes.some((value) => typeof value === "string" && value.split("-").length === 3), "no three-colour gradient is generated");
  assert.ok(palettes.some((value) => typeof value === "number"), "a numeric colour scalar is never generated");
  const written = palettes.filter((value) => value && typeof value === "object" && !Array.isArray(value));
  assert.ok(written.length > 5, "a palette is never written out in YAML");
  assert.ok(written.some((value) => "above" in value && "below" in value), "a two-winged written palette never occurs");
  assert.ok(written.some((value) => !("above" in value) && !("below" in value)), "a single-colour written palette never occurs");
  assert.ok(palettes.some((value) => Array.isArray(value)), "a nonsense palette shape is never generated");
});

test("classification overrides are generated, including a ramp that breaks the score contract", () => {
  const overrides = valuesOf("classification");
  assert.ok(overrides.length > 20, `only ${overrides.length} classification overrides`);
  assert.ok(overrides.some((value) => value && typeof value === "object" && "source" in value), "the source form never occurs");
  assert.ok(overrides.some((value) => typeof value === "string"), "a named profile never occurs");
  assert.ok(
    overrides.some((value) => value && value.source === "custom" && Array.isArray(value.tiers) && value.tiers.length > 0),
    "a written-out tier ramp never occurs"
  );
  assert.equal(
    overrides.some((value) => value && value.profile && typeof value.profile === "object"),
    false,
    "custom tiers are nested under the nonexistent classification.profile object"
  );
});

test("the auxiliary entities exist in hass without becoming rooms", () => {
  // A range_entity is read by the card and must not turn into a room chip. Getting that
  // wrong in the generator would quietly change what every card in the run looks like.
  const withRange = population.filter((description) => description.config.range_entity === "sensor.range");
  assert.ok(withRange.length > 20, `only ${withRange.length} cards point at a range entity`);
  for (const description of withRange) {
    assert.ok(
      description.extras.some((entity) => entity.id === "sensor.range"),
      "the range entity is configured but never exists"
    );
    assert.ok(
      !description.rooms.some((room) => room.id === "sensor.range"),
      "the range entity became a room, which would change the card's data"
    );
  }
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

test("every generated description is plain JSON, so it can be printed and shrunk", () => {
  for (const description of population.slice(0, 300)) {
    const round = JSON.parse(JSON.stringify(description));
    assert.deepEqual(round, description, "JSON round-trip changed a generated failure description");
  }
});

// ------------------------------------------- the axes about the environment ------

// These four describe the world around the card rather than the card itself: what a sensor is
// called, when it last moved, what else it carries, and what Home Assistant handed over. They
// are asserted here for the same reason as everything above — an axis whose realised share has
// drifted from its intent is a generator testing something other than what it says.

test("most sensors are named the way Home Assistant names them, and some are not", () => {
  const impossible = shareOf((entity) => V.IMPOSSIBLE_ENTITY_IDS.includes(entity.id));
  assert.ok(impossible > 0.02, `entity ids Home Assistant would never issue: ${impossible}`);
  assert.ok(impossible < 0.2, `too many: ${impossible}`);
  // And the ordinary ones really are ordinary.
  const conventional = shareOf((entity) => /^[a-z_]+\.[a-z0-9_]+$/.test(String(entity.id)));
  assert.ok(conventional > 0.8, `conventional ids: ${conventional}`);
});

test("a sensor usually reports the timestamps it should, and sometimes does not", () => {
  const share = (shape) => shareOf((entity) => entity.timestamps === shape);
  assert.ok(share("identical") > 0.5, `identical: ${share("identical")}`);
  for (const shape of ["missing", "future", "malformed"]) {
    const seen = share(shape);
    assert.ok(seen > 0.01, `${shape} never appears: ${seen}`);
    assert.ok(seen < 0.15, `${shape} is too common: ${seen}`);
  }
});

test("extra attributes are rare, and the awkward ones are rarer still", () => {
  const withExtras = shareOf((entity) => Object.keys(entity.extraAttributes || {}).length > 0);
  assert.ok(withExtras > 0.05 && withExtras < 0.3, `entities carrying extra attributes: ${withExtras}`);
  // Every awkward shape has to be reachable, or the list is decoration.
  const seen = new Set();
  for (const description of population) {
    for (const entity of everyEntity(description)) {
      for (const key of Object.keys(entity.extraAttributes || {})) seen.add(key);
    }
  }
  for (const key of ["minimum", "maximum", "value_color", "value_level"]) {
    assert.ok(seen.has(key), `no entity ever carried ${key}`);
  }
});

test("hass is usually complete, and every gap in it is reachable", () => {
  const gapped = population.filter((description) => (description.hassGaps || []).length > 0).length / SAMPLE;
  assert.ok(gapped > 0.03 && gapped < 0.25, `descriptions with an incomplete hass: ${gapped}`);
  const seen = new Set(population.flatMap((description) => description.hassGaps || []));
  for (const gap of V.HASS_GAPS) assert.ok(seen.has(gap), `hass never arrived without ${gap}`);
  const themed = population.filter((description) => description.theme).length / SAMPLE;
  assert.ok(themed > 0.005, `a theme is never declared: ${themed}`);
  const combined = population.filter(
    (description) => description.theme && (description.hassGaps || []).length > 0
  ).length;
  assert.ok(combined > 0, "theme and hass gaps are mutually exclusive, so their interaction is never tested");
});

test("sometimes one sensor is both the average and a room", () => {
  // Two roles for one entity is a thing people configure, and it is where a marker can be
  // drawn twice or an average can count a room it has already counted.
  const shared = population.filter(
    (description) =>
      description.primary && description.rooms.some((room) => room.id === description.primary.id)
  ).length;
  assert.ok(shared > 0, "no generated card ever used one sensor in both roles");
  assert.ok(shared / SAMPLE < 0.15, `too many: ${shared / SAMPLE}`);
});
