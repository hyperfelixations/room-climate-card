// The shared "strictly descending min + exactly one final default" list contract.
//
// Used by classification.tiers (score/level/color/zone) and a non-temperature
// classification.icons list (icon); they differ only in per-item extra fields.
// validateItem(item, path) checks those and returns the fields to merge onto {min, ...}.
// The items' keys are checked before, by normalize.js.
//
// Strict because the classifier walks top-down and takes the first tier the value passes:
// without strict descent a tier could be unreachable, without one open-ended final tier a
// reading could match nothing.

import { rejectValue } from "../errors.js";
import { isPlainObject, isUnwritten, readNumberAtPath } from "../primitives.js";

export function normalizeDescendingTierList(list, basePath, validateItem) {
  if (!Array.isArray(list) || list.length === 0) rejectValue(basePath, list);
  let previousMin = Infinity;
  const normalized = list.map((item, index) => {
    const path = `${basePath}[${index}]`;
    if (!isPlainObject(item)) rejectValue(path, item);
    if (!isUnwritten(item.default) && item.default !== true) rejectValue(`${path}.default`, item.default);
    const isDefault = item.default === true;
    if (isDefault && index !== list.length - 1) rejectValue(`${path}.default`, item.default);
    if (isDefault && !isUnwritten(item.min)) rejectValue(`${path}.min`, item.min);

    const min = isDefault ? -Infinity : readNumberAtPath(item.min, `${path}.min`);
    if (min >= previousMin) rejectValue(`${path}.min`, item.min);
    previousMin = min;

    return { min, ...validateItem(item, path) };
  });
  // The open-ended default catches every reading below the others, so the list must end in it.
  if (normalized[normalized.length - 1].min !== -Infinity) rejectValue(basePath, list);
  return normalized;
}
