// Compose renderers in VIEW_DEFINITIONS order, the sole screen/auto-slide ordering source.
// Validate definition/implementation drift at module load; composition injects the result into the view-agnostic shell.
// Renderer contract: render(context, content), patch(context, viewEl, content), optional
// resolveLayout(context, viewEl, content) and structureSignature(content); viewEl is the view's own slide.

import { VIEW_DEFINITIONS } from "../presentation/view-model/view-state.js";
import { rangeView } from "./range.js";
import { rangeScaleView } from "./range-scale.js";
import { scaleView } from "./scale.js";
import { extremesView } from "./extremes.js";

const IMPLEMENTATIONS = [rangeView, rangeScaleView, scaleView, extremesView];

const OPTIONAL_HOOKS = ["resolveLayout", "structureSignature"];

export function composeViewRenderers(definitions, implementations) {
  const definitionKeys = definitions.map((definition) => definition.key);
  const byKey = new Map();
  for (const implementation of implementations) {
    if (byKey.has(implementation.key)) {
      throw new Error(`view registry: two implementations claim the key "${implementation.key}"`);
    }
    if (typeof implementation.render !== "function" || typeof implementation.patch !== "function") {
      throw new Error(`view registry: view "${implementation.key}" must export both a render and a patch function`);
    }
    for (const hook of OPTIONAL_HOOKS) {
      if (implementation[hook] !== undefined && typeof implementation[hook] !== "function") {
        throw new Error(`view registry: view "${implementation.key}" declares a non-function ${hook}`);
      }
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

export const VIEW_RENDERERS = composeViewRenderers(VIEW_DEFINITIONS, IMPLEMENTATIONS);
