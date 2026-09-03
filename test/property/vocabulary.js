"use strict";

// The reference vocabulary the generator draws from: every unit, spelling, mistake and
// malformed value a real dashboard can put in front of the card. Two kinds of wrongness:
// curated (mistakes a person makes, worth listing by hand) and mechanical (typo() below
// damages any valid token, so misspellings get tried without a curated list per token).

// ------------------------------------------------------------------------- units --

// Every unit Home Assistant's sensor device classes list, grouped as the docs group them.
// The card understands four groups and must survive the rest.
const HA_UNITS = {
  temperature: ["°C", "°F", "K"],
  humidity: ["%"],
  carbon_dioxide: ["ppm"],
  pm25: ["µg/m³"],
  power: ["mW", "W", "kW", "MW", "GW", "TW"],
  energy: ["J", "kJ", "MJ", "GJ", "mWh", "Wh", "kWh", "MWh", "GWh", "TWh", "cal", "kcal", "Mcal", "Gcal"],
  illuminance: ["lx"],
  atmospheric_pressure: ["cbar", "bar", "hPa", "mmHg", "inHg", "inH₂O", "kPa", "mbar", "Pa", "psi"],
  sound_pressure: ["dB", "dBA"],
  precipitation_intensity: ["in/d", "in/h", "mm/d", "mm/h"],
  irradiance: ["W/m²", "BTU/(h⋅ft²)"],
  speed: ["ft/s", "km/h", "kn", "m/s", "mph"],
  data_rate: ["bit/s", "kbit/s", "Mbit/s", "GB/s"],
  volume: ["L", "mL", "gal", "fl. oz.", "m³", "ft³"],
  current: ["A", "mA"],
  voltage: ["V", "mV", "kV"],
  frequency: ["Hz", "kHz", "MHz", "GHz"],
  duration: ["d", "h", "min", "s", "ms"],
  monetary: ["EUR", "USD", "GBP"],
};

// Units from no domain at all: a template that concatenated something, a unit somebody
// invented, a unit that is a sentence. Nothing here is a Home Assistant unit.
const NON_HA_UNITS = [
  "°",
  "℃", // U+2103, the single-codepoint degree-Celsius sign — looks right, is not "°C"
  "℉",
  "C°",
  "Grad",
  "degrees",
  "percent",
  "PPM",
  "ug/m3 ",
  " °C",
  "°C ",
  "°c",
  "qwerty",
  "42",
  "-",
  "null",
  "{{ unit }}", // an unrendered template
  "°C/h", // a rate, not an absolute reading
  "µg/m³/h",
  "🌡️",
  "very hot",
];

// Device classes that exist in Home Assistant but not in this card's world.
const FOREIGN_DEVICE_CLASSES = [
  "power",
  "energy",
  "illuminance",
  "atmospheric_pressure",
  "sound_pressure",
  "irradiance",
  "battery",
  "signal_strength",
  "timestamp",
  "enum",
];

// --------------------------------------------------------------- misspellings --

// Mechanical damage to a valid token: deterministic given the random source, applicable to
// any string.
function typo(rng, text) {
  const source = String(text);
  if (source.length < 2) return `${source}x`;
  // Some damage is a no-op on some words (swapping the two `s` of `class`); retry rather than
  // return the original, so the axis is not silently useless. Bounded; the fallback differs.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const damaged = damage(rng, source);
    if (damaged !== source) return damaged;
  }
  return `${source}_x`;
}

function damage(rng, source) {
  switch (rng.int(0, 5)) {
    case 0: {
      // drop a character
      const at = rng.int(0, source.length - 1);
      return source.slice(0, at) + source.slice(at + 1);
    }
    case 1: {
      // double a character
      const at = rng.int(0, source.length - 1);
      return source.slice(0, at + 1) + source[at] + source.slice(at + 1);
    }
    case 2: {
      // swap two neighbours
      const at = rng.int(0, source.length - 2);
      return source.slice(0, at) + source[at + 1] + source[at] + source.slice(at + 2);
    }
    case 3:
      return source.toUpperCase();
    case 4:
      return source[0].toUpperCase() + source.slice(1);
    default:
      // stray whitespace, which YAML preserves inside a quoted scalar
      return rng.bool(0.5) ? ` ${source}` : `${source} `;
  }
}

// The attribute names a template sensor gets wrong — curated slips: a missing underscore, a
// hyphen instead, the wrong case.
const MISSPELLED_DEVICE_CLASS_KEYS = ["device_clas", "deviceclass", "Device_Class", "device-class", "device class"];
const MISSPELLED_UNIT_KEYS = ["unit_of_measure", "unit_of_measurment", "Unit_of_measurement", "unit", "unit_of_measurements"];

// The device class VALUES people write when they mean one of the card's four.
const MISSPELLED_DEVICE_CLASS_VALUES = {
  temperature: ["temperatur", "Temperature", "TEMPERATURE", "temp", "temperature "],
  humidity: ["humidty", "Humidity", "moisture", "humidite", "rel_humidity"],
  co2: ["carbon_dioxid", "co2", "CO2", "carbondioxide", "carbon-dioxide"],
  pm25: ["pm2_5", "pm2.5", "PM25", "particulate_matter_25", "pm_25"],
};

