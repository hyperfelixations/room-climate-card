"use strict";

// Direct unit tests for the render primitives, the layout pass and the view registry.
// Markup and DOM patching are pure functions of a view model: no custom element, no hass, no
// configuration, mostly no global document — a view model is written by hand, a renderer is
// called, and the string or DOM is asserted. This file owns the pieces every view is built
// from (render context, headline, room grid, markers, scale bar, focus, DOM helpers, the
// label-placement layout pass) and the registry wiring.
// Boundary: render-shell.test.js owns the markup around the views and the stylesheet;
// render-views.test.js owns each view's own markup and patch path.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { marker, scaleBarContent, metricCardModel, chip, viewModel } = require("../../fixtures/render-models.js");

let renderContext;
let average;
let roomGrid;
let metricCardPrimitive;
let markerPrimitive;
let scaleBarPrimitive;
let focus;
let dom;
let labelForm;
let sideLabels;
let registry;
let viewContent;
let viewState;

test.before(async () => {
  renderContext = await import("../../../src/render/primitives/render-context.js");
  average = await import("../../../src/render/primitives/average.js");
  roomGrid = await import("../../../src/render/primitives/room-grid.js");
  metricCardPrimitive = await import("../../../src/render/primitives/metric-card.js");
  markerPrimitive = await import("../../../src/render/primitives/marker.js");
  scaleBarPrimitive = await import("../../../src/render/primitives/scale-bar.js");
  focus = await import("../../../src/render/primitives/focus.js");
  dom = await import("../../../src/render/primitives/dom.js");
  labelForm = await import("../../../src/render/layout/label-form.js");
  sideLabels = await import("../../../src/render/layout/side-labels.js");
  registry = await import("../../../src/views/registry.js");
  viewContent = await import("../../../src/presentation/view-model/view-content/index.js");
  viewState = await import("../../../src/presentation/view-model/view-state.js");
});

// ------------------------------------------------------------------ fixtures --

// A fresh jsdom window per call, used both as "the" document and as a second foreign realm —
// no render module may care which one it is handed.
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

// ------------------------------------------------------------------ registry --

test("the registry is composed from the view definitions' own order", () => {
  assert.deepEqual(
    registry.VIEW_RENDERERS.map((view) => view.key),
    viewState.VIEW_DEFINITIONS.map((definition) => definition.key),
    "on-screen order must be decided in exactly one place"
  );
});

test("every registered view has a render and a patch function, and unique keys", () => {
  const keys = registry.VIEW_RENDERERS.map((view) => view.key);
  assert.deepEqual([...new Set(keys)], keys, "no duplicate keys");
  for (const view of registry.VIEW_RENDERERS) {
    assert.equal(typeof view.render, "function", `${view.key}: render`);
    assert.equal(typeof view.patch, "function", `${view.key}: patch`);
    if (view.resolveLayout !== undefined) assert.equal(typeof view.resolveLayout, "function", `${view.key}: resolveLayout`);
  }
});

test("every view definition has a content builder, and every builder a definition", () => {
  // The same guard the view-content module runs at load time, asserted directly so a
  // failure names the mismatch rather than showing as an empty carousel slot.
  assert.deepEqual(viewContent.VIEW_CONTENT_KEYS, viewState.VIEW_DEFINITIONS.map((d) => d.key));
});

test("only the two scale-shaped views declare a layout pass", () => {
  const withLayout = registry.VIEW_RENDERERS.filter((view) => typeof view.resolveLayout === "function").map((v) => v.key);
  assert.deepEqual(withLayout, ["range_scale", "scale"], "in registry order");
});

// -------------------------------------------------------------- render context --

test("the render context exposes only the realm and its two element operations", () => {
  const realm = makeRealm();
  assert.deepEqual(Object.keys(realm.context).sort(), ["createElement", "defaultView", "htmlToElement", "ownerDocument"]);
  assert.equal(realm.context.ownerDocument, realm.ownerDocument);
  assert.equal(realm.context.defaultView, realm.jsdom.window);
});

