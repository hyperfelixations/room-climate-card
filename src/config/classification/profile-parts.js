// The individual parts of a custom classification profile.
//
// Each function validates one YAML block and returns it in the user's unit; conversion to
// canonical happens once, at the end, in normalize.js. Split this way so every rule sits
// next to the error message it produces (the messages are a user-facing contract). The
// zone vocabulary is INJECTED — the config layer must not import the domain registry.
//
// Full contract: see internal dev doc §5 "Custom-Profile-Vertrag".

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

// classification.scale: the reference axis, its rounding step, and three optional switches.
//
// The axis has TWO mutually exclusive shapes: `min + max` (the drawn axis always covers
// this range and grows outwards) or `anchor_scale: false` (no range; the axis comes from
// the data, as outdoor temperature needs). Declaring both is refused. "No reference axis"
// is `null` from here on, never an invented range.
//
// The ONLY reader of the `scale` block: it returns everything validated and camel-cased,
// so the caller never touches raw YAML or learns that `anchor_scale` becomes `anchorScale`.
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

  // anchor_scale defaults to true (every built-in but outdoor).
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
  // one_sided keeps the lower edge at the reference minimum — an anchor, and there is none.
  if (oneSided) {
    pathError("classification.scale.one_sided", "requires an anchored axis, because it keeps the lower bound at classification.scale.min");
  }
  return { scale: null, step, headroom, oneSided, anchorScale };
}

// classification.tiers. `color` is OPTIONAL: a tier with one paints itself and its `score`
// may be any finite number; a colourless tier takes its colour from the palette and its
// `score` is a whole-number distance from optimal. Mixing is allowed — painted tiers are
// stepped over below.
//
// assertRampOrder(): two rules over the WHOLE list (neither is a per-tier property),
// checked on colourless tiers only. Without them `[1, 5, -1]` with `zone: optimal` in the
// middle was accepted and painted the optimum in the palette's most extreme colour.
function assertRampOrder(tiers) {
  let previous = null;
  tiers.forEach((tier, index) => {
    if (tier.color) return;
    const path = `classification.tiers[${index}]`;
    // Thresholds descend, so colourless scores must too: a tier for lower readings is
    // further from optimal, never nearer.
    if (previous && tier.score >= previous.score) {
      pathError(
        `${path}.score`,
        `is ${tier.score}, which is not below the ${previous.score} of ${previous.path} — a tier for lower readings is further from optimal, so its distance must be smaller`
      );
    }
    previous = { score: tier.score, path };

    // A tier that calls itself optimal must carry score 0. The converse is not required (a
    // profile may have no optimal zone). Two optimal tiers cannot arise: this pins each to
    // 0, and the strict descent above allows 0 exactly once.
    if (tier.zone === "optimal" && tier.score !== 0) {
      pathError(
        `${path}.score`,
        `is ${tier.score}, but a tier in the optimal zone is the middle of the ramp and its distance from optimal is 0`
      );
    }
  });
}

export function normalizeTiers(value, classificationZones) {
  const zones = new Set(classificationZones);
  const tiers = normalizeDescendingTierList(value, "classification.tiers", ["score", "level", "color", "zone"], (tier, path) => {
    const score = numberAtPath(tier.score, `${path}.score`);
    if (typeof tier.level !== "string" || !tier.level.trim()) {
      pathError(`${path}.level`, "must be a non-empty string");
    }
    const hasColor = tier.color !== undefined;
    if (hasColor && (typeof tier.color !== "string" || !isHexColor(tier.color.trim()))) {
      pathError(`${path}.color`, "must be a 3/4/6/8-digit hex color");
    }
    if (!hasColor && !Number.isInteger(score)) {
      pathError(`${path}.score`, `must be a whole number of steps from optimal to take a color from the palette, but is ${score}`);
    }
    if (!zones.has(tier.zone)) {
      const quoted = classificationZones.map((zone) => `"${zone}"`);
      const list = `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
      pathError(`${path}.zone`, `must be one of ${list}`);
    }
    return { score, level: tier.level.trim(), color: hasColor ? tier.color.trim() : null, zone: tier.zone };
  });
  assertRampOrder(tiers);
  return tiers;
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

// The icons the legacy fire/high/normal/low temperature object mapped to, in its order.
const LEGACY_TEMPERATURE_ICONS = ["mdi:fire-alert", "mdi:thermometer-high", "mdi:thermometer", "mdi:thermometer-low"];
const LEGACY_TEMPERATURE_DEFAULT_ICON = "mdi:snowflake";

// classification.icons: ONE shape for every measurement — a descending {min, icon} list
// ending in {default: true, icon}. Omitting it means the profile declares no icons and
// the presentation layer uses the metric's stable icon. The fire/high/normal/low object
// (temperature only) is accepted for backwards compatibility and translated here into
// that list; nothing downstream sees two shapes.
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