// Misspelled top-level configuration keys: they exercise the diagnostic path in a generated
// card, and are the population unit/config/top-level-keys.test.js measures the suggestion against.
const MISSPELLED_CONFIG_KEYS = [
  "entiy",
  "entitiy",
  "roomz",
  "room",
  "pallete",
  "palete",
  "subtitel",
  "sub_title",
  "titel",
  "view",
  "vieuws",
  "decimal",
  "rotation_second",
  "hide_foter",
  "tap-action",
  "tapAction",
];

// --------------------------------------------------------------------- values --

// Numbers that are numbers only in the sense that `typeof` agrees.
const ABSURD_NUMBERS = [1000, -1000, 1e9, -1e9, 1e308, -1e308, 5e-324, "-0", 0.1 + 0.2, 2 ** 53 + 1, Math.PI];

// States that are not numbers, all seen in a real `hass.states`: an unrendered template
// gives "", a decimal comma gives "1,5", a self-appending unit gives "21 °C", Jinja `none`
// gives "None".
const MALFORMED_STATES = [
  "",
  " ",
  "none",
  "None",
  "null",
  "NaN",
  "Infinity",
  "-Infinity",
  "-",
  "--",
  "1,5",
  "21 °C",
  "21°C",
  "true",
  "false",
  "unknown ",
  "Unavailable",
  "0x1F",
  "1e",
  "+21",
  "21.",
  ".5",
  "２１", // full-width digits
  "٢١", // Arabic-Indic digits
];

// Text that breaks layout, encoding or markup if anything downstream is careless.
const AWKWARD_TEXT = [
  "Küche",
  "Wohnzimmer im Erdgeschoss hinten links",
  "غرفة النوم",
  "리빙룸",
  "客厅",
  "Ёлка",
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "{{ states('sensor.x') }}",
  "&lt;b&gt;",
  "Room\u0000Zero", // a control character, which a broken template can produce
  "Room‮Zero", // right-to-left override
  "  ",
  "\t",
  "🛏️🛁",
  "R".repeat(120),
  "-",
  "0",
];

// ------------------------------------------------------------------- actions --

// Everything `tap_action`/`hold_action` may be, and a good deal it may not.
const VALID_ACTIONS = ["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"];

// Entity ids Home Assistant would never issue (it guarantees lower-case ASCII
// `domain.object_id`), each reaching the card through a hand-edited YAML file. The card must
// not crash and must not write one into the DOM unescaped.
const IMPOSSIBLE_ENTITY_IDS = Object.freeze([
  "no_domain_at_all",
  "sensor.",
  ".living_room",
  "Sensor.Living_Room",
  "sensor.living room",
  "sensor.wohnzimmer_temperatur_außen",
  "sensor.客厅温度",
  `sensor.${"very_long_".repeat(30)}end`,
  "sensor.a.b.c",
  "sensor.<script>",
  "sensor.quote'and\"double",
  "  sensor.padded  ",
]);

// Extra attributes the card reads, written the ways they go wrong: the range view takes its
// numbers from `minimum`/`maximum`, and a value colour from the entity overrides the palette.
const AWKWARD_EXTRA_ATTRIBUTES = Object.freeze([
  // Reversed: the floor is above the ceiling.
  { minimum: 40, maximum: -10 },
  // Equal, so the span is zero and every position divides by it.
  { minimum: 20, maximum: 20 },
  // A timestamp with no value to go with it.
  { minimum_timestamp: "2026-08-23T06:00:00" },
  { maximum_timestamp: "2026-08-23T06:00:00" },
  // Wrong types where numbers belong.
  { minimum: "cold", maximum: "hot" },
  { minimum: null, maximum: [] },
  // The entity classifying itself, which takes precedence over the palette.
  { value_color: "#FF0000" },
  { value_color: "not-a-colour" },
  { value_level: "optimal" },
  { value_level: "nonsense" },
  { value_color: "#00FF00", value_level: "outside" },
]);

// Which timestamps a sensor reports. The names are the shapes test/fixtures/scenario.js knows.
const TIMESTAMP_SHAPES = Object.freeze(["normal", "identical", "missing", "future", "malformed"]);

// Fields a `hass` object can arrive without: handed to a card before the locale resolves, a
// setup with no themes, a restoring dashboard passing an empty `states`.
const HASS_GAPS = Object.freeze(["locale", "language", "themes", "callService", "states"]);

module.exports = {
  IMPOSSIBLE_ENTITY_IDS,
  AWKWARD_EXTRA_ATTRIBUTES,
  TIMESTAMP_SHAPES,
  HASS_GAPS,
  HA_UNITS,
  NON_HA_UNITS,
  FOREIGN_DEVICE_CLASSES,
  MISSPELLED_DEVICE_CLASS_KEYS,
  MISSPELLED_UNIT_KEYS,
  MISSPELLED_DEVICE_CLASS_VALUES,
  MISSPELLED_CONFIG_KEYS,
  ABSURD_NUMBERS,
  MALFORMED_STATES,
  AWKWARD_TEXT,
  VALID_ACTIONS,
  typo,
};
