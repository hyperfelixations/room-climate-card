"use strict";

// WEIGHTED GENERATORS over scenario descriptions.
//
// The point of a property test is not to try strange things; it is to try ORDINARY things
// in strange COMBINATIONS, and occasionally something strange as well. A generator that
// draws uniformly from an extreme set spends its whole budget in territory no user ever
// reaches, and a generator that only draws sensible values never finds anything. So every
// axis below is weighted: mostly what a dashboard really looks like, sometimes a mistake
// someone really makes, rarely something absurd.
//
// EVERY AXIS IS NAMED AND WEIGHTED IN ONE PLACE. WEIGHTS is exported and
// generators.test.js measures the realised distribution against it. A generator whose
// weights have drifted from its intent is exactly the failure this suite has already had
// once — the previous randomized test drew fine and asserted nothing, because its entities
// were missing a unit and every card it built landed in the no-data state. Nothing
// measured that, so nothing reported it for five hundred iterations.
//
// WHAT COMES OUT IS A DESCRIPTION, NOT A CARD. Everything here emits plain JSON for
// test/fixtures/scenario.js. That is what makes a failure reportable: the case prints, it
// shrinks structurally (see shrink.js), and the minimised result is a fixture a person can
// paste into a hand-written test unchanged.

const { SeededRandom } = require("../helpers/seeded-random.js");
const { METRICS, METRIC_KINDS, LANGUAGES, PALETTE_KEYS, VIEWS } = require("../contracts/product-surface.js");

// --------------------------------------------------------------------- the tables --

// Real Home Assistant units, taken from the sensor device-class table in the HA developer
// documentation. They are deliberately REAL rather than invented: a template sensor that
// reports irradiance in W/m² with device_class temperature is a mistake someone actually
// makes, and "qwerty" is not.
const FOREIGN_UNITS = ["W/m²", "lx", "hPa", "dB", "dBA", "kWh", "mm/h", "psi", "W", "BTU/(h⋅ft²)"];
const FOREIGN_DEVICE_CLASSES = ["power", "illuminance", "atmospheric_pressure", "energy", "sound_pressure"];

// Alternative units that are still valid for the same measurement.
const SAME_METRIC_UNITS = { temperature: ["°F", "K"], humidity: [], co2: [], pm25: [] };

// The canonical unit of each OTHER metric the card knows: a plausible copy-paste error.
function otherMetricUnits(metric) {
  return METRIC_KINDS.filter((kind) => kind !== metric).map((kind) => METRICS[kind].canonicalUnit);
}

// Spellings a person produces in a template sensor at two in the morning.
const MISSPELLED_DEVICE_CLASS_KEYS = ["device_clas", "deviceclass", "Device_Class", "device-class"];
const MISSPELLED_UNIT_KEYS = ["unit_of_measure", "unit_of_measurment", "Unit_of_measurement", "unit"];
const MISSPELLED_DEVICE_CLASS_VALUES = {
  temperature: ["temperatur", "Temperature", "TEMPERATURE", "temp"],
  humidity: ["humidty", "Humidity", "moisture", "humidite"],
  co2: ["carbon_dioxid", "co2", "CO2", "carbondioxide"],
  pm25: ["pm2_5", "pm2.5", "PM25", "particulate_matter_25"],
};

// Where each metric actually lives, where it plausibly lives, and where it cannot.
const VALUE_BANDS = {
  temperature: { typical: [-20, 45], wide: [-60, 100], impossible: [-400, -274], step: 0.1 },
  humidity: { typical: [0, 100], wide: [0, 100], impossible: [-50, -0.01], step: 0.1 },
  co2: { typical: [350, 2500], wide: [1, 50000], impossible: [-1000, 0], step: 1 },
  pm25: { typical: [0, 60], wide: [0, 1000], impossible: [-100, -0.01], step: 0.1 },
};

// Values that sit exactly on a classification threshold, where a `>` and a `>=` disagree.
const THRESHOLDS = {
  temperature: [15, 16, 18, 19, 20, 21, 23, 24, 25, 26, 28],
  humidity: [25, 30, 35, 40, 42, 58, 60, 65, 70, 75],
  co2: [400, 800, 1000, 1200, 1600, 2000],
  pm25: [5, 15, 25, 35, 50],
};

// Numbers that are numbers in the sense that `typeof` says so, and nothing else.
const ABSURD_NUMBERS = [1000, -1000, 1e9, -1e9, 1e308, -1e308, 5e-324, -0, 0.1 + 0.2, 2 ** 53 + 1];

