"use strict";

// WEIGHTED GENERATORS over scenario descriptions.
//
// The point of a property test is not to try strange things; it is to try ORDINARY things
// in strange COMBINATIONS, and occasionally something strange as well. A generator that
// draws uniformly from an extreme set spends its whole budget in territory no user ever
// reaches, and one that only draws sensible values never finds anything. So every axis below
// is weighted: mostly what a dashboard really looks like, sometimes a mistake somebody really
// makes, rarely something absurd.
//
// THE AMBITION IS COVERAGE OF THE WHOLE YAML SURFACE. Everything the card accepts in
// configuration is generated here — not only entities and palettes but titles, subtitles,
// decimals, room grids, sort and label modes, actions, view lists, per-view options,
// classification overrides, and the two auxiliary entities. Anything a person can write,
// this can write, and it can write it slightly wrong.
//
// EVERY AXIS IS NAMED AND WEIGHTED IN ONE PLACE. WEIGHTS is exported and generators.test.js
// measures the realised distribution against it. A generator whose weights have drifted from
// its intent is exactly the failure this suite has already had once — the previous randomized
// test drew fine and asserted nothing, because its entities were missing a unit and every
// card it built landed in the no-data state. Nothing measured that, so nothing reported it
// for five hundred iterations.
//
// WHAT COMES OUT IS A DESCRIPTION, NOT A CARD. Everything here emits plain JSON for
// test/fixtures/scenario.js. That is what makes a failure reportable: the case prints, it
// shrinks structurally (see shrink.js), and the minimised result is a fixture a person can
// paste into a hand-written test unchanged.

const { SeededRandom } = require("../helpers/seeded-random.js");
const { METRICS, METRIC_KINDS, LANGUAGES, PALETTE_KEYS, VIEWS } = require("../contracts/product-surface.js");
const V = require("./vocabulary.js");

// --------------------------------------------------------------------- the tables --

// Alternative units that are still valid for the same measurement.
const SAME_METRIC_UNITS = { temperature: ["°F", "K"], humidity: [], co2: [], pm25: [] };

// The canonical unit of each OTHER metric the card knows: a plausible copy-paste error.
function otherMetricUnits(metric) {
  return METRIC_KINDS.filter((kind) => kind !== metric).map((kind) => METRICS[kind].canonicalUnit);
}

// Every unit from a Home Assistant domain the card does NOT handle. Flattened once.
const OTHER_DOMAIN_UNITS = Object.entries(V.HA_UNITS)
  .filter(([domain]) => !["temperature", "humidity", "carbon_dioxide", "pm25"].includes(domain))
  .flatMap(([, units]) => units);

// Where each metric actually lives, where it plausibly lives, and where it cannot.
const VALUE_BANDS = {
  temperature: { typical: [-20, 45], wide: [-60, 100], impossible: [-400, -274] },
  humidity: { typical: [0, 100], wide: [0, 100], impossible: [-50, -0.01] },
  co2: { typical: [350, 2500], wide: [1, 50000], impossible: [-1000, 0] },
  pm25: { typical: [0, 60], wide: [0, 1000], impossible: [-100, -0.01] },
};

// Values that sit exactly on a classification threshold, where a `>` and a `>=` disagree.
const THRESHOLDS = {
  temperature: [15, 16, 18, 19, 20, 21, 23, 24, 25, 26, 28],
  humidity: [25, 30, 35, 40, 42, 58, 60, 65, 70, 75],
  co2: [400, 800, 1000, 1200, 1600, 2000],
  pm25: [5, 15, 25, 35, 50],
};

// The enumerated options, with their real domains. Every one of these is also generated
// slightly wrong, through typo() — which is how `value_dsc`, `Auto`, `shortt` and `hidee`
// get tried without anybody listing them.
const ENUMS = {
  room_sort: ["configured", "name", "value_asc", "value_desc"],
  room_label: ["auto", "short", "name"],
  show_rooms: ["auto", true, false],
  unavailable_values: ["show", "hide"],
  subtitle_overflow: ["clip", "wrap"],
};

