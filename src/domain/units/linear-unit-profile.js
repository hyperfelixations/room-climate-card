// A UnitProfile that differs from its measurement's canonical unit by a factor alone (no
// offset), so an absolute value and a delta convert alike. `factor` is canonical units per
// display unit; 1 is the canonical unit itself. `thresholdDigits` floors every projected
// boundary to that many decimals; see internal dev doc §5 "Einheitenregel".

import { floorToDigits } from "../../core/numbers.js";

export function linearUnitProfile({ key, displayUnit, units = [displayUnit], factor = 1, thresholdDigits = null }) {
  return {
    key,
    units,
    displayUnit,
    toCanonical: (value) => value * factor,
    fromCanonical: (value) => value / factor,
    deltaToCanonical: (value) => value * factor,
    deltaFromCanonical: (value) => value / factor,
    ...(thresholdDigits === null ? {} : { thresholdRounding: (value) => floorToDigits(value, thresholdDigits) }),
  };
}
