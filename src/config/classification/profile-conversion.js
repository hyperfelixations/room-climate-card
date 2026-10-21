import { isOutsideRange } from "../../core/numbers.js";
import { rejectValue } from "../errors.js";
import { isPlainObject } from "../primitives.js";
import { LEGACY_TEMPERATURE_ICON_KEYS } from "./profile-parts.js";

// The value written at a re-expression fault's YAML path, read through own keys only.
function writtenValueAt(value, path) {
  const keys = path.match(/[^.[\]]+/g).slice(1);
  return keys.reduce((node, key) => (node !== null && typeof node === "object" && Object.hasOwn(node, key) ? node[key] : undefined), value);
}

// The legacy temperature icon object names its thresholds by key, the list by index.
function writtenPath(value, field) {
  const legacyIcon = isPlainObject(value.icons) && /^classification\.icons\[(\d+)\]\.min$/.exec(field);
  return legacyIcon ? `classification.icons.${LEGACY_TEMPERATURE_ICON_KEYS[legacyIcon[1]]}` : field;
}

// The custom profile as written, and re-expressed in the metric's canonical unit. The
// re-expression is injected (config/ does not import the domain); see internal dev doc §5
// "Einheitenregel". A boundary the canonical unit cannot hold refuses the written value.
export function convertCustomProfile(value, source, sourceUnitProfile, metricKind, profileReexpression) {
  const validRange = source.sourceValidRange;
  const authored = {
    id: "custom",
    metricKind,
    // As written, for a message that has to name it.
    unit: value.unit.trim(),
    comparison: source.comparison,
    tiers: source.sourceTiers,
    comfort: source.sourceComfort,
    optimal: source.sourceOptimal,
    scale: source.sourceScale,
    step: source.sourceStep,
    headroom: source.sourceHeadroom === null ? undefined : source.sourceHeadroom,
    oneSided: source.oneSided,
    anchorScale: source.anchorScale,
    invalidWhen: validRange ? (reading) => isOutsideRange(reading, validRange) : null,
    validRange,
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    iconTiers: source.sourceIconTiers,
  };
  const canonical = profileReexpression.reexpress(authored, {
    absolute: sourceUnitProfile.toCanonical,
    delta: sourceUnitProfile.deltaToCanonical,
  });
  const fault = profileReexpression.findFault(authored, canonical);
  if (fault) {
    const path = writtenPath(value, fault.field);
    rejectValue(path, writtenValueAt(value, path));
  }
  return { ...canonical, authored: { unitProfileKey: sourceUnitProfile.key, profile: authored } };
}