test("the context creates elements in ITS realm, not the ambient one", () => {
  const first = makeRealm();
  const second = makeRealm();
  assert.equal(first.context.createElement("div").ownerDocument, first.ownerDocument);
  assert.equal(second.context.createElement("div").ownerDocument, second.ownerDocument);
  assert.notEqual(first.ownerDocument, second.ownerDocument);
});

test("htmlToElement parses one detached element from an already-escaped string", () => {
  const realm = makeRealm();
  const element = realm.context.htmlToElement('  <button class="x" data-entity="sensor.a">hi</button>  ');
  assert.equal(element.tagName, "BUTTON");
  assert.equal(element.getAttribute("data-entity"), "sensor.a");
  assert.equal(element.isConnected, false, "parsed into a throwaway wrapper, never into the live document");
  assert.equal(element.ownerDocument, realm.ownerDocument);
});

// ------------------------------------------------------------------- primitives --

test("the average renders a button with an entity and a plain div without one", () => {
  const model = viewModel();
  assert.match(average.renderAverage(model), /^\s*<button/);
  assert.match(average.renderAverage(model), /data-entity="sensor\.avg"/);

  const withoutEntity = viewModel({ average: { ...model.average, entity: "" } });
  const html = average.renderAverage(withoutEntity);
  assert.match(html, /^\s*<div/);
  assert.match(html, /rtc-avg-button-disabled/);
  assert.ok(!html.includes("data-entity"), "a non-interactive average carries no action hook");
});

