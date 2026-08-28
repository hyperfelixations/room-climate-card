"use strict";

// Direct unit tests for the registered view renderers and their patch paths.
//
// Markup and DOM patching are pure functions of a view model, and these tests take that
// literally: no custom element anywhere in this file, no hass object, no configuration, and —
// for most of it — no global document either. A view model is written by hand, a renderer is
// called, and the resulting string or DOM is asserted.
//
// This file owns what happens INSIDE a view: the scale, the daily-range scale, the range
// cards and the extremes cards — their markup, the patch that updates them without a rebuild,
// and the geometry that is deliberately not computed for a view nobody asked for.
//
// The boundary to render-shell.test.js next door: the markup AROUND the views, the structure
// signatures and the stylesheet are that file's subject.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { marker, scaleBarContent, metricCardModel, viewModel } = require("../../fixtures/render-models.js");

let renderContext;
let registry;
let scaleView;
let rangeScaleView;
let rangeViewModule;
let extremesViewModule;

test.before(async () => {
  renderContext = await import("../../../src/render/primitives/render-context.js");
  registry = await import("../../../src/views/registry.js");
  scaleView = await import("../../../src/views/scale.js");
  rangeScaleView = await import("../../../src/views/range-scale.js");
  rangeViewModule = await import("../../../src/views/range.js");
  extremesViewModule = await import("../../../src/views/extremes.js");
});

// ------------------------------------------------------------------ fixtures --

// A fresh jsdom window per call. Used both as "the" document and, deliberately, as a
// SECOND, foreign realm — no render module may care which one it is handed.
function makeRealm() {
  const jsdom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const ownerDocument = jsdom.window.document;
  return {
    jsdom,
    ownerDocument,
    root: ownerDocument.getElementById("root"),
    context: renderContext.createRenderContext(ownerDocument),
  };
}

// ----------------------------------------------------------------- view modules --

test("each view renders its own container and patches it without touching the others", () => {
  const realm = makeRealm();
  const scaleModel = viewModel();
  realm.root.innerHTML = scaleView.scaleView.render(realm.context, scaleModel);
  assert.match(realm.root.innerHTML, /rtc-scale-view/);
  assert.match(realm.root.innerHTML, /rtc-marker-avg/);
  // The comfort label's initial text comes from the content model's LONG form. Asserted
  // because the alternative is silent: a fixture that still carried the pre-pair shape
  // rendered the string "undefined" here and nothing in this file noticed.
  assert.equal(
    realm.root.querySelector(".rtc-scale-comfort-label").textContent,
    "Comfort 20–24 °C",
    "the rendered comfort label must be the long form, not an undefined field"
  );

  // A patch with changed content updates the mounted nodes in place.
  const changed = viewModel();
  changed.views.byKey.scale.footerText = "2 of 4 in comfort";
  changed.views.byKey.scale.markers.average = marker({ position: 70, title: "Average 24.0 °C" });
  scaleView.scaleView.patch(realm.context, realm.root, changed);
  assert.equal(realm.root.querySelector(".rtc-scale-footer").textContent, "2 of 4 in comfort");
  assert.match(realm.root.querySelector(".rtc-marker-avg").getAttribute("style"), /left:70%/);
});

test("the scale view's marker set follows the resolved option, extremes and rooms alike", () => {
  const realm = makeRealm();
  const withExtremes = viewModel();
  withExtremes.views.byKey.scale.markers.extremes = {
    cold: marker({ position: 20, shiftPx: -4, title: "Coldest room: KI 19.2 °C" }),
    warm: marker({ position: 80, shiftPx: 4, title: "Warmest room: BA 24.4 °C" }),
  };
  const extremaHtml = scaleView.scaleView.render(realm.context, withExtremes);
  assert.match(extremaHtml, /rtc-marker-cold/);
  assert.match(extremaHtml, /left:calc\(20% \+ -4px\)/);
  assert.ok(!extremaHtml.includes("rtc-marker-room"));

  const withRooms = viewModel();
  withRooms.views.byKey.scale.markers.rooms = [
    { ...marker({ position: 20, title: "KI: 19.2 °C" }), index: 0 },
    { ...marker({ position: 80, title: "BA: 24.4 °C" }), index: 1 },
  ];
  withRooms.views.byKey.scale.emphasizeAverage = true;
  const roomsHtml = scaleView.scaleView.render(realm.context, withRooms);
  assert.equal((roomsHtml.match(/rtc-marker-room/g) || []).length, 2);
  assert.match(roomsHtml, /data-room-marker-index="1"/);
  assert.match(roomsHtml, /rtc-marker-avg rtc-marker-emphasized/);
});

