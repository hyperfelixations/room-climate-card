// The individual parts of a custom classification profile.
//
// Each function validates one YAML block and returns it in the user's unit; conversion to
// canonical happens once, at the end, in normalize.js. A rule that fails names the path and the
// value it refuses (rejectValue()). The keys of every part are checked before any value, by
// normalize.js, against the lists below. The zone vocabulary is INJECTED — the config layer
// must not import the domain registry.
//
// Full contract: see internal dev doc §5 "Custom-Profile-Vertrag".

import { isHexColor } from "../../core/color.js";
import { rejectValue } from "../errors.js";
import { isPlainObject, isUnwritten, readNumberAtPath } from "../primitives.js";
import { normalizeDescendingTierList } from "./tier-list.js";

export const BAND_KEYS = Object.freeze(["min", "max"]);
export const BANDS_KEYS = Object.freeze(["comfort", "optimal"]);
export const SCALE_KEYS = Object.freeze(["min", "max", "step", "headroom", "one_sided", "anchor_scale"]);
export const TIER_KEYS = Object.freeze(["min", "default", "score", "level", "color", "zone"]);
export const VALID_RANGE_KEYS = Object.freeze(["min", "max", "min_inclusive", "max_inclusive"]);
export const ICON_TIER_KEYS = Object.freeze(["min", "default", "icon"]);

// A {min, max} band; a max that is not above min is the value at fault.
export function normalizeBand(value, path) {
  if (!isPlainObject(value)) rejectValue(path, value);
  const min = readNumberAtPath(value.min, `${path}.min`);
  const max = readNumberAtPath(value.max, `${path}.max`);
  if (min >= max) rejectValue(`${path}.max`, value.max);
  return { min, max };
}

// classification.bands: comfort plus a fully contained optimal band.
export function normalizeBands(value) {
  if (!isPlainObject(value)) rejectValue("classification.bands", value);
  const comfort = normalizeBand(value.comfort, "classification.bands.comfort");
  const optimal = normalizeBand(value.optimal, "classification.bands.optimal");
  if (optimal.min < comfort.min) rejectValue("classification.bands.optimal.min", value.optimal.min);
  if (optimal.max > comfort.max) rejectValue("classification.bands.optimal.max", value.optimal.max);
  return { comfort, optimal };
}

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
  if (!isPlainObject(value)) rejectValue("classification.scale", value);
  const step = readNumberAtPath(value.step, "classification.scale.step");
  if (step <= 0) rejectValue("classification.scale.step", value.step);
  const headroom = isUnwritten(value.headroom) ? null : readNumberAtPath(value.headroom, "classification.scale.headroom");
  if (headroom !== null && headroom < 0) rejectValue("classification.scale.headroom", value.headroom);
  for (const key of ["one_sided", "anchor_scale"]) {
    if (!isUnwritten(value[key]) && typeof value[key] !== "boolean") rejectValue(`classification.scale.${key}`, value[key]);
  }

  // anchor_scale defaults to true (every built-in but outdoor).
  const anchorScale = value.anchor_scale !== false;
  const oneSided = value.one_sided === true;

  // An anchored axis needs its range, so a missing min or max is refused at its path.
  if (anchorScale) return { scale: normalizeBand(value, "classification.scale"), step, headroom, oneSided, anchorScale };

  // An axis that follows the data has no range to declare, and a declared bound contradicts it.
  if (!isUnwritten(value.min)) rejectValue("classification.scale.min", value.min);
  if (!isUnwritten(value.max)) rejectValue("classification.scale.max", value.max);
  // one_sided keeps the lower edge at the reference minimum — an anchor, and there is none.
  if (oneSided) rejectValue("classification.scale.one_sided", value.one_sided);
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
    const path = `classification.tiers[${index}].score`;
    // Thresholds descend, so colourless scores must too: a tier for lower readings is
    // further from optimal, never nearer.
    if (previous !== null && tier.score >= previous) rejectValue(path, tier.score);
    previous = tier.score;

    // A tier that calls itself optimal must carry score 0. The converse is not required (a
    // profile may have no optimal zone). Two optimal tiers cannot arise: this pins each to
    // 0, and the strict descent above allows 0 exactly once.
    if (tier.zone === "optimal" && tier.score !== 0) rejectValue(path, tier.score);
  });
}