// Per-view options, exactly as the view definitions declare them.
const VIEW_OPTIONS = {
  range: { show_time: "bool" },
  range_scale: {
    show_comfort_band: "bool",
    show_optimal_band: "bool",
    footer: ["compact", "detailed", false],
  },
  scale: {
    show_comfort_band: "bool",
    show_optimal_band: "bool",
    footer: "bool",
    markers: ["average", "extremes", "all"],
  },
  extremes: { show_value: "bool" },
};

// ---------------------------------------------------------------------- the weights --

// One place. generators.test.js measures every one of these.
const WEIGHTS = {
  // ---- entities ----
  stateKind: [
    [78, "number"],
    [6, "unavailable"],
    [4, "unknown"],
    [3, "missing"],
    [9, "malformed"],
  ],
  valueBand: [
    [66, "typical"],
    [14, "threshold"],
    [8, "wide"],
    [7, "impossible"],
    [5, "absurd"],
  ],
  unitValue: [
    [64, "canonical"],
    [11, "sameMetric"],
    [8, "otherMetric"],
    [9, "otherDomain"],
    [5, "nonHomeAssistant"],
    [3, "missing"],
  ],
  unitKey: [
    [95, "correct"],
    [3, "curatedTypo"],
    [2, "mechanicalTypo"],
  ],
  deviceClassValue: [
    [74, "correct"],
    [10, "missing"],
    [8, "foreign"],
    [5, "curatedTypo"],
    [3, "mechanicalTypo"],
  ],
  deviceClassKey: [
    [95, "correct"],
    [3, "curatedTypo"],
    [2, "mechanicalTypo"],
  ],
  // ---- card shape ----
  roomCount: [
    [10, "none"],
    [45, "few"],
    [30, "several"],
    [15, "many"],
  ],
  primary: [
    [82, "configured"],
    [18, "absent"],
  ],
  unitAgreement: [
    [76, "uniform"],
    [16, "twoUnits"],
    [8, "perRoom"],
  ],
  // ---- configuration ----
  palette: [
    [42, "default"],
    [24, "builtin"],
    [18, "monochrome"],
    [8, "written"],
    [5, "broken"],
    [3, "misspelledName"],
  ],
  views: [
    [64, "default"],
    [20, "subset"],
    [7, "duplicated"],
    [5, "misspelled"],
    [4, "degenerate"],
  ],
  language: [
    [58, "common"],
    [36, "anySupported"],
    [6, "unsupported"],
  ],
  roomName: [
    [82, "plain"],
    [18, "awkward"],
  ],
  // How an option's VALUE is written when the option is present at all.
  optionValue: [
    [80, "valid"],
    [12, "misspelled"],
    [8, "wrongType"],
  ],
  // Whether a numeric option is sensible.
  numberValue: [
    [72, "sensible"],
    [12, "zeroOrNegative"],
    [10, "huge"],
    [6, "notANumber"],
  ],
  action: [
    [70, "valid"],
    [14, "unknownAction"],
    [10, "malformed"],
    [6, "misspelled"],
  ],
};

// How often each OPTIONAL configuration key appears at all. Separate from WEIGHTS because
// these are independent coin flips rather than a choice between alternatives — a card can
// carry any combination of them, and combinations are the point.
const OPTION_PRESENCE = {
  title: 0.14,
  entity_label: 0.1,
  icon: 0.08,
  subtitle: 0.2,
  decimals: 0.12,
  hide_footer: 0.08,
  auto_slide: 0.1,
  swipe: 0.08,
  rotation_seconds: 0.1,
  slide_seconds: 0.08,
  room_columns: 0.1,
  room_rows: 0.08,
  room_sort: 0.12,
  room_label: 0.1,
  show_rooms: 0.12,
  unavailable_values: 0.1,
  start_view: 0.08,
  tap_action: 0.1,
  hold_action: 0.07,
  view_options: 0.14,
  classification: 0.08,
  range_entity: 0.1,
  trend_entity: 0.08,
  // A key nobody meant to write. The card takes unknown top-level keys in silence today,
  // which is RCC-BUG-04 — so generating them is how the run keeps proving it.
  misspelledKey: 0.06,
};

