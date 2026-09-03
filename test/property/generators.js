"use strict";

// Weighted generators over scenario descriptions: every axis draws mostly what a dashboard
// really looks like, sometimes a real mistake, rarely something absurd, and covers the whole
// YAML surface the card accepts. WEIGHTS is exported and measured by generators.test.js
// against the realised distribution. Output is a plain-JSON description for
// test/fixtures/scenario.js, not a card; it shrinks structurally (shrink.js).
// Rationale and the coverage guard: see interne Doku §4 „Die Property-Schicht".

const { SeededRandom } = require("../helpers/seeded-random.js");
const {
  METRICS,
  METRIC_KINDS,
  LANGUAGES,
  PALETTE_KEYS,
  VIEWS,
  VIEW_OPTIONS,
} = require("../manifests/product-surface.js");
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
  co2: { typical: [350, 2500], wide: [1, 50000], impossible: [-1000, -0.01] },
  pm25: { typical: [0, 60], wide: [0, 1000], impossible: [-100, -0.01] },
};

// Values that sit exactly on a classification threshold, where a `>` and a `>=` disagree.
const THRESHOLDS = {
  temperature: [15, 16, 18, 19, 20, 21, 23, 24, 25, 26, 28],
  humidity: [25, 30, 35, 40, 42, 58, 60, 65, 70, 75],
  co2: [400, 800, 1000, 1200, 1600, 2000],
  pm25: [5, 15, 25, 35, 50],
};

// The enumerated options with their real domains. Each is also generated slightly wrong via
// typo(), so misspellings get tried without being listed.
const ENUMS = {
  room_sort: ["configured", "name", "value_asc", "value_desc"],
  room_label: ["auto", "short", "name"],
  show_rooms: ["auto", true, false],
  unavailable_values: ["show", "hide"],
  header_overflow: ["clip", "wrap"],
  show_rooms_part: ["auto", true, false],
};

// The parts of the show: block that are simple switches. `rooms` is generated separately,
// because it is the one with a third answer.
const SHOW_SWITCH_KEYS = ["accent_line", "icon", "title", "subtitle", "entity_label", "pill", "panel", "unavailable_rooms"];

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
  // A card-configured id is whatever a person typed, not the `domain.object_id` lower-case
  // ASCII Home Assistant guarantees, so the card sees other shapes too.
  entityId: [
    [92, "conventional"],
    [8, "impossible"],
  ],
  // Which timestamps the sensor reports. The card compares them across renders, so none, or
  // a future time, tests a comparison it was not written for.
  timestamps: [
    [70, "identical"],
    [16, "normal"],
    [6, "missing"],
    [4, "future"],
    [4, "malformed"],
  ],
  // Extra attributes on the entity: the range view takes its numbers from them, and a
  // value colour on the entity overrides the palette.
  extraAttributes: [
    [88, "none"],
    [6, "plausible"],
    [6, "awkward"],
  ],
  // What the `hass` object is missing. Complete nearly always; an incomplete one is a
  // transient moment every card still lives through.
  hassShape: [
    [91, "complete"],
    [6, "oneGap"],
    [3, "twoGaps"],
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
  show: 0.16,
  start_view: 0.08,
  tap_action: 0.1,
  hold_action: 0.07,
  classification: 0.08,
  range_entity: 0.1,
  trend_entity: 0.08,
  // A key nobody meant to write; the card names it and suggests the intended option.
  misspelledKey: 0.06,
};

// ------------------------------------------------------------------------ machinery --

