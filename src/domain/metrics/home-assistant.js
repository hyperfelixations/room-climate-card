// What Home Assistant defines for sensors, as data. Source: homeassistant/components/sensor/
// const.py (SensorDeviceClass, DEVICE_CLASS_UNITS), branch dev, read 2026-10-03. See internal
// dev doc §5 "Messart-Bestimmung aus der Einheit".

// Every SensorDeviceClass value. A class listed here is a declaration; one missing from it
// counts as undeclared, so the unit may decide.
export const HA_SENSOR_DEVICE_CLASSES = Object.freeze([
  "date", "enum", "timestamp", "uptime", "absolute_humidity", "apparent_power", "aqi", "area",
  "atmospheric_pressure", "battery", "blood_glucose_concentration", "carbon_monoxide",
  "carbon_dioxide", "conductivity", "current", "data_rate", "data_size", "distance", "duration",
  "energy", "energy_distance", "energy_storage", "frequency", "gas", "humidity", "illuminance",
  "irradiance", "moisture", "monetary", "nitrogen_dioxide", "nitrogen_monoxide", "nitrous_oxide",
  "ozone", "ph", "pm1", "pm10", "pm25", "pm4", "power_factor", "power", "precipitation",
  "precipitation_intensity", "pressure", "radon", "reactive_energy", "reactive_power",
  "signal_strength", "sound_pressure", "speed", "sulphur_dioxide", "temperature",
  "temperature_delta", "volatile_organic_compounds", "volatile_organic_compounds_parts",
  "voltage", "volume", "volume_storage", "volume_flow_rate", "water", "weight", "wind_direction",
  "wind_speed",
]);

// DEVICE_CLASS_UNITS for the classes a climate card could be pointed at, spelled as Home
// Assistant writes them (μ is U+03BC). Left out are classes that report a card unit but always
// declare themselves — battery, moisture and power_factor (%), temperature_delta (°C) — since
// a unit only decides for a sensor without a declared class.
export const HA_DEVICE_CLASS_UNITS = Object.freeze({
  temperature: Object.freeze(["°C", "°F", "K"]),
  humidity: Object.freeze(["%"]),
  carbon_dioxide: Object.freeze(["ppm"]),
  pm1: Object.freeze(["μg/m³"]),
  pm25: Object.freeze(["μg/m³"]),
  pm4: Object.freeze(["μg/m³"]),
  pm10: Object.freeze(["μg/m³"]),
  carbon_monoxide: Object.freeze(["ppb", "ppm", "mg/m³", "μg/m³"]),
  nitrogen_dioxide: Object.freeze(["ppb", "ppm", "μg/m³"]),
  ozone: Object.freeze(["ppb", "ppm", "μg/m³"]),
  nitrogen_monoxide: Object.freeze(["ppb", "μg/m³"]),
  sulphur_dioxide: Object.freeze(["ppb", "μg/m³"]),
  nitrous_oxide: Object.freeze(["μg/m³"]),
  volatile_organic_compounds: Object.freeze(["μg/m³", "mg/m³"]),
  volatile_organic_compounds_parts: Object.freeze(["ppm", "ppb"]),
  absolute_humidity: Object.freeze(["g/m³", "mg/m³"]),
  radon: Object.freeze(["Bq/m³", "pCi/L"]),
});