// ------------------------------------------------------------------------ machinery --

// Draws from a [[weight, label], …] table. The table is not normalised in advance on
// purpose: a weight added without adjusting the others should just work.
function weighted(rng, table) {
  const total = table.reduce((sum, [weight]) => sum + weight, 0);
  let roll = rng.float() * total;
  for (const [weight, label] of table) {
    roll -= weight;
    if (roll < 0) return label;
  }
  return table[table.length - 1][1];
}

// One enum value, written correctly, misspelled, or as something that is not a string.
function enumValue(rng, allowed) {
  switch (weighted(rng, WEIGHTS.optionValue)) {
    case "misspelled": {
      const valid = rng.pick(allowed);
      return typeof valid === "string" ? V.typo(rng, valid) : !valid;
    }
    case "wrongType":
      return rng.pick([42, true, null, [], { value: "x" }, ""]);
    default:
      return rng.pick(allowed);
  }
}

function numberValue(rng, low, high) {
  switch (weighted(rng, WEIGHTS.numberValue)) {
    case "zeroOrNegative":
      return rng.pick([0, -1, -0.5, -9999]);
    case "huge":
      return rng.pick([1e6, 1e12, Number.MAX_SAFE_INTEGER, 1e308]);
    case "notANumber":
      return rng.pick(["3", "three", "", null, true, NaN, []]);
    default:
      return rng.number(low, high, 1);
  }
}

function boolValue(rng) {
  // YAML gives real booleans; a person copying an example gives the strings.
  return weighted(rng, WEIGHTS.optionValue) === "valid" ? rng.bool(0.5) : rng.pick(["true", "false", "yes", 1, 0, "on"]);
}

// ----------------------------------------------------------------- entity generation --

function generateValue(rng, metric, band) {
  const range = VALUE_BANDS[metric];
  switch (band) {
    case "threshold":
      return rng.pick(THRESHOLDS[metric]);
    case "wide":
      return rng.number(range.wide[0], range.wide[1], 2);
    case "impossible":
      return rng.number(range.impossible[0], range.impossible[1], 2);
    case "absurd":
      return rng.pick(V.ABSURD_NUMBERS);
    default:
      return rng.number(range.typical[0], range.typical[1], 2);
  }
}

function generateUnit(rng, metric, choice, forcedValue) {
  if (choice === "missing") return null;
  let key;
  switch (weighted(rng, WEIGHTS.unitKey)) {
    case "curatedTypo":
      key = rng.pick(V.MISSPELLED_UNIT_KEYS);
      break;
    case "mechanicalTypo":
      key = V.typo(rng, "unit_of_measurement");
      break;
    default:
      key = undefined;
  }

  let value;
  if (forcedValue !== undefined) value = forcedValue;
  else if (choice === "sameMetric" && SAME_METRIC_UNITS[metric].length) value = rng.pick(SAME_METRIC_UNITS[metric]);
  else if (choice === "otherMetric") value = rng.pick(otherMetricUnits(metric));
  else if (choice === "otherDomain") value = rng.pick(OTHER_DOMAIN_UNITS);
  else if (choice === "nonHomeAssistant") value = rng.pick(V.NON_HA_UNITS);
  else value = METRICS[metric].canonicalUnit;

  return key === undefined ? { value } : { key, value };
}

function generateDeviceClass(rng, metric) {
  const choice = weighted(rng, WEIGHTS.deviceClassValue);
  if (choice === "missing") return null;

  let key;
  switch (weighted(rng, WEIGHTS.deviceClassKey)) {
    case "curatedTypo":
      key = rng.pick(V.MISSPELLED_DEVICE_CLASS_KEYS);
      break;
    case "mechanicalTypo":
      key = V.typo(rng, "device_class");
      break;
    default:
      key = undefined;
  }

  let value;
  if (choice === "foreign") value = rng.pick(V.FOREIGN_DEVICE_CLASSES);
  else if (choice === "curatedTypo") value = rng.pick(V.MISSPELLED_DEVICE_CLASS_VALUES[metric]);
  else if (choice === "mechanicalTypo") value = V.typo(rng, METRICS[metric].deviceClass);
  else value = METRICS[metric].deviceClass;

  return key === undefined ? { value } : { key, value };
}