// Draws from a [[weight, label], …] table, not normalised in advance so a weight can be
// added without adjusting the others.
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
      return rng.pick(["3", "three", "", null, true, "NaN", []]);
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
  if (weighted(rng, WEIGHTS.entityId) === "impossible") entity.id = rng.pick(V.IMPOSSIBLE_ENTITY_IDS);
  entity.timestamps = weighted(rng, WEIGHTS.timestamps);
  const kind = weighted(rng, WEIGHTS.stateKind);
  if (kind === "missing") entity.present = false;
  if (kind === "unavailable") entity.state = "unavailable";
  else if (kind === "unknown") entity.state = "unknown";
  else if (kind === "malformed") entity.state = rng.pick(V.MALFORMED_STATES);
  else entity.state = generateValue(rng, metric, weighted(rng, WEIGHTS.valueBand));

  entity.unit = generateUnit(rng, metric, unitChoice, forcedUnitValue);
  entity.deviceClass = generateDeviceClass(rng, metric);

  // Attributes the card reads on the entity: the range view's numbers, and a value colour
  // that overrules the palette.
  const extras = weighted(rng, WEIGHTS.extraAttributes);
  if (extras === "plausible") {
    entity.extraAttributes = {
      minimum: rng.number(-30, 20, 1),
      maximum: rng.number(20, 60, 1),
      ...(rng.bool(0.5) ? { minimum_timestamp: "2026-08-23T06:00:00" } : {}),
      ...(rng.bool(0.3) ? { maximum_timestamp: "not-a-timestamp" } : {}),
    };
  } else if (extras === "awkward") {
    entity.extraAttributes = { ...rng.pick(V.AWKWARD_EXTRA_ATTRIBUTES) };
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
        "blue-red",
        "blue-green-red",
        "#1DB85D-#FD9808",
      ]);
    case "written":
      // A palette written out in YAML is a custom palette the card must never adapt to the
      // background. Generated in every shape the contract allows.
      return rng.pick([
        { optimal: "#3D9970" },
        { optimal: "#3D9970", above: ["#FFDC00", "#FF851B"] },
        { optimal: "black", above: ["lightgreen", "darkgreen", "lime"], below: ["red", "deeppink"] },
        { optimal: "#3D9970", above: ["#FFDC00"], below: ["#7FDBFF"], invalid: "#999999" },
        { optimal: "#000000", above: ["#0C0C0C"], below: ["#111111"] },
      ]);
    case "broken":
      // Deliberately invalid: setConfig must refuse it atomically, leaving the previous
      // configuration intact.
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
      // An authoritative list: whatever it names is what the card shows, and it may leave
      // `scale` out.
      const count = rng.int(1, VIEWS.length);
      const shuffled = [...VIEWS].sort(() => rng.float() - 0.5);
      const chosen = shuffled.slice(0, count);
      // Sometimes as objects with options rather than bare strings — both are accepted.
      return chosen.map((type) => {
        if (!rng.bool(0.4)) return type;
        return {
          type,
          ...(rng.bool(0.45) ? { enabled: rng.pick([true, false, "auto"]) } : {}),
          ...(rng.bool(0.75) ? { options: generateViewOptions(rng, type) } : {}),
        };
      });
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
  // An option the view does not have; the card diagnoses and drops it rather than failing.
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

// The show: block, in the shapes a person produces on the way to a working card. It overlaps
// three older top-level keys, and a card carrying both spellings with contradictory answers
// is generated on purpose to exercise the precedence rule.
function generateShow(rng) {
  switch (rng.int(0, 5)) {
    case 0:
      // Not an object at all, which is what `show:` alone produces in YAML.
      return rng.pick([null, "yes", 42, [], true]);
    case 1:
      // One part, correctly named, correctly valued — the ordinary case.
      return { [rng.pick(SHOW_SWITCH_KEYS)]: boolValue(rng) };
    case 2:
      // A part with a value that is not a boolean.
      return { [rng.pick(SHOW_SWITCH_KEYS)]: rng.pick(["yes", "no", 0, 1, "", null]) };
    case 3:
      // A key nobody meant to write, next to one that was.
      return { [V.typo(rng, rng.pick(SHOW_SWITCH_KEYS))]: true, [rng.pick(SHOW_SWITCH_KEYS)]: false };
    case 4:
      return { rooms: rng.pick([...ENUMS.show_rooms_part, "alway", "", 1]) };
    default: {
      // Several parts at once, which is the combination the layout has to survive.
      const block = {};
      for (const key of SHOW_SWITCH_KEYS) if (rng.bool(0.4)) block[key] = boolValue(rng);
      if (rng.bool(0.3)) block.rooms = rng.pick(ENUMS.show_rooms_part);
      return block;
    }
  }
}

function generateHeaderLine(rng) {
  // `subtitle: clip` sets the wrapping mode; `subtitle: Ground floor` sets the text. A slight
  // misspelling flips the meaning (`clipp` is text, `clip` a mode). Title takes the same shapes.
  switch (rng.int(0, 5)) {
    case 0:
      return rng.pick(ENUMS.header_overflow);
    case 1:
      return V.typo(rng, rng.pick(ENUMS.header_overflow));
    case 2:
      return rng.pick(V.AWKWARD_TEXT);
    case 3:
      return { text: rng.pick(V.AWKWARD_TEXT), overflow: enumValue(rng, ENUMS.header_overflow) };
    case 4:
      return rng.pick(["", " ", null, 42, true, [], { text: 1 }, { overflow: "clip" }, { text: "x", nope: 1 }]);
    default:
      return rng.pick(["Erdgeschoss", "Ground floor", "1. OG"]);
  }
}

