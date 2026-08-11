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

// Everything `classification.scale` accepts besides the range itself.
const SCALE_SWITCHES = ["step", "headroom", "one_sided", "anchor_scale"];

// classification.scale: the profile's reference axis, its rounding step, and the three
// optional switches that change how the axis grows around live values.
//
// The reference axis has exactly TWO shapes, and they are alternatives rather than
// settings that combine:
//
//   min + max              the drawn axis always covers this range and grows outwards
//                          when readings go further. Every built-in profile but one.
//   anchor_scale: false    no range at all; the drawn axis comes from the readings.
//                          What outdoor temperature needs, where a range that is right
//                          in January is wrong in July.
//
// Declaring both is a contradiction, not a preference, so it is refused as one — and
// `null` rather than an invented range is what "this profile has no reference axis"
// looks like from here on.
//
// This is the ONLY reader of the `scale` block, and every switch leaves it already
// validated and camel-cased rather than for the caller to pick back out of the raw
// YAML. The caller should not have to know that `anchor_scale` and `anchorScale` are
// the same thing, and what `scale` means has exactly one place to change.
export function normalizeScale(value) {
  if (!isPlainObject(value)) pathError("classification.scale", "must be an object");
  assertAllowedKeys(value, new Set(["min", "max", ...SCALE_SWITCHES]), "classification.scale");
  const step = numberAtPath(value.step, "classification.scale.step");
  if (step <= 0) pathError("classification.scale.step", "must be greater than zero");
  const headroom = value.headroom === undefined ? null : numberAtPath(value.headroom, "classification.scale.headroom");
  if (headroom !== null && headroom < 0) {
    pathError("classification.scale.headroom", "must be zero or greater");
  }
  for (const key of ["one_sided", "anchor_scale"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      pathError(`classification.scale.${key}`, "must be a boolean");
    }
  }

  // anchor_scale defaults to true: pinning the axis to a declared range is what every
  // built-in profile except outdoor does, and it is what a profile that says nothing
  // about it means.
  const anchorScale = value.anchor_scale !== false;
  const oneSided = value.one_sided === true;
  const declaresRange = value.min !== undefined || value.max !== undefined;

  if (anchorScale) {
    if (!declaresRange) {
      pathError("classification.scale", "must define min and max, or set anchor_scale: false to let the axis follow the data");
    }
    return { scale: normalizeBand(value, "classification.scale", SCALE_SWITCHES), step, headroom, oneSided, anchorScale };
  }

  if (declaresRange) {
    pathError(
      "classification.scale",
      "must not define min or max when anchor_scale is false, because an axis either covers a declared range or follows the data"
    );
  }
  // one_sided says "the lower edge stays at the reference minimum" — which is an anchor,
  // and there is none to stay at.
  if (oneSided) {
    pathError("classification.scale.one_sided", "requires an anchored axis, because it keeps the lower bound at classification.scale.min");
  }
  return { scale: null, step, headroom, oneSided, anchorScale };
}