test("the scale view's room markers are patched by room index, adding and removing as availability changes", () => {
  const realm = makeRealm();
  const model = viewModel();
  model.views.byKey.scale.markers.rooms = [
    { ...marker({ position: 20 }), index: 0 },
    { ...marker({ position: 80 }), index: 5 },
  ];
  realm.root.innerHTML = scaleView.scaleView.render(realm.context, model);
  assert.deepEqual(
    [...realm.root.querySelectorAll(".rtc-marker-room")].map((el) => el.dataset.roomMarkerIndex),
    ["0", "5"]
  );

  const fewer = viewModel();
  fewer.views.byKey.scale.markers.rooms = [{ ...marker({ position: 30 }), index: 5 }];
  scaleView.scaleView.patch(realm.context, realm.root, fewer);
  assert.deepEqual(
    [...realm.root.querySelectorAll(".rtc-marker-room")].map((el) => el.dataset.roomMarkerIndex),
    ["5"],
    "the stale marker is removed, the surviving one keyed by its original index"
  );
});

test("a view's patch is a no-op when that view has no content model", () => {
  const realm = makeRealm();
  realm.root.innerHTML = "<div></div>";
  const before = realm.root.innerHTML;
  for (const view of registry.VIEW_RENDERERS) view.patch(realm.context, realm.root, viewModel());
  assert.equal(realm.root.innerHTML, before, "an inactive view touches nothing");
});

test("the daily-range and extreme views render two cards each, in a structurally fixed order", () => {
  const realm = makeRealm();
  const rangeCards = [metricCardModel({ label: "Daily minimum" }), metricCardModel({ label: "Daily maximum" })];
  const model = viewModel();
  model.views.byKey.range = { key: "range", cards: rangeCards };
  model.views.byKey.extremes = { key: "extremes", cards: rangeCards };

  const rangeHtml = rangeViewModule.rangeView.render(realm.context, model);
  assert.match(rangeHtml, /rtc-range-view/);
  assert.ok(rangeHtml.indexOf("Daily minimum") < rangeHtml.indexOf("Daily maximum"));

  const extremesHtml = extremesViewModule.extremesView.render(realm.context, model);
  assert.match(extremesHtml, /rtc-extremes-view/);
  assert.equal((extremesHtml.match(/rtc-extreme-card/g) || []).length, 2);
});

test("the range-scale view renders its three top labels in min-before-max order above their markers", () => {
  const realm = makeRealm();
  const model = viewModel();
  model.views.byKey.range_scale = {
    ...scaleBarContent({ key: "range_scale" }),
    topLabels: {
      current: { long: "now", short: "now", position: 50, sortKey: "22.0", value: 22 },
      sides: [
        { role: "min", text: "min", position: 10, value: 18, sortKey: "18.0", semanticRank: 0 },
        { role: "max", text: "max", position: 90, value: 26, sortKey: "26.0", semanticRank: 2 },
      ],
    },
    markers: { min: marker({ position: 10 }), max: marker({ position: 90 }), average: marker({ position: 50 }) },
  };
  const html = rangeScaleView.rangeScaleView.render(realm.context, model);
  assert.ok(html.indexOf("rtc-range-scale-label-current") < html.indexOf("rtc-range-scale-label-min"));
  assert.ok(html.indexOf("rtc-range-scale-label-min") < html.indexOf("rtc-range-scale-label-max"));
  assert.match(html, /rtc-range-scale-label-max" style="left:90%"/);

  realm.root.innerHTML = html;
  model.views.byKey.range_scale.topLabels.sides[0].position = 25;
  rangeScaleView.rangeScaleView.patch(realm.context, realm.root, model);
  assert.equal(realm.root.querySelector(".rtc-range-scale-label-min").style.left, "25%");
});