test("the average's trend arrow is hidden without a direction and exposed with one", () => {
  const withoutTrend = average.renderAverage(viewModel());
  assert.match(withoutTrend, /rtc-avg-trend-arrow" aria-hidden="true" hidden/);
  assert.ok(!withoutTrend.includes("data-trend-direction"));

  const model = viewModel();
  const withTrend = average.renderAverage(viewModel({ average: { ...model.average, trendDirection: "rising" } }));
  assert.match(withTrend, /data-trend-direction="rising"/);
  assert.match(withTrend, /rtc-has-trend/);
});

test("the average omits its label node and residual spacing when hasLabel is false", () => {
  const model = viewModel();
  const html = average.renderAverage(viewModel({ average: { ...model.average, label: "", hasLabel: false } }));
  assert.ok(!html.includes("rtc-avg-label"));
  assert.match(html, /rtc-avg-button rtc-no-label/);
});

test("the room index is rendered, patched and removed with the headline identity", () => {
  const realm = makeRealm();
  const model = viewModel();
  const asRoom = viewModel({ average: { ...model.average, entity: "sensor.room", roomIndex: 0 } });
  const element = realm.context.htmlToElement(average.renderAverage(asRoom));
  assert.equal(element.getAttribute("data-room-index"), "0");

  average.patchAverage(element, model);
  assert.equal(element.hasAttribute("data-room-index"), false);

  average.patchAverage(element, asRoom);
  assert.equal(element.getAttribute("data-room-index"), "0");
});

test("patching the average mirrors every field the renderer writes", () => {
  const realm = makeRealm();
  const model = viewModel();
  const element = realm.context.htmlToElement(average.renderAverage(model));
  const changed = viewModel({
    average: { ...model.average, valueText: "23.4", label: "Mean", tooltip: "T", ariaLabel: "A", trendDirection: "falling" },
  });
  average.patchAverage(element, changed);
  assert.equal(element.querySelector(".rtc-avg-value-num").textContent, "23.4");
  assert.equal(element.querySelector(".rtc-avg-label").textContent, "Mean");
  assert.equal(element.getAttribute("title"), "T");
  assert.equal(element.getAttribute("aria-label"), "A");
  assert.equal(element.getAttribute("data-trend-direction"), "falling");
  assert.equal(element.querySelector(".rtc-avg-trend-arrow").hidden, false);

  average.patchAverage(element, model);
  assert.equal(element.hasAttribute("data-trend-direction"), false, "a vanished trend removes the attribute");
  assert.equal(element.querySelector(".rtc-avg-trend-arrow").hidden, true);
});

test("a marker's style uses calc() only where a pixel nudge can apply", () => {
  assert.equal(
    markerPrimitive.markerStyle(marker({ position: 40, shiftPx: -4 }), { useShift: true }),
    "left:calc(40% + -4px);--marker-color:#4488cc;--marker-shadow:rgba(68,136,204,0.28);"
  );
  assert.equal(
    markerPrimitive.markerStyle(marker({ position: 40 })),
    "left:40%;--marker-color:#4488cc;--marker-shadow:rgba(68,136,204,0.28);"
  );
});

test("a marker's tooltip is escaped", () => {
  const html = markerPrimitive.renderMarker(marker({ title: '<img src=x onerror="alert(1)">' }), {
    classNames: "rtc-marker rtc-marker-avg",
  });
  assert.ok(!html.includes("<img"), "no raw tag may survive into the attribute");
  assert.match(html, /&lt;img/);
});

test("the scale bar omits a band and its label entirely when the option is off", () => {
  const withBands = scaleBarPrimitive.renderScaleBar({ content: scaleBarContent(), viewClass: "v", topRowHtml: "", markersHtml: "" });
  assert.match(withBands, /rtc-comfort-band/);
  assert.match(withBands, /rtc-optimal-band/);
  assert.match(withBands, /rtc-scale-label-center/);

  const withoutBands = scaleBarPrimitive.renderScaleBar({
    content: scaleBarContent({ showComfortBand: false, showOptimalBand: false, optimalLabel: null }),
    viewClass: "v",
    topRowHtml: "",
    markersHtml: "",
  });
  assert.ok(!withoutBands.includes("rtc-comfort-band"));
  assert.ok(!withoutBands.includes("rtc-optimal-band"));
  assert.ok(!withoutBands.includes("rtc-scale-label-center"));
});

test("the scale bar's footer only exists when there is footer text", () => {
  const withFooter = scaleBarPrimitive.renderScaleBar({ content: scaleBarContent(), viewClass: "v", topRowHtml: "", markersHtml: "" });
  assert.match(withFooter, /rtc-scale-footer/);
  const withoutFooter = scaleBarPrimitive.renderScaleBar({
    content: scaleBarContent({ footerText: null }),
    viewClass: "v",
    topRowHtml: "",
    markersHtml: "",
  });
  assert.ok(!withoutFooter.includes("rtc-scale-footer"));
});

test("patching the scale bar leaves the optimal label's text and position to the layout pass", () => {
  const realm = makeRealm();
  realm.root.innerHTML = scaleBarPrimitive.renderScaleBar({
    content: scaleBarContent(),
    viewClass: "rtc-scale-view",
    topRowHtml: "",
    markersHtml: "",
  });
  const container = realm.root.querySelector(".rtc-scale-view");
  const labelBefore = container.querySelector(".rtc-scale-label-center").textContent;

  scaleBarPrimitive.patchScaleBar(container, scaleBarContent({ footerText: "changed", boundaryLabels: { min: "0 °C", max: "40 °C" } }));
  assert.equal(container.querySelector(".rtc-scale-footer").textContent, "changed");
  assert.equal(container.querySelector(".rtc-scale-label-min").textContent, "0 °C");
  assert.equal(container.querySelector(".rtc-scale-label-max").textContent, "40 °C");
  assert.equal(container.querySelector(".rtc-scale-label-center").textContent, labelBefore, "untouched by the bar patch");
});

test("a metric card omits a hidden field from the tooltip and the ARIA label too", () => {
  const html = metricCardPrimitive.renderMetricCard(metricCardModel({ numText: "", unitText: "", title: "Coldest room: Kitchen" }));
  assert.match(html, /title="Coldest room: Kitchen"/);
  assert.match(html, /<span class="rtc-extreme-value-num"><\/span>/);
});

test("a metric card without a room index carries no room hook", () => {
  const html = metricCardPrimitive.renderMetricCard(metricCardModel({ roomIndex: null }));
  assert.ok(!html.includes("data-room-index"));
  assert.match(metricCardPrimitive.renderMetricCard(metricCardModel()), /data-room-index="0"/);
});

test("patching a metric card pair reuses the nodes and keeps their identity", () => {
  const realm = makeRealm();
  const models = [metricCardModel(), metricCardModel({ label: "Warmest room", nameText: "Bath", roomIndex: 1, entity: "sensor.bath" })];
  realm.root.innerHTML = metricCardPrimitive.renderMetricCards(models);
  const before = [...realm.root.querySelectorAll(".rtc-extreme-card")];
  assert.equal(before.length, 2);

  const changed = [metricCardModel({ nameText: "Hall", numText: "18.1" }), models[1]];
  metricCardPrimitive.patchMetricCardPair(realm.root, changed, () => {
    throw new Error("must not re-render");
  });
  const after = [...realm.root.querySelectorAll(".rtc-extreme-card")];
  assert.equal(after[0], before[0], "the same node is patched, not replaced");
  assert.equal(after[1], before[1]);
  assert.equal(after[0].querySelector(".rtc-extreme-name").textContent, "Hall");
  assert.equal(after[0].querySelector(".rtc-extreme-value-num").textContent, "18.1");
});

test("patching a metric card pair falls back to a re-render when the DOM does not hold the pair", () => {
  const realm = makeRealm();
  realm.root.innerHTML = "<div></div>";
  let rerendered = false;
  metricCardPrimitive.patchMetricCardPair(realm.root, [metricCardModel()], () => {
    rerendered = true;
    return "<span>x</span>";
  });
  assert.equal(rerendered, true);
});

test("the room grid renders one row per row descriptor, with its own column count", () => {
  const model = viewModel({
    rooms: {
      ...viewModel().rooms,
      chipRows: [
        { columnCount: 1, chips: [chip(0, "KI")] },
        { columnCount: 1, chips: [chip(1, "BA")] },
      ],
    },
  });
  const html = roomGrid.renderRoomGridRows(model);
  assert.equal((html.match(/rtc-room-row/g) || []).length, 2);
  assert.equal((html.match(/repeat\(1, minmax\(0, 1fr\)\)/g) || []).length, 2);
});

test("the room grid reuses a chip node by entity and never moves one already in place", () => {
  const realm = makeRealm();
  const model = viewModel();
  realm.root.innerHTML = `<div class="rtc-room-grid">${roomGrid.renderRoomGridRows(model)}</div>`;
  const gridEl = realm.root.querySelector(".rtc-room-grid");
  const before = [...gridEl.querySelectorAll(".rtc-room-chip")];

  const changed = viewModel({
    rooms: {
      ...model.rooms,
      chips: [chip(0, "KI", { valueText: "20.5" }), chip(1, "BA")],
      chipRows: [{ columnCount: 2, chips: [chip(0, "KI", { valueText: "20.5" }), chip(1, "BA")] }],
    },
  });
  roomGrid.updateRoomGrid(realm.context, realm.root, gridEl, changed);
  const after = [...gridEl.querySelectorAll(".rtc-room-chip")];
  assert.deepEqual(after, before, "identity preserved for every chip");
  assert.equal(after[0].querySelector(".rtc-room-value-num").textContent, "20.5");
});

test("the room grid removes a chip whose room disappeared and grows for a new one", () => {
  const realm = makeRealm();
  const model = viewModel();
  realm.root.innerHTML = `<div class="rtc-room-grid">${roomGrid.renderRoomGridRows(model)}</div>`;
  const gridEl = realm.root.querySelector(".rtc-room-grid");

  const oneRoom = [chip(1, "BA")];
  roomGrid.updateRoomGrid(realm.context, realm.root, gridEl, viewModel({
    rooms: { ...model.rooms, chips: oneRoom, chipRows: [{ columnCount: 1, chips: oneRoom }] },
  }));
  assert.deepEqual(
    [...gridEl.querySelectorAll(".rtc-room-chip")].map((el) => el.getAttribute("data-entity")),
    ["sensor.r1"]
  );

  const threeRooms = [chip(0, "KI"), chip(1, "BA"), chip(2, "SZ")];
  roomGrid.updateRoomGrid(realm.context, realm.root, gridEl, viewModel({
    rooms: { ...model.rooms, chips: threeRooms, chipRows: [{ columnCount: 3, chips: threeRooms }] },
  }));
  assert.equal(gridEl.querySelectorAll(".rtc-room-chip").length, 3);
  assert.equal(gridEl.children.length, 1, "row wrappers are trimmed back to what is needed");
});

test("a chip's shortGuaranteed flag is actively removed once it no longer applies", () => {
  const realm = makeRealm();
  const element = realm.context.htmlToElement(roomGrid.renderRoomChip(chip(0, "KI")));
  assert.equal(element.querySelector(".rtc-room-short").hasAttribute("data-short-guaranteed"), true);
  roomGrid.patchRoomChip(element, chip(0, "Kitchen", { shortGuaranteed: false }));
  assert.equal(element.querySelector(".rtc-room-short").hasAttribute("data-short-guaranteed"), false);
});

test("the focus fallback prefers the interactive average and falls back to the card root", () => {
  const realm = makeRealm();
  realm.root.innerHTML = '<div class="rtc-root" tabindex="-1"><button class="rtc-avg-button"></button></div>';
  assert.equal(focus.focusFallbackTarget(realm.root).tagName, "BUTTON");

  realm.root.innerHTML = '<div class="rtc-root" tabindex="-1"><div class="rtc-avg-button rtc-avg-button-disabled"></div></div>';
  assert.ok(focus.focusFallbackTarget(realm.root).classList.contains("rtc-root"), "the disabled shape is not focusable");

  assert.equal(focus.focusFallbackTarget(null), null);
});

// --------------------------------------------------------------------- layout --

test("the label form prefers the long text and only substitutes the short one when it does not fit", () => {
  const realm = makeRealm();
  const node = realm.context.createElement("span");
  let calls = 0;
  labelForm.resolveLabelForm(node, "now", "now", () => {
    calls += 1;
    return false;
  });
  assert.equal(node.textContent, "now");
  assert.equal(calls, 0, "identical forms short-circuit before measuring");

  labelForm.resolveLabelForm(node, "maintenant", "act.", () => true);
  assert.equal(node.textContent, "maintenant");
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => false);
  assert.equal(node.textContent, "act.");
});

