// The view registry: which view is rendered by which module, in which order.
//
// Composed by walking VIEW_DEFINITIONS, so declaration order remains the ONE place
// on-screen left-to-right order (and therefore auto-slide order) is decided. There is
// deliberately no second array to keep in step: an implementation table keyed by view
// key is looked up per definition, and every way the two can disagree fails at module
// load rather than as an empty carousel slot at runtime.
//
// The registry is not imported by the card shell. The composition root hands it in, so
// the shell has no way to name a view and no way to acquire an opinion about one.

import { VIEW_DEFINITIONS } from "../presentation/view-model/view-state.js";
import { rangeView } from "./range.js";
import { rangeScaleView } from "./range-scale.js";
import { scaleView } from "./scale.js";
import { extremesView } from "./extremes.js";

const IMPLEMENTATIONS = [rangeView, rangeScaleView, scaleView, extremesView];

// Runs once, at module load.
function composeRegistry() {
  const definitionKeys = VIEW_DEFINITIONS.map((definition) => definition.key);
  const duplicateDefinitions = definitionKeys.filter((key, index) => definitionKeys.indexOf(key) !== index);
  if (duplicateDefinitions.length) {
    throw new Error(`view registry: duplicate key(s) in VIEW_DEFINITIONS: ${duplicateDefinitions.join(", ")}`);
  }

  const byKey = new Map();
  for (const implementation of IMPLEMENTATIONS) {
    if (byKey.has(implementation.key)) {
      throw new Error(`view registry: two implementations claim the key "${implementation.key}"`);
    }
    if (typeof implementation.render !== "function" || typeof implementation.patch !== "function") {
      throw new Error(`view registry: view "${implementation.key}" must export both a render and a patch function`);
    }
    if (implementation.resolveLayout !== undefined && typeof implementation.resolveLayout !== "function") {
      throw new Error(`view registry: view "${implementation.key}" declares a non-function resolveLayout`);
    }
    byKey.set(implementation.key, implementation);
  }

  const orphaned = [...byKey.keys()].filter((key) => !definitionKeys.includes(key));
  if (orphaned.length) {
    throw new Error(`view registry: implementation without a definition for view(s): ${orphaned.join(", ")}`);
  }

  return definitionKeys.map((key) => {
    const implementation = byKey.get(key);
    if (!implementation) throw new Error(`view registry: no implementation for view "${key}"`);
    return implementation;
  });
}

export const VIEW_RENDERERS = composeRegistry();