// classification.tiers, with the per-tier semantic fields.
//
// `color` is OPTIONAL, and which of the two things a tier is decides what its `score`
// has to be:
//
//   with a color     the tier paints itself. `score` keeps the only rule it has ever
//                    had — any finite number — because every profile written before
//                    palettes existed named a colour on every tier, and all of them
//                    stay valid unchanged.
//   without a color  the tier takes its colour from the palette, and `score` IS the
//                    position it takes: a whole number of 1 or more, unique within the
//                    profile, and descending in tier order like the thresholds. Those
//                    three rules are what make "position" mean something; without them
//                    `palette.ramp[score]` would be reading an arbitrary number as an
//                    index.
//
// Mixing the two in one profile is allowed and the rules apply per tier — a profile can
// paint the two ends by hand and let the palette fill in the middle.
export function normalizeTiers(value, classificationZones) {
  const zones = new Set(classificationZones);
  const positions = [];
  const tiers = normalizeDescendingTierList(value, "classification.tiers", ["score", "level", "color", "zone"], (tier, path) => {
    const score = numberAtPath(tier.score, `${path}.score`);
    if (typeof tier.level !== "string" || !tier.level.trim()) {
      pathError(`${path}.level`, "must be a non-empty string");
    }
    const hasColor = tier.color !== undefined;
    if (hasColor && (typeof tier.color !== "string" || !isHexColor(tier.color.trim()))) {
      pathError(`${path}.color`, "must be a 3/4/6/8-digit hex color");
    }
    if (!hasColor) {
      if (!Number.isInteger(score) || score < 1) {
        pathError(`${path}.score`, `must be a whole number of 1 or more to name a palette position, but is ${score}`);
      }
      positions.push({ score, path });
    }
    if (!zones.has(tier.zone)) {
      const quoted = classificationZones.map((zone) => `"${zone}"`);
      const list = `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
      pathError(`${path}.zone`, `must be one of ${list}`);
    }
    return { score, level: tier.level.trim(), color: hasColor ? tier.color.trim() : null, zone: tier.zone };
  });

  // Checked across the profile rather than per tier, because both rules are about how
  // the positions relate to each other. Descending is asserted only among the tiers that
  // HAVE a position: a painted tier in between says nothing about the ramp.
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].score >= positions[i - 1].score) {
      pathError(
        `${positions[i].path}.score`,
        `must be below ${positions[i - 1].score}, because palette positions descend with the tiers they belong to`
      );
    }
  }
  return tiers;
}

// classification.positions: "my positions run 1..N", which lets a profile with a
// different number of steps than the palette has colours be stretched across it
// deterministically instead of guessed at. See rampIndexFor() in the domain.
export function normalizePositions(value) {
  if (value === undefined) return null;
  const positions = numberAtPath(value, "classification.positions");
  if (!Number.isInteger(positions) || positions < 2) {
    pathError("classification.positions", "must be a whole number of 2 or more");
  }
  return positions;
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

// The five icons a temperature profile used to select with a fire/high/normal/low
// threshold object, in the order that object implied. Kept only to translate that
// spelling into the one shape everything downstream now uses.
const LEGACY_TEMPERATURE_ICONS = ["mdi:fire-alert", "mdi:thermometer-high", "mdi:thermometer", "mdi:thermometer-low"];
const LEGACY_TEMPERATURE_DEFAULT_ICON = "mdi:snowflake";

// classification.icons: ONE shape for every measurement — a descending list of
// {min, icon} tiers ending in a {default: true, icon} entry, the same shape as
// classification.tiers without the fields that carry meaning.
//
// Omitting it means the same thing for every measurement too: the profile declares no
// icons, and the presentation layer applies the measurement's own stable icon. There is
// no derivation and no per-kind fallback.
//
// The fire/high/normal/low object a temperature profile could give instead is accepted
// for backwards compatibility and translated here, at the configuration boundary, into
// exactly the list that spelling always meant. Nothing downstream sees two shapes.
export function normalizeIcons(value, metricKind) {
  if (value === undefined) return { iconTiers: null };

  if (isPlainObject(value)) {
    if (metricKind !== "temperature") {
      pathError("classification.icons", "must be a list of {min, icon} tiers with a final {default: true, icon} entry");
    }
    assertAllowedKeys(value, new Set(["fire", "high", "normal", "low"]), "classification.icons");
    const iconTiers = [];
    let previous = Infinity;
    ["fire", "high", "normal", "low"].forEach((key, index) => {
      const threshold = numberAtPath(value[key], `classification.icons.${key}`);
      if (threshold >= previous) pathError("classification.icons", "must descend from fire to low");
      previous = threshold;
      iconTiers.push({ min: threshold, icon: LEGACY_TEMPERATURE_ICONS[index] });
    });
    iconTiers.push({ min: -Infinity, icon: LEGACY_TEMPERATURE_DEFAULT_ICON });
    return { iconTiers };
  }

  if (!Array.isArray(value)) {
    pathError("classification.icons", "must be a list of {min, icon} tiers with a final {default: true, icon} entry");
  }
  const iconTiers = normalizeDescendingTierList(value, "classification.icons", ["icon"], (item, path) => {
    if (typeof item.icon !== "string" || !item.icon.trim()) {
      pathError(`${path}.icon`, "must be a non-empty string");
    }
    return { icon: item.icon.trim() };
  });
  return { iconTiers };
}