// States that are not numbers at all. Every one of these has been seen in a real
// `hass.states` — an unrendered template gives "", a decimal comma gives "1,5", a sensor
// that appends its own unit gives "21 °C".
const MALFORMED_STATES = ["", "none", "None", "null", "NaN", "Infinity", "-", "1,5", "21 °C", "true", "unknown "];

// Names that break layout, encoding, or markup if anything is careless.
const AWKWARD_NAMES = [
  "Küche",
  "Wohnzimmer im Erdgeschoss hinten links",
  "غرفة النوم",
  "리빙룸",
  "客厅",
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "Room\u0000Zero", // a control character, which a broken template can produce
  "  ",
  "🛏️🛁",
  "R".repeat(120),
];

// ---------------------------------------------------------------------- the weights --

// One place. generators.test.js measures every one of these.
const WEIGHTS = {
  // What state an entity is in at all.
  stateKind: [
    [80, "number"],
    [6, "unavailable"],
    [4, "unknown"],
    [3, "missing"],
    [7, "malformed"],
  ],
  // Where in its range a numeric value falls.
  valueBand: [
    [68, "typical"],
    [14, "threshold"],
    [8, "wide"],
    [6, "impossible"],
    [4, "absurd"],
  ],
  unitValue: [
    [70, "canonical"],
    [12, "sameMetric"],
    [8, "otherMetric"],
    [6, "foreign"],
    [4, "missing"],
  ],
  unitKey: [
    [96, "correct"],
    [4, "misspelled"],
  ],
  deviceClassValue: [
    [78, "correct"],
    [10, "missing"],
    [7, "foreign"],
    [5, "misspelled"],
  ],
  deviceClassKey: [
    [96, "correct"],
    [4, "misspelled"],
  ],
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
  // Whether every entity on the card agrees about its unit.
  unitAgreement: [
    [80, "uniform"],
    [15, "twoUnits"],
    [5, "perRoom"],
  ],
  palette: [
    [45, "default"],
    [25, "builtin"],
    [18, "monochrome"],
    [7, "inline"],
    [5, "broken"],
  ],
  views: [
    [70, "default"],
    [18, "subset"],
    [7, "duplicated"],
    [5, "degenerate"],
  ],
  language: [
    [60, "common"],
    [36, "anySupported"],
    [4, "unsupported"],
  ],
  roomName: [
    [85, "plain"],
    [15, "awkward"],
  ],
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
      return rng.pick(ABSURD_NUMBERS);
    case "typical":
    default:
      return rng.number(range.typical[0], range.typical[1], 2);
  }
}

function generateUnit(rng, metric, choice, forcedValue) {
  if (choice === "missing") return null;
  const key = weighted(rng, WEIGHTS.unitKey) === "correct" ? undefined : rng.pick(MISSPELLED_UNIT_KEYS);
  let value;
  if (forcedValue !== undefined) value = forcedValue;
  else if (choice === "sameMetric" && SAME_METRIC_UNITS[metric].length) value = rng.pick(SAME_METRIC_UNITS[metric]);
  else if (choice === "otherMetric") value = rng.pick(otherMetricUnits(metric));
  else if (choice === "foreign") value = rng.pick(FOREIGN_UNITS);
  else value = METRICS[metric].canonicalUnit;
  return key === undefined ? { value } : { key, value };
}

function generateDeviceClass(rng, metric) {
  const choice = weighted(rng, WEIGHTS.deviceClassValue);
  if (choice === "missing") return null;
  const key = weighted(rng, WEIGHTS.deviceClassKey) === "correct" ? undefined : rng.pick(MISSPELLED_DEVICE_CLASS_KEYS);
  let value;
  if (choice === "foreign") value = rng.pick(FOREIGN_DEVICE_CLASSES);
  else if (choice === "misspelled") value = rng.pick(MISSPELLED_DEVICE_CLASS_VALUES[metric]);
  else value = METRICS[metric].deviceClass;
  return key === undefined ? { value } : { key, value };
}

function generateEntity(rng, metric, { unitChoice, forcedUnitValue }) {
  const entity = {};
  const kind = weighted(rng, WEIGHTS.stateKind);
  if (kind === "missing") entity.present = false;
  if (kind === "unavailable") entity.state = "unavailable";
  else if (kind === "unknown") entity.state = "unknown";
  else if (kind === "malformed") entity.state = rng.pick(MALFORMED_STATES);
  else entity.state = generateValue(rng, metric, weighted(rng, WEIGHTS.valueBand));

  entity.unit = generateUnit(rng, metric, unitChoice, forcedUnitValue);
  entity.deviceClass = generateDeviceClass(rng, metric);
  return entity;
}

