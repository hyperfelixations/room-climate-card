"use strict";

// THE VOCABULARY the generator draws from: every unit, spelling, mistake and malformed
// value a real Home Assistant dashboard can put in front of this card.
//
// Split out from generators.js because it is a reference list rather than logic, it is long,
// and it is the part most worth reading on its own — someone adding a case should be able to
// find where it goes without reading a generator.
//
// TWO KINDS OF WRONGNESS, and both matter:
//
//   CURATED    mistakes a person actually makes. `device_clas`, `humidty`, a decimal comma,
//              a sensor that appends its own unit to its state. These are worth listing by
//              hand because they are the ones that happen.
//   MECHANICAL mistakes a keyboard makes. typo() below drops, doubles, swaps and re-cases
//              characters, so ANY valid token in the product surface can be handed to the
//              card slightly wrong without anyone having to think of that particular slip
//              first. This is what covers `clipp`, `wrp`, `value_dsc`, `Extremes` and the
//              hundreds of others nobody would enumerate.

// ------------------------------------------------------------------------- units --

// Every unit Home Assistant's sensor device classes list, grouped the way the docs group
// them. The card understands four of these groups and must survive the rest — a template
// sensor with `device_class: temperature` and `unit_of_measurement: W/m²` is a real thing a
// real person ships, and what the card does with it is worth knowing.
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

// Mechanical damage to a valid token. Deterministic given the random source, and applicable
// to ANY string — which is the point: the generator can misspell a view name, an enum value,
// a configuration key or an attribute name without a curated list for each.
function typo(rng, text) {
  const source = String(text);
  if (source.length < 2) return `${source}x`;
  // Some damage is a no-op on some words: swapping the two `s` of `class` restores it, and
  // capitalising a word that is already capitalised changes nothing. Retry rather than
  // return the original, because "a misspelling that is spelled correctly" would make the
  // whole axis silently useless. Bounded, and the fallback always differs.
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

// The attribute NAMES a template sensor gets wrong. Curated, because these are the specific
// slips that happen — an underscore forgotten, a hyphen instead, the wrong case.
const MISSPELLED_DEVICE_CLASS_KEYS = ["device_clas", "deviceclass", "Device_Class", "device-class", "device class"];
const MISSPELLED_UNIT_KEYS = ["unit_of_measure", "unit_of_measurment", "Unit_of_measurement", "unit", "unit_of_measurements"];

// The device class VALUES people write when they mean one of the card's four.
const MISSPELLED_DEVICE_CLASS_VALUES = {
  temperature: ["temperatur", "Temperature", "TEMPERATURE", "temp", "temperature "],
  humidity: ["humidty", "Humidity", "moisture", "humidite", "rel_humidity"],
  co2: ["carbon_dioxid", "co2", "CO2", "carbondioxide", "carbon-dioxide"],
  pm25: ["pm2_5", "pm2.5", "PM25", "particulate_matter_25", "pm_25"],
};

// Top-level configuration keys somebody meant to write. The card names each of them and
// offers the option it was probably meant to be, so these carry two jobs: they keep a
// generated card exercising the diagnostic path, and they are the population
// unit/config/top-level-keys.test.js measures the suggestion against.
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

// States that are not numbers at all. Every one of these has been seen in a real
// `hass.states`: an unrendered template gives "", a decimal comma gives "1,5", a sensor that
// appends its own unit gives "21 °C", a Jinja `none` gives "None".
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

// ENTITY IDS HOME ASSISTANT WOULD NEVER ISSUE.
//
// Home Assistant guarantees `domain.object_id`, lower case, ASCII, no spaces. None of these
// satisfies that, and every one of them reaches the card the same way a real id does: through
// a YAML file a person edited by hand. What the card must not do is crash, and what it must
// not do more quietly is write one of them into the DOM unescaped.
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

// Extra attributes the card reads, written the ways they go wrong. The range view takes its
// numbers from `minimum`/`maximum`, and a value colour from the entity overrides the palette
// — so each of these lands somewhere the card has to make a decision.
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

// Fields a `hass` object can arrive without. Every one of them happens: `hass` is handed to a
// card before the locale resolves, a custom setup carries no themes, and a dashboard being
// restored can pass an empty `states`.
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