function generateEntity(rng, metric, { unitChoice, forcedUnitValue }) {
  const entity = {};
  const kind = weighted(rng, WEIGHTS.stateKind);
  if (kind === "missing") entity.present = false;
  if (kind === "unavailable") entity.state = "unavailable";
  else if (kind === "unknown") entity.state = "unknown";
  else if (kind === "malformed") entity.state = rng.pick(V.MALFORMED_STATES);
  else entity.state = generateValue(rng, metric, weighted(rng, WEIGHTS.valueBand));

  entity.unit = generateUnit(rng, metric, unitChoice, forcedUnitValue);
  entity.deviceClass = generateDeviceClass(rng, metric);

  // Attributes the card reads for the range and trend views, on the entity itself. Rare,
  // because most sensors do not carry them, and worth generating because the ones that do
  // are where the range view gets its numbers.
  if (rng.bool(0.06)) {
    entity.extraAttributes = {
      minimum: rng.number(-30, 20, 1),
      maximum: rng.number(20, 60, 1),
      ...(rng.bool(0.5) ? { minimum_timestamp: "2026-08-23T06:00:00" } : {}),
      ...(rng.bool(0.3) ? { maximum_timestamp: "not-a-timestamp" } : {}),
    };
  }
  return entity;
}

// ------------------------------------------------------------------ card generation --

function generatePalette(rng) {
  switch (weighted(rng, WEIGHTS.palette)) {
    case "builtin":
      return rng.pick(PALETTE_KEYS);
    case "misspelledName":
      return V.typo(rng, rng.pick(PALETTE_KEYS));
    case "monochrome":
      return rng.pick([
        "red",
        "yellow",
        "black",
        "white",
        "navy",
        "teal",
        "gold",
        "deeppink",
        "rebeccapurple",
        "#1DB85D",
        "1DB85D",
        "#1db85d80",
        123456,
        8000,
        0,
      ]);
    case "written":
      // A palette written out in YAML is a CUSTOM palette: the card must never adapt it to
      // the background, whatever it looks like there. Generated in every shape the contract
      // allows — one colour, one wing, both wings, an explicit invalid colour.
      return rng.pick([
        { optimal: "#3D9970" },
        { optimal: "#3D9970", above: ["#FFDC00", "#FF851B"] },
        { optimal: "black", above: ["lightgreen", "darkgreen", "lime"], below: ["red", "deeppink"] },
        { optimal: "#3D9970", above: ["#FFDC00"], below: ["#7FDBFF"], invalid: "#999999" },
        { optimal: "#000000", above: ["#0C0C0C"], below: ["#111111"] },
      ]);
    case "broken":
      // Deliberately invalid: setConfig must refuse this ATOMICALLY, leaving the previous
      // configuration intact rather than a half-applied one.
      return rng.pick([
        { optimal: "not-a-colour" },
        { above: ["#FFF"] },
        { optimal: "#FFF", nonsense: 1 },
        { optimal: "#FFF", above: "#000" },
        "definitely-not-a-palette",
        [],
        1234567,
        -1,
        1.5,
      ]);
    default:
      return undefined;
  }
}

