// Aggregates the built-in classification profiles, one metric kind at a time.
//
// Deliberately thin: every semantic decision lives in the individual profile
// modules under profiles/, and this file only says which profiles exist per
// metric kind and which one is the default. Adding a profile is a new file
// plus one import and one entry here — the registry must not grow back into a
// second god file.
//
// Shape (unchanged, several call sites index into it directly):
//   CLASSIFICATION_PROFILE_REGISTRY[metricKind].defaultProfile -> profile id
//   CLASSIFICATION_PROFILE_REGISTRY[metricKind].profiles[id]   -> profile

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