// ------------------------------------------------------------------ card generation --

function generatePalette(rng) {
  switch (weighted(rng, WEIGHTS.palette)) {
    case "builtin":
      return rng.pick(PALETTE_KEYS);
    case "monochrome":
      return rng.pick(["red", "yellow", "black", "white", "navy", "teal", "gold", "#1DB85D", "1DB85D", 123456, 0]);
    case "inline":
      return {
        optimal: "#3D9970",
        above: ["#FFDC00", "#FF851B"],
        below: rng.bool(0.5) ? ["#7FDBFF", "#0074D9"] : undefined,
      };
    case "broken":
      // Deliberately invalid: setConfig must refuse this ATOMICALLY, leaving the previous
      // configuration intact rather than a half-applied one.
      return rng.pick([{ optimal: "not-a-colour" }, { above: ["#FFF"] }, "definitely-not-a-palette", [], 1234567]);
    default:
      return undefined;
  }
}

function generateViews(rng) {
  switch (weighted(rng, WEIGHTS.views)) {
    case "subset": {
      // An AUTHORITATIVE list: whatever it names is what the card shows, and it is
      // perfectly allowed to leave `scale` out. An earlier property test asserted that
      // `scale` appeared exactly once, which is simply not true of this configuration.
      const count = rng.int(1, VIEWS.length);
      const shuffled = [...VIEWS].sort(() => rng.float() - 0.5);
      return shuffled.slice(0, count);
    }
    case "duplicated":
      return [rng.pick(VIEWS), rng.pick(VIEWS), rng.pick(VIEWS)];
    case "degenerate":
      return rng.pick([[], ["nope"], [rng.pick(VIEWS), "nope"], "scale", [null], [""]]);
    default:
      return undefined;
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
      return rng.pick(["xx", "de-CH", "", "EN", "zz-ZZ"]);
    default:
      return rng.pick(["en", "de"]);
  }
}

function generateExtras(rng) {
  const config = {};
  if (rng.bool(0.18)) config.subtitle = rng.pick(["clip", "wrap", "A fixed subtitle", ""]);
  if (rng.bool(0.12)) config.title = rng.pick(["Klima", "<b>bold</b>", "T".repeat(80)]);
  if (rng.bool(0.1)) config.view_options = { scale: { footer: rng.bool(0.5), markers: rng.pick(["extremes", "rooms", "none"]) } };
  if (rng.bool(0.08)) config.tap_action = rng.pick([{ action: "more-info" }, { action: "none" }, { action: "nonsense" }]);
  if (rng.bool(0.06)) {
    config.classification = {
      tiers: [
        { min: 26, score: 2, level: "warm", zone: "outside" },
        { min: 20, score: 0, level: "ok", zone: "optimal" },
        { score: -2, level: "cold", zone: "outside" },
      ],
    };
  }
  return config;
}

// The one entry point. Returns a plain description; nothing here touches the card.
function generateDescription(seedOrRng) {
  const rng = typeof seedOrRng === "number" ? new SeededRandom(seedOrRng) : seedOrRng;
  const metric = rng.pick(METRIC_KINDS);

  const agreement = weighted(rng, WEIGHTS.unitAgreement);
  const unitChoice = weighted(rng, WEIGHTS.unitValue);
  // With "uniform" every entity is handed the same unit VALUE, so the card sees one
  // measurement; "twoUnits" mixes two units of the same metric, which the card must
  // convert; "perRoom" lets every room draw its own, which is where the incompatible
  // combinations live.
  const uniformUnit =
    agreement === "uniform" && unitChoice !== "missing"
      ? generateUnit(rng, metric, unitChoice).value
      : undefined;
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
    if (weighted(rng, WEIGHTS.roomName) === "awkward") room.name = rng.pick(AWKWARD_NAMES);
    rooms.push(room);
  }

  const description = {
    metric,
    language: generateLanguage(rng),
    primary: weighted(rng, WEIGHTS.primary) === "absent" ? null : generateEntity(rng, metric, unitFor(0)),
    rooms,
    config: generateExtras(rng),
  };

  const palette = generatePalette(rng);
  if (palette !== undefined) description.config.palette = palette;
  const views = generateViews(rng);
  if (views !== undefined) description.config.views = views;

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
  weighted,
  WEIGHTS,
  FOREIGN_UNITS,
  FOREIGN_DEVICE_CLASSES,
  MISSPELLED_DEVICE_CLASS_KEYS,
  MISSPELLED_UNIT_KEYS,
  MALFORMED_STATES,
  AWKWARD_NAMES,
  ABSURD_NUMBERS,
};