function generateViews(rng) {
  switch (weighted(rng, WEIGHTS.views)) {
    case "subset": {
      // An AUTHORITATIVE list: whatever it names is what the card shows, and it is perfectly
      // allowed to leave `scale` out. An earlier property test asserted that `scale` appeared
      // exactly once, which is simply not true of this configuration.
      const count = rng.int(1, VIEWS.length);
      const shuffled = [...VIEWS].sort(() => rng.float() - 0.5);
      const chosen = shuffled.slice(0, count);
      // Sometimes as objects with options rather than bare strings — both are accepted.
      return chosen.map((type) => (rng.bool(0.25) ? { type, options: generateViewOptions(rng, type) } : type));
    }
    case "duplicated":
      return [rng.pick(VIEWS), rng.pick(VIEWS), rng.pick(VIEWS)];
    case "misspelled":
      return [V.typo(rng, rng.pick(VIEWS)), ...(rng.bool(0.5) ? [rng.pick(VIEWS)] : [])];
    case "degenerate":
      return rng.pick([[], ["nope"], [rng.pick(VIEWS), "nope"], "scale", [null], [""], [{}], [{ type: 42 }], {}]);
    default:
      return undefined;
  }
}

function generateViewOptions(rng, type) {
  const schema = VIEW_OPTIONS[type];
  if (!schema) return { anything: true };
  const options = {};
  for (const [name, domain] of Object.entries(schema)) {
    if (!rng.bool(0.6)) continue;
    options[domain === "bool" ? name : name] = domain === "bool" ? boolValue(rng) : enumValue(rng, domain);
  }
  // An option the view does not have. The card diagnoses and drops these rather than
  // failing, and the run should keep proving it.
  if (rng.bool(0.15)) options[V.typo(rng, Object.keys(schema)[0] || "option")] = true;
  return options;
}

function generateAction(rng) {
  switch (weighted(rng, WEIGHTS.action)) {
    case "unknownAction":
      return { action: rng.pick(["explode", "more_info", "MORE-INFO", "", null]) };
    case "misspelled":
      return { action: V.typo(rng, rng.pick(V.VALID_ACTIONS)) };
    case "malformed":
      return rng.pick(["more-info", 42, [], { nothing: true }, { action: {} }, null]);
    default: {
      const action = rng.pick(V.VALID_ACTIONS);
      if (action === "navigate") return { action, navigation_path: rng.pick(["/lovelace/0", "", 42]) };
      if (action === "url") return { action, url_path: rng.pick(["https://example.invalid", "javascript:alert(1)", ""]) };
      if (action === "perform-action") return { action, perform_action: rng.pick(["light.turn_on", "", "nonsense"]) };
      return { action };
    }
  }
}

function generateSubtitle(rng) {
  // Three shapes, and the two words that are reserved. `subtitle: clip` sets the WRAPPING;
  // `subtitle: Ground floor` sets the TEXT. Getting one of those two words slightly wrong
  // therefore changes the meaning completely — `clipp` is text, `clip` is a mode — which is
  // exactly the kind of thing worth generating.
  switch (rng.int(0, 5)) {
    case 0:
      return rng.pick(ENUMS.subtitle_overflow);
    case 1:
      return V.typo(rng, rng.pick(ENUMS.subtitle_overflow));
    case 2:
      return rng.pick(V.AWKWARD_TEXT);
    case 3:
      return { text: rng.pick(V.AWKWARD_TEXT), overflow: enumValue(rng, ENUMS.subtitle_overflow) };
    case 4:
      return rng.pick(["", " ", null, 42, true, [], { text: 1 }, { overflow: "clip" }, { text: "x", nope: 1 }]);
    default:
      return rng.pick(["Erdgeschoss", "Ground floor", "1. OG"]);
  }
}

function generateClassification(rng) {
  // The heaviest configuration surface the card has. Generated in the shapes that matter:
  // a source override, a named profile, and a written-out tier ramp — including one that
  // breaks the ramp contract, which must be refused rather than silently coloured wrong.
  switch (rng.int(0, 4)) {
    case 0:
      return { source: rng.pick(["auto", "entity", "card", V.typo(rng, "entity")]) };
    case 1:
      return { profile: rng.pick(["celsius", "fahrenheit", "indoor", V.typo(rng, "celsius"), 42]) };
    case 2:
      return {
        profile: {
          tiers: [
            { min: 26, score: 2, level: "warm", zone: "outside" },
            { min: 20, score: 0, level: "ok", zone: "optimal" },
            { score: -2, level: "cold", zone: "outside" },
          ],
        },
      };
    case 3:
      // A ramp whose scores do not descend. The card refuses this; before it did, an
      // optimal reading could be painted in the most extreme colour of the palette.
      return {
        profile: {
          tiers: [
            { min: 26, score: 1, level: "warm", zone: "outside" },
            { min: 20, score: 5, level: "ok", zone: "optimal" },
            { score: -1, level: "cold", zone: "outside" },
          ],
        },
      };
    default:
      return { profile: { bands: { comfort: { min: 20, max: 24 }, optimal: { min: 21, max: 23 } } } };
  }
}

