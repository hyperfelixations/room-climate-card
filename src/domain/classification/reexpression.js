// A classification profile re-expressed in another unit, and what that can break.
//
// The one enumeration of every number a profile carries. Two directions use it: the
// configuration converts a custom profile from the unit it is written in to the canonical
// unit (injected, config/ does not import the domain), and the projection converts a
// canonical profile into the unit the card displays. Absolute boundaries go through
// `absolute`; step and headroom are differences and go through `delta`, which must never
// pick up a unit offset. See internal dev doc §5 "Einheitenregel".

import { isOutsideRange } from "../../core/numbers.js";

// `step` defaults to `delta`; the projection rounds it on top.
export function reexpressProfile(profile, { absolute, delta, step = delta }) {
  const band = (range) => ({ min: absolute(range.min), max: absolute(range.max) });
  const bound = (value) => (value === null ? null : absolute(value));
  const tierMin = (tier) => ({ ...tier, min: Number.isFinite(tier.min) ? absolute(tier.min) : tier.min });
  const validRange = profile.validRange && {
    min: bound(profile.validRange.min),
    max: bound(profile.validRange.max),
    minInclusive: profile.validRange.minInclusive,
    maxInclusive: profile.validRange.maxInclusive,
  };
  return {
    ...profile,
    tiers: profile.tiers.map(tierMin),
    comfort: band(profile.comfort),
    optimal: band(profile.optimal),
    // A profile whose axis follows the data declares no reference range.
    scale: profile.scale ? band(profile.scale) : profile.scale,
    step: step(profile.step),
    headroom: profile.headroom === undefined ? undefined : delta(profile.headroom),
    // The validity window is re-derived in the new unit (a canonical predicate would reject
    // -300 °F, which is -184 °C and a real reading); a profile without one keeps its own.
    validRange,
    invalidWhen: validRange ? (reading) => isOutsideRange(reading, validRange) : profile.invalidWhen,
    iconTiers: profile.iconTiers ? profile.iconTiers.map(tierMin) : profile.iconTiers,
  };
}

const finite = Number.isFinite;

// The first number a re-expression made unusable, as { kind, field } with `field` the YAML
// path of the value at fault, or null. Checked part by part in the order the YAML is
// validated: comfort, optimal, scale, step, headroom, tiers, valid_range, icons; within a
// part an overflow (a finite source value that is no longer finite) before a collapse (a
// band, step or descending list that rounding or underflow made empty or unordered).
export function findReexpressionFault(source, result) {
  const overflow = (field, before, after) => finite(before) && !finite(after) && { kind: "overflow", field };
  const collapse = (field) => ({ kind: "collapse", field });
  const range = (path, before, after) =>
    overflow(`${path}.min`, before.min, after.min) ||
    overflow(`${path}.max`, before.max, after.max) ||
    (!(after.min < after.max) && collapse(`${path}.max`));
  const descending = (path, before, after) => {
    for (const [index, tier] of after.entries()) {
      const fault = overflow(`${path}[${index}].min`, before[index].min, tier.min);
      if (fault) return fault;
    }
    for (let index = 1; index < after.length; index++) {
      if (!(after[index].min < after[index - 1].min)) return collapse(`${path}[${index}].min`);
    }
    return null;
  };
  const validRange = () => {
    const { min, max } = result.validRange;
    return (
      overflow("classification.valid_range.min", source.validRange.min, min) ||
      overflow("classification.valid_range.max", source.validRange.max, max) ||
      (min !== null && max !== null && !(min < max) && collapse("classification.valid_range.max"))
    );
  };
  return (
    range("classification.bands.comfort", source.comfort, result.comfort) ||
    range("classification.bands.optimal", source.optimal, result.optimal) ||
    (source.scale && range("classification.scale", source.scale, result.scale)) ||
    overflow("classification.scale.step", source.step, result.step) ||
    (!(result.step > 0) && collapse("classification.scale.step")) ||
    overflow("classification.scale.headroom", source.headroom, result.headroom) ||
    descending("classification.tiers", source.tiers, result.tiers) ||
    (source.validRange && validRange()) ||
    (source.iconTiers && descending("classification.icons", source.iconTiers, result.iconTiers)) ||
    null
  );
}
