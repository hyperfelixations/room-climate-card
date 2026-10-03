// What the data sources get wrong that the configuration alone cannot show, as diagnostics for
// presentation to word. A fault that stays until someone fixes it is a warning naming the
// entity; a source that is only momentarily out is a hint, and only while the card still has a
// value — without one, the no-data reason says it. Order: the mixed state, the main sensor, the
// rooms as written, range, trend. See internal dev doc §4 "Diagnosevertrag".

import { createDiagnostic, diagnosticKey } from "../../core/diagnostics.js";
import { rawUnitForEntity, UNUSABLE_REASON } from "./entity-model.js";
import { AUXILIARY_STATUS } from "./auxiliary-models.js";

// Each lasting reason as a code and what its sentence names: the class or unit the sensor
// reported, the measurement it was taken for, and the card's own (`cardMeasurement`).
const named = (code, facts = () => null) => Object.freeze({ code, facts });
export const LASTING = Object.freeze({
  [UNUSABLE_REASON.MISSING]: named("entity.not_found"),
  [UNUSABLE_REASON.FOREIGN_MEASUREMENT]: named("entity.foreign_measurement", (source) => ({ deviceClass: source.deviceClass })),
  [UNUSABLE_REASON.UNKNOWN_DEVICE_CLASS]: named("entity.unknown_device_class", (source) => ({ deviceClass: source.deviceClass })),
  [UNUSABLE_REASON.UNIT_AMBIGUOUS]: named("entity.unit_ambiguous", (source) => ({ unit: source.rawUnit })),
  [UNUSABLE_REASON.UNIDENTIFIED]: named("entity.unidentified"),
  [UNUSABLE_REASON.UNIT_UNKNOWN]: named("entity.unit_unknown", (source) => ({ unit: source.rawUnit })),
  [UNUSABLE_REASON.UNIT_MISSING]: named("entity.unit_missing", (source) => ({ measurement: source.metricKind })),
  [UNUSABLE_REASON.UNIT_UNREADABLE]: named("entity.unit_unreadable", (source) => ({ unit: source.rawUnit, measurement: source.metricKind })),
  [UNUSABLE_REASON.KIND_MISMATCH]: named("entity.other_measurement", (source, cardMeasurement) => ({ measurement: source.metricKind, cardMeasurement })),
});

// The reasons that pass by themselves; the no-data line words them (card-view-model.js).
export const MOMENTARY = Object.freeze(new Set([UNUSABLE_REASON.UNAVAILABLE, UNUSABLE_REASON.NOT_NUMERIC, UNUSABLE_REASON.OUT_OF_RANGE]));

const AUXILIARY_HINTS = [
  ["range_entity", "range", "hint.range_unavailable"],
  ["trend_entity", "trend", "hint.trend_unavailable"],
];

export function collectSourceDiagnostics({ context, config, states, range = null, trend = null }) {
  const warnings = [];
  const hints = [];
  const warned = new Set();
  // A sensor written as main sensor and as a room is named once.
  const warn = (code, entity, params = null) => {
    const diagnostic = createDiagnostic(code, { entity, params });
    const key = diagnosticKey(diagnostic);
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(diagnostic);
  };

  // Rooms that measure different things are one fact: none of them is the odd one out. A
  // declared foreign measurement is not part of that disagreement and is still named.
  const mixed = context.diagnostics.some((diagnostic) => diagnostic.code === "mixed_metric_kinds");
  if (mixed) warnings.push(createDiagnostic("sources.mixed"));
  const hasValue = context.averageSource !== null;
  const primary = context.primary.entityId ? context.primary : null;

  for (const source of primary ? [primary, ...context.rooms] : context.rooms) {
    if (!Object.hasOwn(LASTING, source.unusableReason) || (mixed && source.unusableReason === UNUSABLE_REASON.KIND_MISMATCH)) continue;
    const { code, facts } = LASTING[source.unusableReason];
    warn(code, source.entityId, facts(source, context.metricType));
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
    else if (status === AUXILIARY_STATUS.UNIT_MISSING) warn("entity.unit_missing", entity, { measurement: context.metricType });
    else if (status === AUXILIARY_STATUS.UNREADABLE) warn("entity.unit_unreadable", entity, { unit: rawUnitForEntity(states, entity), measurement: context.metricType });
    else if (status === AUXILIARY_STATUS.TRANSIENT && hasValue) hints.push(createDiagnostic(hint, { entity }));
  }
  return { warnings, hints };
}