test("the label form reverts to the long text as soon as it fits again (idempotent across calls)", () => {
  const realm = makeRealm();
  const node = realm.context.createElement("span");
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => false);
  assert.equal(node.textContent, "act.");
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => true);
  assert.equal(node.textContent, "maintenant", "growing back out restores the long form on the very next pass");
});

test("the side-label layout is a no-op for an empty group and orders a non-empty one", () => {
  const realm = makeRealm();
  const make = (anchor, width) => ({ el: realm.context.createElement("span"), anchor, width });
  assert.equal(sideLabels.layoutSideLabelGroup([], 0, 100, 4), undefined);

  const items = [make(10, 20), make(15, 20)];
  sideLabels.layoutSideLabelGroup(items, 0, 100, 4);
  assert.ok(items[1].left >= items[0].left + items[0].width + 4, "the second is pushed clear of the first");
  assert.ok(items[0].left >= 0, "and the group stays inside the left edge");
});

test("the side-label layout keeps a group inside its right edge", () => {
  const realm = makeRealm();
  const items = [
    { el: realm.context.createElement("span"), anchor: 95, width: 20 },
    { el: realm.context.createElement("span"), anchor: 98, width: 20 },
  ];
  sideLabels.layoutSideLabelGroup(items, 0, 100, 4);
  assert.ok(items[1].left + items[1].width <= 100 + 1e-9);
});

test("computedStyleOf resolves against the element's OWN realm", () => {
  const first = makeRealm();
  const second = makeRealm();
  // jsdom has a working getComputedStyle per realm; neither call needs an ambient window.
  assert.equal(typeof dom.computedStyleOf(first.root).display, "string");
  assert.equal(typeof dom.computedStyleOf(second.root).display, "string");
  assert.equal(dom.measuredWidth(first.root), 0, "jsdom reports zero geometry, which is fine — the value is not asserted");
});
