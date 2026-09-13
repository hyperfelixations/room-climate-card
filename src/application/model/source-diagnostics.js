// What the data sources get wrong that the configuration alone cannot show, as diagnostics for
// presentation to word. A fault that stays until someone fixes it is a warning naming the
// entity; a source that is only momentarily out is a hint, and only while the card still has a
// value — without one, the no-data reason says it. Order: the mixed state, the main sensor, the
// rooms as written, range, trend. See internal dev doc §4 "Diagnosevertrag".

import { createDiagnostic, diagnosticKey } from "../../core/diagnostics.js";
import { UNUSABLE_REASON } from "./entity-model.js";
import { AUXILIARY_STATUS } from "./auxiliary-models.js";

const LASTING = Object.freeze({
  [UNUSABLE_REASON.MISSING]: "entity.not_found",
  [UNUSABLE_REASON.UNIT_AMBIGUOUS]: "entity.unit_ambiguous",
  [UNUSABLE_REASON.UNIDENTIFIED]: "entity.unidentified",
  [UNUSABLE_REASON.UNIT_UNREADABLE]: "entity.unit_unreadable",
  [UNUSABLE_REASON.KIND_MISMATCH]: "entity.other_measurement",
});

const MOMENTARY = new Set([UNUSABLE_REASON.UNAVAILABLE, UNUSABLE_REASON.NOT_NUMERIC, UNUSABLE_REASON.OUT_OF_RANGE]);

const AUXILIARY_HINTS = [
  ["range_entity", "range", "hint.range_unavailable"],
  ["trend_entity", "trend", "hint.trend_unavailable"],
];

export function collectSourceDiagnostics({ context, config, states, range = null, trend = null }) {
  const warnings = [];
  const hints = [];
  const named = new Set();
  // A sensor written as main sensor and as a room is named once.
  const warn = (code, entity) => {
    const diagnostic = createDiagnostic(code, { entity });
    const key = diagnosticKey(diagnostic);
    if (named.has(key)) return;
    named.add(key);
    warnings.push(diagnostic);
  };

  // Rooms that measure different things are one fact: none of them is the odd one out.
  const mixed = context.diagnostics.some((diagnostic) => diagnostic.code === "mixed_metric_kinds");
  if (mixed) warnings.push(createDiagnostic("sources.mixed"));
  const hasValue = context.averageSource !== null;
  const primary = context.primary.entityId ? context.primary : null;

  for (const source of primary ? [primary, ...context.rooms] : context.rooms) {
    const code = LASTING[source.unusableReason];
    if (code && !(mixed && code === "entity.other_measurement")) warn(code, source.entityId);
  }

  if (hasValue && primary && MOMENTARY.has(primary.unusableReason) && context.averageSource.kind === "roomConsensus") {
    hints.push(createDiagnostic("hint.primary_unavailable", { entity: primary.entityId }));
  }
  const roomsOut = context.rooms.filter((room) => MOMENTARY.has(room.unusableReason) && room.entityId !== primary?.entityId).length;
  if (hasValue && roomsOut > 0) hints.push(createDiagnostic("hint.rooms_unavailable", { params: { count: roomsOut } }));

  const models = { range, trend };
  for (const [option, modelName, hint] of AUXILIARY_HINTS) {
    const entity = config[option];
    if (!entity) continue;
    // Without a value the models are not built, so the sensor is checked for existence only.
    const model = models[modelName];
    const status = model ? model.source.status : states?.[entity] ? null : AUXILIARY_STATUS.MISSING;
    if (status === AUXILIARY_STATUS.MISSING) warn("entity.not_found", entity);
    else if (status === AUXILIARY_STATUS.UNREADABLE) warn("entity.unit_unreadable", entity);
    else if (status === AUXILIARY_STATUS.TRANSIENT && hasValue) hints.push(createDiagnostic(hint, { entity }));
  }
  return { warnings, hints };
}
