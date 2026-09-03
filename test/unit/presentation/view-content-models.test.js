"use strict";

// Direct unit tests for lazy per-view content construction and range-scale activation:
// whether requested views build their content and expensive geometry.
// Boundary: shared CardViewModel composition and formatting is the neighbouring
// presentation suite, keeping laziness failures separate from general mapping.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { cfg, minimalDomainModel, stubTexts } = require("../../fixtures/presentation-models.js");

let cardViewModel;
let viewContent;

test.before(async () => {
  cardViewModel = await import("../../../src/presentation/view-model/card-view-model.js");
  viewContent = await import("../../../src/presentation/view-model/view-content/index.js");
});

// ------------------------------------------------- lazy view content models --

// The daily-range scale is available whenever the range entity reports a usable min/max
// pair, but off unless a views: list asks for it. Its axis arrives as a thunk; these tests
// call buildViewContent() with a counting thunk to prove it is not built when unrequested.
function sharedFor(overrides = {}) {
  const texts = stubTexts();
  const geometry = {
    scaleMin: 19, scaleMax: 25, comfortLeft: 0, comfortWidth: 100, comfortVisible: true, comfortCenter: 50,
    optimalLeft: 25, optimalWidth: 50, optimalVisible: true, optimalCenter: 50, optimalMin: 21, optimalMax: 23,
    displayStep: 1, markerPositions: { avg: 50, current: 50, min: 10, max: 90 },
    boundaryLabels: { min: "19", max: "25" },
  };
  return {
    metricKind: "temperature",
    unit: "°C",
    texts,
    comfort: { min: 20, max: 24, inComfort: 1, tooWarm: 0, tooCool: 1 },
    optimal: { min: 21, max: 23 },
    spread: 2,
    hideFooter: false,
    rangeEntity: "sensor.range",
    average: { value: 22, label: "Average", hasLabel: true, position: 50, color: "#79A86C" },
    rooms: { comparable: true, count: 2, byValue: [] },
    roomColors: {},
    extremes: null,
    roomMarkers: [],
    range: { hasRange: true, state: 5, min: 18, max: 25, minTime: "06:10", maxTime: "15:20", minColor: "#1", maxColor: "#2" },
    trend: { value: null, unit: null, model: null, text: "" },
    scale: geometry,
    geometry,
    ...overrides,
  };
}

function stateWith(keys) {
  return {
    keys,
    entries: [],
    collapsed: keys.length === 0,
    hasRangeScale: keys.includes("range_scale"),
    options: {
      range: { show_time: true },
      range_scale: { show_comfort_band: true, show_optimal_band: true, footer: "detailed" },
      scale: { show_comfort_band: true, show_optimal_band: true, footer: true, markers: "extremes" },
      extremes: { show_value: true },
    },
  };
}

test("an available but not activated range-scale view builds no geometry at all", () => {
  let axisBuilds = 0;
  const shared = sharedFor({
    buildRangeScaleAxis: () => {
      axisBuilds += 1;
      return sharedFor().geometry;
    },
  });
  const byKey = viewContent.buildViewContent({ shared, viewState: stateWith(["scale"]) });
  assert.equal(axisBuilds, 0, "the axis builder must not be called for an inactive view");
  assert.equal(byKey.range_scale, null);
  assert.ok(byKey.scale, "the active view is still built");
});

test("an activated range-scale view builds its geometry exactly once", () => {
  let axisBuilds = 0;
  const shared = sharedFor({
    buildRangeScaleAxis: () => {
      axisBuilds += 1;
      return sharedFor().geometry;
    },
  });
  const byKey = viewContent.buildViewContent({ shared, viewState: stateWith(["range_scale", "scale"]) });
  assert.equal(axisBuilds, 1, "once, not once per marker or per label");
  assert.ok(byKey.range_scale);
  assert.equal(byKey.range_scale.markers.min.position, 10);
  assert.equal(byKey.range_scale.topLabels.current.position, 50);
});

test("every inactive view gets a null content model, and the key set is complete", () => {
  const byKey = viewContent.buildViewContent({ shared: sharedFor({ buildRangeScaleAxis: () => sharedFor().geometry }), viewState: stateWith([]) });
  assert.deepEqual(Object.keys(byKey).sort(), ["extremes", "range", "range_scale", "scale"]);
  assert.deepEqual(Object.values(byKey), [null, null, null, null]);
});

test("the whole view model omits the range-scale geometry when the view is off, even when the data allows it", () => {
  const available = minimalDomainModel({
    range: { hasRange: true, state: 5, min: 18, max: 25, minTimestamp: null, maxTimestamp: null, minColor: "#1", maxColor: "#2", rangeScaleAvailable: true },
  });
  const off = cardViewModel.buildCardViewModel({ domainModel: available, config: cfg(), texts: stubTexts() });
  assert.equal(off.rangeScale, null, "available is not the same as requested");
  assert.equal(off.views.byKey.range_scale, null);

  const on = cardViewModel.buildCardViewModel({
    domainModel: available,
    config: cfg({ views: [{ type: "range_scale", enabled: true, options: {} }] }),
    texts: stubTexts(),
  });
  assert.ok(on.rangeScale, "and requested is what builds it");
  assert.ok(on.views.byKey.range_scale.markers.min);
});
