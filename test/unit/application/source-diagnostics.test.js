"use strict";

// Direct unit tests for application/model/source-diagnostics.js: what the data sources get
// wrong that the configuration alone cannot show, as diagnostics. Boundary: which sources
// take part and why one is unusable is measurement-context.js's to decide and its tests' to
// pin; how a diagnostic reads is notices.js's (unit/presentation/notices.test.js). This file
// owns only the step between the two. See internal dev doc §4 "Diagnosevertrag".

const test = require("node:test");
const assert = require("node:assert/strict");

let sources;
let core;

test.before(async () => {
  sources = await import("../../../src/application/model/source-diagnostics.js");
  core = await import("../../../src/core/diagnostics.js");
});

test("rooms that measure different things are one warning", () => {
  const context = {
    diagnostics: [
      { code: "mixed_metric_kinds", metricKinds: ["temperature", "humidity"] },
      { code: "unusable_unit", entityId: "sensor.x", metricKind: "co2" },
    ],
  };
  assert.deepEqual(sources.collectSourceDiagnostics({ context }), { warnings: [core.createDiagnostic("sources.mixed")], hints: [] });
});

test("sources without the mixed state give nothing to warn about", () => {
  assert.deepEqual(sources.collectSourceDiagnostics({ context: { diagnostics: [] } }), { warnings: [], hints: [] });
  assert.deepEqual(
    sources.collectSourceDiagnostics({ context: { diagnostics: [{ code: "unusable_unit", entityId: "sensor.x", metricKind: "co2" }] } }),
    { warnings: [], hints: [] }
  );
});
