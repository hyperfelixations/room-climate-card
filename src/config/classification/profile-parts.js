// The individual parts of a custom classification profile.
//
// Each function validates one YAML block and returns it in the unit the user
// wrote it in; converting to the canonical unit happens once, at the end, in
// normalize.js. Splitting it this way keeps every validation rule next to the
// error message it produces, and the messages are a user-facing contract.
//
// The accepted zone vocabulary is INJECTED rather than imported: it belongs to
// the domain, and the configuration layer must not reach into the domain
// registry.

import { isHexColor } from "../../core/color.js";
import { assertAllowedKeys, isPlainObject, numberAtPath } from "../primitives.js";
import { pathError } from "../errors.js";
import { normalizeDescendingTierList } from "./tier-list.js";

// A {min, max} band, optionally carrying extra sibling keys that the caller
// validates itself (classification.scale reuses this for step/headroom/one_sided).
export function normalizeBand(value, path, extraKeys = []) {
  if (!isPlainObject(value)) pathError(path, "must be an object");
  assertAllowedKeys(value, new Set(["min", "max", ...extraKeys]), path);
  const min = numberAtPath(value.min, `${path}.min`);
  const max = numberAtPath(value.max, `${path}.max`);
  if (min >= max) pathError(path, "must have min < max");
  return { min, max };
}

// classification.bands: comfort plus a fully contained optimal band.
export function normalizeBands(value) {
  if (!isPlainObject(value)) pathError("classification.bands", "must be an object");
  assertAllowedKeys(value, new Set(["comfort", "optimal"]), "classification.bands");
  const comfort = normalizeBand(value.comfort, "classification.bands.comfort");
  const optimal = normalizeBand(value.optimal, "classification.bands.optimal");
  if (optimal.min < comfort.min || optimal.max > comfort.max) {
    pathError("classification.bands.optimal", "must be fully contained in classification.bands.comfort");
  }
  return { comfort, optimal };
}

// Everything `classification.scale` accepts besides the band itself.
const SCALE_SWITCHES = ["step", "headroom", "one_sided", "anchor_scale"];

// classification.scale: the reference axis, its rounding step, and the three
// optional switches that change how the axis grows around live values.
//
// This is the ONLY reader of the `scale` block, and every switch leaves it
// already validated and camel-cased rather than for the caller to pick back out of
// the raw YAML. The caller should not have to know that `anchor_scale` and
// `anchorScale` are the same thing, and a future change to what `scale` means then
// has exactly one place to happen.
export function normalizeScale(value, comfort) {
  if (!isPlainObject(value)) pathError("classification.scale", "must be an object");
  assertAllowedKeys(value, new Set(["min", "max", ...SCALE_SWITCHES]), "classification.scale");
  const scale = normalizeBand(value, "classification.scale", SCALE_SWITCHES);
  const step = numberAtPath(value.step, "classification.scale.step");
  if (step <= 0) pathError("classification.scale.step", "must be greater than zero");
  if (scale.min > comfort.min || scale.max < comfort.max) {
    pathError("classification.scale", "must fully contain the comfort and optimal bands");
  }
  const headroom = value.headroom === undefined ? null : numberAtPath(value.headroom, "classification.scale.headroom");
  if (headroom !== null && headroom < 0) {
    pathError("classification.scale.headroom", "must be zero or greater");
  }
  for (const key of ["one_sided", "anchor_scale"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      pathError(`classification.scale.${key}`, "must be a boolean");
    }
  }
  // anchor_scale defaults to true: pinning the axis to the declared reference range is
  // what every built-in profile except outdoor does, and it is what a profile that says
  // nothing about it means.
  return { scale, step, headroom, oneSided: value.one_sided === true, anchorScale: value.anchor_scale !== false };
}

// classification.tiers, with the per-tier semantic fields.
export function normalizeTiers(value, classificationZones) {
  const zones = new Set(classificationZones);
  return normalizeDescendingTierList(value, "classification.tiers", ["score", "level", "color", "zone"], (tier, path) => {
    const score = numberAtPath(tier.score, `${path}.score`);
    if (typeof tier.level !== "string" || !tier.level.trim()) {
      pathError(`${path}.level`, "must be a non-empty string");
    }
    if (typeof tier.color !== "string" || !isHexColor(tier.color.trim())) {
      pathError(`${path}.color`, "must be a 3/4/6/8-digit hex color");
    }
    if (!zones.has(tier.zone)) {
      const quoted = classificationZones.map((zone) => `"${zone}"`);
      const list = `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
      pathError(`${path}.zone`, `must be one of ${list}`);
    }
    return { score, level: tier.level.trim(), color: tier.color.trim(), zone: tier.zone };
  });
}

// classification.valid_range: the optional physical-validity window. Either
// bound may be omitted, and each is inclusive unless explicitly turned off.
export function normalizeValidRange(value) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) pathError("classification.valid_range", "must be an object");
  assertAllowedKeys(value, new Set(["min", "max", "min_inclusive", "max_inclusive"]), "classification.valid_range");
  if (value.min === undefined && value.max === undefined) {
    pathError("classification.valid_range", "must define min and/or max");
  }
  for (const key of ["min_inclusive", "max_inclusive"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      pathError(`classification.valid_range.${key}`, "must be a boolean");
    }
  }
  const validRange = {
    min: value.min === undefined ? null : numberAtPath(value.min, "classification.valid_range.min"),
    max: value.max === undefined ? null : numberAtPath(value.max, "classification.valid_range.max"),
    minInclusive: value.min_inclusive !== false,
    maxInclusive: value.max_inclusive !== false,
  };
  if (validRange.min !== null && validRange.max !== null && validRange.min >= validRange.max) {
    pathError("classification.valid_range", "must have min < max");
  }
  return validRange;
}

// classification.icons has two distinct shapes, chosen by metric kind, mirroring
// the built-in profiles: temperature uses a fixed fire/high/normal/low threshold
// object, the other kinds use a descending {min, icon} list. Omitted for
// temperature, the thresholds are derived from the scale and comfort bands.
export function normalizeIcons(value, metricKind, { scale, comfort }) {
  if (value === undefined) {
    if (metricKind !== "temperature") return { iconThresholds: null, iconTiers: null };
    return {
      iconThresholds: {
        fire: scale.max,
        high: comfort.max,
        normal: comfort.min,
        low: scale.min,
      },
      iconTiers: null,
    };
  }

  if (metricKind === "temperature") {
    if (!isPlainObject(value)) {
      pathError("classification.icons", "must be an object with fire/high/normal/low thresholds for a temperature profile");
    }
    assertAllowedKeys(value, new Set(["fire", "high", "normal", "low"]), "classification.icons");
    const iconThresholds = {};
    let previous = Infinity;
    for (const key of ["fire", "high", "normal", "low"]) {
      const threshold = numberAtPath(value[key], `classification.icons.${key}`);
      if (threshold >= previous) pathError("classification.icons", "must descend from fire to low");
      previous = threshold;
      iconThresholds[key] = threshold;
    }
    return { iconThresholds, iconTiers: null };
  }

  if (!Array.isArray(value)) {
    pathError("classification.icons", "must be a list of {min, icon} tiers with a final {default: true, icon} entry for a non-temperature profile");
  }
  const iconTiers = normalizeDescendingTierList(value, "classification.icons", ["icon"], (item, path) => {
    if (typeof item.icon !== "string" || !item.icon.trim()) {
      pathError(`${path}.icon`, "must be a non-empty string");
    }
    return { icon: item.icon.trim() };
  });
  return { iconThresholds: null, iconTiers };
}