function generateClassification(rng, metric) {
  // The heaviest configuration surface: a source override, a named profile, and a written-out
  // tier ramp, including one that breaks the ramp contract and must be refused.
  const validCustom = {
    source: "custom",
    unit: METRICS[metric].canonicalUnit,
    comparison: rng.bool(0.5) ? ">=" : ">",
    bands: { comfort: { min: 20, max: 80 }, optimal: { min: 40, max: 60 } },
    scale: { min: 0, max: 100, step: 5 },
    tiers: [
      { min: 80, score: 1, level: "high", zone: "outside" },
      { min: 40, score: 0, level: "ok", zone: "optimal" },
      { default: true, score: -1, level: "low", zone: "outside" },
    ],
  };
  switch (rng.int(0, 4)) {
    case 0:
      return rng.pick(["indoor", "outdoor", "fridge", V.typo(rng, "indoor")]);
    case 1:
      return { source: rng.pick(["auto", "entity", "profile", "card", V.typo(rng, "entity")]), profile: rng.pick(["indoor", "outdoor", "fridge", 42]) };
    case 2:
      return validCustom;
    case 3:
      // A ramp whose scores do not descend; the card must refuse it rather than paint an
      // optimal reading in the palette's most extreme colour.
      return { ...validCustom, tiers: validCustom.tiers.map((tier, index) => index === 1 ? { ...tier, score: 5 } : tier) };
    default:
      return { source: "custom", unit: METRICS[metric].canonicalUnit, tiers: [] };
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
function generateConfig(rng, metric) {
  const config = {};
  const has = (key) => rng.bool(OPTION_PRESENCE[key]);

  // The title takes the subtitle's shape, so it is generated the same way — including the
  // two reserved words, which mean the overflow mode here as well.
  if (has("title")) config.title = generateHeaderLine(rng);
  if (has("entity_label")) config.entity_label = rng.pick(V.AWKWARD_TEXT);
  if (has("icon")) config.icon = rng.pick(["mdi:thermometer", "mdi:nonexistent-icon", "", "thermometer", 42]);
  if (has("subtitle")) config.subtitle = generateHeaderLine(rng);
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
  if (has("show")) config.show = generateShow(rng);
  if (has("start_view")) config.start_view = enumValue(rng, VIEWS);
  if (has("tap_action")) config.tap_action = generateAction(rng);
  if (has("hold_action")) config.hold_action = generateAction(rng);
  if (has("classification")) config.classification = generateClassification(rng, metric);
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

// What Home Assistant hands the card, and what it sometimes does not. See the hassGaps note
// in test/fixtures/scenario.js for why each is a state a card really meets.
function generateHassShape(rng) {
  let shape;
  switch (weighted(rng, WEIGHTS.hassShape)) {
    case "oneGap":
      shape = { hassGaps: [rng.pick(V.HASS_GAPS)] };
      break;
    case "twoGaps": {
      const first = rng.pick(V.HASS_GAPS);
      const second = rng.pick(V.HASS_GAPS.filter((gap) => gap !== first));
      shape = { hassGaps: [first, second] };
      break;
    }
    default:
      shape = {};
  }
  // Theme and missing fields are independent; keeping them exclusive would make `theme + no
  // themes API` unreachable.
  if (rng.bool(0.03)) shape.theme = rng.bool(0.5) ? "dark" : "light";
  return shape;
}

function generateDescription(seedOrRng) {
  const rng = typeof seedOrRng === "number" ? new SeededRandom(seedOrRng) : seedOrRng;
  const metric = rng.pick(METRIC_KINDS);

  const agreement = weighted(rng, WEIGHTS.unitAgreement);
  const unitChoice = weighted(rng, WEIGHTS.unitValue);
  // "uniform" hands every entity the same unit value; "twoUnits" mixes two units of the metric
  // that the card must convert; "perRoom" lets each room draw its own, where the incompatible
  // combinations live (°C beside % beside K on one card).
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
    if (rng.bool(0.05)) room.hold_action = generateAction(rng);
    rooms.push(room);
  }

  const config = generateConfig(rng, metric);
  const palette = generatePalette(rng);
  if (palette !== undefined) config.palette = palette;
  const views = generateViews(rng);
  if (views !== undefined) config.views = views;

  const description = {
    metric,
    language: generateLanguage(rng),
    primary: weighted(rng, WEIGHTS.primary) === "absent" ? null : generateEntity(rng, metric, unitFor(0)),
    rooms,
    extras: auxiliaryEntities(rng, config, metric),
    ...generateHassShape(rng),
    config,
  };

  // The same sensor as the average and as a room: one entity in two roles, where a marker
  // could be drawn twice or an average could count a room it already counted.
  if (description.primary && description.rooms.length && rng.bool(0.05)) {
    const room = rng.int(0, description.rooms.length - 1);
    description.rooms[room] = { ...description.rooms[room], id: description.primary.id || "sensor.avg" };
  }

  // A card with neither a primary nor a room is refused by setConfig, and
  // config-validation.test.js already covers that. Give it the one thing it needs to be a card.
  if (!description.primary && description.rooms.length === 0) {
    description.primary = generateEntity(rng, metric, unitFor(0));
  }

  return description;
}

module.exports = {
  generateDescription,
  generateConfig,
  generateAction,
  generateHeaderLine,
  generateShow,
  generateViews,
  weighted,
  WEIGHTS,
  OPTION_PRESENCE,
  ENUMS,
  VIEW_OPTIONS,
  OTHER_DOMAIN_UNITS,
  SAME_METRIC_UNITS,
};
