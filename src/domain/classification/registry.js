// Aggregates the built-in classification profiles, one metric kind at a time.
//
// Deliberately thin: every semantic decision lives in the profile modules under
// profiles/. This file only maps `[metricKind].defaultProfile` to a profile id and
// `[metricKind].profiles[id]` to a profile; call sites index into it directly. Adding
// a profile is a new file plus one import and one entry here.

import { indoor as temperatureIndoor } from "./profiles/temperature/indoor.js";
import { outdoor as temperatureOutdoor } from "./profiles/temperature/outdoor.js";
import { fridge as temperatureFridge } from "./profiles/temperature/fridge.js";
import { freezer as temperatureFreezer } from "./profiles/temperature/freezer.js";
import { indoor as humidityIndoor } from "./profiles/humidity/indoor.js";
import { indoor as co2Indoor } from "./profiles/co2/indoor.js";
import { indoor as pm25Indoor } from "./profiles/pm25/indoor.js";
import { indoor as pm1Indoor } from "./profiles/pm1/indoor.js";
import { indoor as pm4Indoor } from "./profiles/pm4/indoor.js";
import { indoor as pm10Indoor } from "./profiles/pm10/indoor.js";
import { indoor as coIndoor } from "./profiles/co/indoor.js";

export const CLASSIFICATION_PROFILE_REGISTRY = {
  temperature: {
    defaultProfile: "indoor",
    profiles: {
      indoor: temperatureIndoor,
      outdoor: temperatureOutdoor,
      fridge: temperatureFridge,
      freezer: temperatureFreezer,
    },
  },
  humidity: {
    defaultProfile: "indoor",
    profiles: {
      indoor: humidityIndoor,
    },
  },
  co2: {
    defaultProfile: "indoor",
    profiles: {
      indoor: co2Indoor,
    },
  },
  pm25: {
    defaultProfile: "indoor",
    profiles: {
      indoor: pm25Indoor,
    },
  },
  pm1: { defaultProfile: "indoor", profiles: { indoor: pm1Indoor } },
  pm4: { defaultProfile: "indoor", profiles: { indoor: pm4Indoor } },
  pm10: { defaultProfile: "indoor", profiles: { indoor: pm10Indoor } },
  co: { defaultProfile: "indoor", profiles: { indoor: coIndoor } },
};
