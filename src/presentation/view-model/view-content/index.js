// Builds content in VIEW_DEFINITIONS order and fails fast on registry mismatches.
// Inactive views remain null; range-scale geometry is invoked lazily only when active.

import { VIEW_DEFINITIONS } from "../view-state.js";
import { buildRangeViewContent } from "./range.js";
import { buildRangeScaleViewContent } from "./range-scale.js";
import { buildScaleViewContent } from "./scale.js";
import { buildExtremesViewContent } from "./extremes.js";

const CONTENT_BUILDERS = {
  range: (shared, options) => buildRangeViewContent(shared, options),
  range_scale: (shared, options) => buildRangeScaleViewContent(shared, options, shared.buildRangeScaleAxis()),
  scale: (shared, options) => buildScaleViewContent(shared, options),
  extremes: (shared, options) => buildExtremesViewContent(shared, options),
};

// Module-load assertion prevents silent empty carousel slots.
function assertContentBuildersMatchDefinitions() {
  const definitionKeys = VIEW_DEFINITIONS.map((definition) => definition.key);
  const duplicates = definitionKeys.filter((key, index) => definitionKeys.indexOf(key) !== index);
  if (duplicates.length) {
    throw new Error(`view content: duplicate view key(s) in VIEW_DEFINITIONS: ${duplicates.join(", ")}`);
  }
  const missing = definitionKeys.filter((key) => typeof CONTENT_BUILDERS[key] !== "function");
  if (missing.length) {
    throw new Error(`view content: no content builder for view(s): ${missing.join(", ")}`);
  }
  const orphaned = Object.keys(CONTENT_BUILDERS).filter((key) => !definitionKeys.includes(key));
  if (orphaned.length) {
    throw new Error(`view content: content builder without a definition for view(s): ${orphaned.join(", ")}`);
  }
}

assertContentBuildersMatchDefinitions();

// Shared declaration order for content and rendering registries.
export const VIEW_CONTENT_KEYS = VIEW_DEFINITIONS.map((definition) => definition.key);

export function buildViewContent({ shared, viewState }) {
  const byKey = {};
  for (const key of VIEW_CONTENT_KEYS) {
    byKey[key] = viewState.keys.includes(key) ? CONTENT_BUILDERS[key](shared, viewState.options[key]) : null;
  }
  return byKey;
}