export function normalizeTiers(value, classificationZones) {
  const zones = new Set(classificationZones);
  const tiers = normalizeDescendingTierList(value, "classification.tiers", (tier, path) => {
    const score = readNumberAtPath(tier.score, `${path}.score`);
    if (typeof tier.level !== "string" || !tier.level.trim()) rejectValue(`${path}.level`, tier.level);
    const hasColor = !isUnwritten(tier.color);
    if (hasColor && (typeof tier.color !== "string" || !isHexColor(tier.color.trim()))) rejectValue(`${path}.color`, tier.color);
    // A colour from the palette sits a whole number of steps from optimal.
    if (!hasColor && !Number.isInteger(score)) rejectValue(`${path}.score`, tier.score);
    if (!zones.has(tier.zone)) rejectValue(`${path}.zone`, tier.zone);
    return { score, level: tier.level.trim(), color: hasColor ? tier.color.trim() : null, zone: tier.zone };
  });
  assertRampOrder(tiers);
  return tiers;
}

// classification.valid_range: the optional physical-validity window. Either
// bound may be omitted, and each is inclusive unless explicitly turned off.
export function normalizeValidRange(value) {
  if (isUnwritten(value)) return null;
  if (!isPlainObject(value)) rejectValue("classification.valid_range", value);
  if (isUnwritten(value.min) && isUnwritten(value.max)) rejectValue("classification.valid_range", value);
  for (const key of ["min_inclusive", "max_inclusive"]) {
    if (!isUnwritten(value[key]) && typeof value[key] !== "boolean") rejectValue(`classification.valid_range.${key}`, value[key]);
  }
  const validRange = {
    min: isUnwritten(value.min) ? null : readNumberAtPath(value.min, "classification.valid_range.min"),
    max: isUnwritten(value.max) ? null : readNumberAtPath(value.max, "classification.valid_range.max"),
    minInclusive: value.min_inclusive !== false,
    maxInclusive: value.max_inclusive !== false,
  };
  if (validRange.min !== null && validRange.max !== null && validRange.min >= validRange.max) {
    rejectValue("classification.valid_range.max", value.max);
  }
  return validRange;
}

// The legacy fire/high/normal/low temperature object: its keys in threshold order, and the
// icons they map to.
export const LEGACY_TEMPERATURE_ICON_KEYS = Object.freeze(["fire", "high", "normal", "low"]);
const LEGACY_TEMPERATURE_ICONS = ["mdi:fire-alert", "mdi:thermometer-high", "mdi:thermometer", "mdi:thermometer-low"];
const LEGACY_TEMPERATURE_DEFAULT_ICON = "mdi:snowflake";

// classification.icons: ONE shape for every measurement — a descending {min, icon} list
// ending in {default: true, icon}. Omitting it means the profile declares no icons and
// the presentation layer uses the metric's stable icon. The fire/high/normal/low object
// (temperature only) is accepted for backwards compatibility and translated here into
// that list; nothing downstream sees two shapes.
export function normalizeIcons(value, metricKind) {
  if (isUnwritten(value)) return { iconTiers: null };

  if (isPlainObject(value)) {
    if (metricKind !== "temperature") rejectValue("classification.icons", value);
    const iconTiers = [];
    let previous = Infinity;
    LEGACY_TEMPERATURE_ICON_KEYS.forEach((key, index) => {
      const threshold = readNumberAtPath(value[key], `classification.icons.${key}`);
      if (threshold >= previous) rejectValue(`classification.icons.${key}`, value[key]);
      previous = threshold;
      iconTiers.push({ min: threshold, icon: LEGACY_TEMPERATURE_ICONS[index] });
    });
    iconTiers.push({ min: -Infinity, icon: LEGACY_TEMPERATURE_DEFAULT_ICON });
    return { iconTiers };
  }

  if (!Array.isArray(value)) rejectValue("classification.icons", value);
  const iconTiers = normalizeDescendingTierList(value, "classification.icons", (item, path) => {
    if (typeof item.icon !== "string" || !item.icon.trim()) rejectValue(`${path}.icon`, item.icon);
    return { icon: item.icon.trim() };
  });
  return { iconTiers };
}
