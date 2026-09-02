// Aggregates the built-in classification profiles, one metric kind at a time.
//
// Deliberately thin: every semantic decision lives in the profile modules under
// profiles/. This file only maps `[metricKind].defaultProfile` to a profile id and
// `[metricKind].profiles[id]` to a profile; call sites index into it directly. Adding
// a profile is a new file plus one import and one entry here.

import { indoor as temperatureIndoor } from "./profiles/temperature/indoor.js";
import { outdoor as temperatureOutdoor } from "./profiles/temperature/outdoor.js";
import { fridge as temperatureFridge } from "./profiles/temperature/fridge.js";
import { indoor as humidityIndoor } from "./profiles/humidity/indoor.js";
import { indoor as co2Indoor } from "./profiles/co2/indoor.js";
import { indoor as pm25Indoor } from "./profiles/pm25/indoor.js";

export const CLASSIFICATION_PROFILE_REGISTRY = {
  temperature: {
    defaultProfile: "indoor",
    profiles: {
      indoor: temperatureIndoor,
      outdoor: temperatureOutdoor,
      fridge: temperatureFridge,
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
};
