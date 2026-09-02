// The shared "strictly descending min + exactly one final default" list contract.
//
// Used by classification.tiers (score/level/color/zone) and a non-temperature
// classification.icons list (icon); they differ only in per-item extra fields.
// validateItem(item, path) checks those and returns the fields to merge onto {min, ...}.
//
// Strict because the classifier walks top-down and takes the first tier the value passes:
// without strict descent a tier could be unreachable, without one open-ended final tier a
// reading could match nothing.

import { isPlainObject, assertAllowedKeys, numberAtPath } from "../primitives.js";
import { pathError } from "../errors.js";

export function normalizeDescendingTierList(list, basePath, extraKeys, validateItem) {
  if (!Array.isArray(list) || list.length === 0) {
    pathError(basePath, "must be a non-empty array");
  }
  let defaultCount = 0;
  let previousMin = Infinity;
  const normalized = list.map((item, index) => {
    const path = `${basePath}[${index}]`;
    if (!isPlainObject(item)) pathError(path, "must be an object");
    assertAllowedKeys(item, new Set(["min", "default", ...extraKeys]), path);
    const isDefault = item.default === true;
    if (item.default !== undefined && item.default !== true) {
      pathError(`${path}.default`, "must be true when present");
    }
    if (isDefault) {
      defaultCount += 1;
      if (index !== list.length - 1) pathError(path, "default tier must be the final tier");
      if (item.min !== undefined) pathError(`${path}.min`, "must be omitted on the default tier");
    } else if (item.min === undefined) {
      pathError(`${path}.min`, "is required for every non-default tier");
    }

    const min = isDefault ? -Infinity : numberAtPath(item.min, `${path}.min`);
    if (!isDefault && min >= previousMin) {
      pathError(basePath, "must use unique min values in strictly descending order");
    }
    previousMin = min;

    return { min, ...validateItem(item, path) };
  });
  if (defaultCount !== 1) pathError(basePath, "must contain exactly one final default tier");
  return normalized;
}
