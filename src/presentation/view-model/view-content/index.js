// Which view gets a content model, and in which order.
//
// The table is keyed by view key and composed by walking VIEW_DEFINITIONS, so
// declaration order stays the ONE place on-screen order is decided. A definition
// without a builder here, or a builder without a definition, fails at module load
// (see assertContentBuildersMatchDefinitions() below) rather than silently producing
// a view that renders nothing.
//
// Only ACTIVE views get a content model; every inactive one is null. That is not an
// optimization detail, it is the contract: the daily-range scale is available
// whenever the range entity reports a usable min/max pair, but it is off unless
// explicitly listed, and building its axis, its markers and its three decluttered
// labels for a view nobody asked for is work with no observable result. The axis
// therefore arrives as a thunk that is only ever called from inside the range-scale
// branch.

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

// Runs once, at module load. A mismatch here is a wiring mistake that would
// otherwise surface as an empty carousel slot at runtime.
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

// The declaration-ordered key list, exported so the rendering layer can compose its
// own registry against the same single source of order.
export const VIEW_CONTENT_KEYS = VIEW_DEFINITIONS.map((definition) => definition.key);

export function buildViewContent({ shared, viewState }) {
  const byKey = {};
  for (const key of VIEW_CONTENT_KEYS) {
    byKey[key] = viewState.keys.includes(key) ? CONTENT_BUILDERS[key](shared, viewState.options[key]) : null;
  }
  return byKey;
}