function generateRoomCount(rng) {
  switch (weighted(rng, WEIGHTS.roomCount)) {
    case "none":
      return 0;
    case "several":
      return rng.int(5, 8);
    case "many":
      return rng.int(9, 12);
    default:
      return rng.int(1, 4);
  }
}

function generateLanguage(rng) {
  switch (weighted(rng, WEIGHTS.language)) {
    case "anySupported":
      return rng.pick(LANGUAGES);
    case "unsupported":
      return rng.pick(["xx", "de-CH", "", "EN", "zz-ZZ", "de_DE", 42]);
    default:
      return rng.pick(["en", "de"]);
  }
}

// Everything that is not an entity: the rest of the YAML surface, each key an independent
// coin flip so that COMBINATIONS happen rather than one option at a time.
function generateConfig(rng) {
  const config = {};
  const has = (key) => rng.bool(OPTION_PRESENCE[key]);

  if (has("title")) config.title = rng.pick(V.AWKWARD_TEXT);
  if (has("entity_label")) config.entity_label = rng.pick(V.AWKWARD_TEXT);
  if (has("icon")) config.icon = rng.pick(["mdi:thermometer", "mdi:nonexistent-icon", "", "thermometer", 42]);
  if (has("subtitle")) config.subtitle = generateSubtitle(rng);
  if (has("decimals")) config.decimals = numberValue(rng, 0, 3);
  if (has("hide_footer")) config.hide_footer = boolValue(rng);
  if (has("auto_slide")) config.auto_slide = boolValue(rng);
  if (has("swipe")) config.swipe = boolValue(rng);
  if (has("rotation_seconds")) config.rotation_seconds = numberValue(rng, 2, 30);
  if (has("slide_seconds")) config.slide_seconds = numberValue(rng, 0.1, 2);
  if (has("room_columns")) config.room_columns = numberValue(rng, 1, 6);
  if (has("room_rows")) config.room_rows = numberValue(rng, 1, 4);
  if (has("room_sort")) config.room_sort = enumValue(rng, ENUMS.room_sort);
  if (has("room_label")) config.room_label = enumValue(rng, ENUMS.room_label);
  if (has("show_rooms")) config.show_rooms = enumValue(rng, ENUMS.show_rooms);
  if (has("unavailable_values")) config.unavailable_values = enumValue(rng, ENUMS.unavailable_values);
  if (has("start_view")) config.start_view = enumValue(rng, VIEWS);
  if (has("tap_action")) config.tap_action = generateAction(rng);
  if (has("hold_action")) config.hold_action = generateAction(rng);
  if (has("classification")) config.classification = generateClassification(rng);
  if (has("range_entity")) config.range_entity = rng.pick(["sensor.range", "sensor.missing", "", 42]);
  if (has("trend_entity")) config.trend_entity = rng.pick(["sensor.trend", "sensor.missing", "", 42]);
  if (has("misspelledKey")) config[rng.pick(V.MISSPELLED_CONFIG_KEYS)] = rng.pick(["vivid", true, 1, []]);

  return config;
}

