// The keys a card configuration may carry at its top level, and what an unknown one means. A
// key within two edits of one of the card's options is a typo and refuses the configuration with
// that option named; any other unknown key is foreign, warned about and ignored — so a key Home
// Assistant or a frontend module adds later never breaks the card. Inside the objects the card
// owns, every unknown key refuses (assertKnownKeys() in primitives.js). An older spelling in the
// deprecation register is neither: it is answered at its stage (deprecations.js). Full contract:
// see internal dev doc §3 "Der Schlüsselvertrag".
//
// The two lists differ in kind:
//   TOP_LEVEL_KEYS   what the card OWNS: every key normalizeConfig() reads. Held in
//                    lockstep with the product-surface manifest by a contract test.
//   FRAMEWORK_KEYS   what the card is HANDED: `LovelaceCardConfig` bookkeeping plus
//                    `card_mod`. Not owned, not read here, so not warned about.

import { createDiagnostic } from "../core/diagnostics.js";
import { deprecationDiagnostic, topLevelDeprecation } from "./deprecations.js";
import { rejectConfiguration } from "./errors.js";
import { isUnwritten } from "./primitives.js";
import { nearestKey } from "./suggest.js";

// Owned by the card.
export const TOP_LEVEL_KEYS = Object.freeze(
  new Set([
    "entity",
    "rooms",
    "range_entity",
    "trend_entity",
    "classification",
    "palette",
    "title",
    "subtitle",
    "entity_label",
    "icon",
    "accent_line",
    "decimals",
    "language",
    "show",
    "room_sort",
    "room_label",
    "room_columns",
    "room_rows",
    "auto_slide",
    "swipe",
    "rotation_seconds",
    "slide_seconds",
    "tap_action",
    "hold_action",
    "views",
    "start_view",
  ])
);

// Written by Home Assistant and by front-end modules, read by them, ignored here.
export const FRAMEWORK_KEYS = Object.freeze(
  new Set(["type", "index", "view_index", "view_layout", "layout_options", "grid_options", "visibility", "disabled", "card_mod"])
);

// Both, for deciding which known key an unknown one is closest to.
const KNOWN_KEYS = Object.freeze(new Set([...TOP_LEVEL_KEYS, ...FRAMEWORK_KEYS]));

// Refuses the first key that is a typo of one of the card's options; records one
// diagnostic per foreign key. A key closest to a framework key is foreign: it is not the
// card's to name. A removed spelling is never suggested: it is not in KNOWN_KEYS.
export function checkTopLevelKeys(userConfig, diagnostics) {
  for (const key of Object.keys(userConfig)) {
    const deprecation = topLevelDeprecation(key);
    if (deprecation) {
      const diagnostic = isUnwritten(userConfig[key]) ? null : deprecationDiagnostic(deprecation, key, userConfig[key]);
      if (diagnostic) diagnostics.push(diagnostic);
      continue;
    }
    if (KNOWN_KEYS.has(key)) continue;
    const nearest = nearestKey(key, KNOWN_KEYS);
    if (nearest && TOP_LEVEL_KEYS.has(nearest)) rejectConfiguration("config.unknown_key", { key, suggestion: nearest });
    diagnostics.push(createDiagnostic("config.foreign_key", { path: key }));
  }
}
