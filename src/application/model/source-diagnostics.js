// What the data sources get wrong that the configuration alone cannot show, as diagnostics
// for presentation to word. See internal dev doc §4 "Diagnosevertrag".

import { createDiagnostic } from "../../core/diagnostics.js";

export function collectSourceDiagnostics({ context }) {
  const warnings = [];
  if (context.diagnostics.some((diagnostic) => diagnostic.code === "mixed_metric_kinds")) {
    warnings.push(createDiagnostic("sources.mixed"));
  }
  return { warnings, hints: [] };
}