// The auxiliary entities the configuration may point at, so that `range_entity` and
// `trend_entity` sometimes resolve to something real rather than always to a hole.
function auxiliaryEntities(rng, config, metric) {
  const extras = [];
  const unit = METRICS[metric].canonicalUnit;
  if (config.range_entity === "sensor.range") {
    extras.push({
      id: "sensor.range",
      state: rng.number(1, 12, 1),
      unit: { value: unit },
      deviceClass: null,
      extraAttributes: {
        minimum: rng.number(-10, 18, 1),
        maximum: rng.number(19, 40, 1),
        ...(rng.bool(0.5) ? { minimum_timestamp: "2026-08-23T06:00:00" } : {}),
      },
    });
  }
  if (config.trend_entity === "sensor.trend") {
    extras.push({ id: "sensor.trend", state: rng.pick([-1.5, 0, 1.5, "unavailable"]), unit: { value: `${unit}/h` }, deviceClass: null });
  }
  return extras;
}

// The one entry point. Returns a plain description; nothing here touches the card.
function generateDescription(seedOrRng) {
  const rng = typeof seedOrRng === "number" ? new SeededRandom(seedOrRng) : seedOrRng;
  const metric = rng.pick(METRIC_KINDS);

  const agreement = weighted(rng, WEIGHTS.unitAgreement);
  const unitChoice = weighted(rng, WEIGHTS.unitValue);
  // With "uniform" every entity is handed the same unit VALUE, so the card sees one
  // measurement; "twoUnits" mixes two units of the same metric, which the card must convert;
  // "perRoom" lets every room draw its own, which is where the incompatible combinations
  // live — °C beside % beside K on one card.
  const uniformUnit =
    agreement === "uniform" && unitChoice !== "missing" ? generateUnit(rng, metric, unitChoice).value : undefined;
  const twoUnits =
    agreement === "twoUnits"
      ? [METRICS[metric].canonicalUnit, ...SAME_METRIC_UNITS[metric], ...otherMetricUnits(metric)].slice(0, 2)
      : null;

  const unitFor = (index) => {
    if (agreement === "uniform") return { unitChoice, forcedUnitValue: uniformUnit };
    if (agreement === "twoUnits") return { unitChoice, forcedUnitValue: twoUnits[index % twoUnits.length] };
    return { unitChoice: weighted(rng, WEIGHTS.unitValue), forcedUnitValue: undefined };
  };

  const roomCount = generateRoomCount(rng);
  const rooms = [];
  for (let index = 0; index < roomCount; index++) {
    const room = generateEntity(rng, metric, unitFor(index + 1));
    if (weighted(rng, WEIGHTS.roomName) === "awkward") room.name = rng.pick(V.AWKWARD_TEXT);
    if (rng.bool(0.12)) room.short = rng.pick(["R1", "", "LongShortName", 42, null]);
    if (rng.bool(0.06)) room.tap_action = generateAction(rng);
    rooms.push(room);
  }

  const config = generateConfig(rng);
  const palette = generatePalette(rng);
  if (palette !== undefined) config.palette = palette;
  const views = generateViews(rng);
  if (views !== undefined) config.views = views;
  if (rng.bool(OPTION_PRESENCE.view_options)) {
    const type = rng.pick(VIEWS);
    config.view_options = { [rng.bool(0.85) ? type : V.typo(rng, type)]: generateViewOptions(rng, type) };
  }

  const description = {
    metric,
    language: generateLanguage(rng),
    primary: weighted(rng, WEIGHTS.primary) === "absent" ? null : generateEntity(rng, metric, unitFor(0)),
    rooms,
    extras: auxiliaryEntities(rng, config, metric),
    config,
  };

  // A card with neither a primary entity nor a room is not a card. It is also not
  // interesting: setConfig refuses it, and config-validation.test.js already says so
  // precisely. Give it the one thing it needs to be a card at all.
  if (!description.primary && description.rooms.length === 0) {
    description.primary = generateEntity(rng, metric, unitFor(0));
  }

  return description;
}

module.exports = {
  generateDescription,
  generateConfig,
  generateAction,
  generateSubtitle,
  generateViews,
  weighted,
  WEIGHTS,
  OPTION_PRESENCE,
  ENUMS,
  VIEW_OPTIONS,
  OTHER_DOMAIN_UNITS,
  SAME_METRIC_UNITS,
};
