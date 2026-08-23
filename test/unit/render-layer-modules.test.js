"use strict";

// Direct unit tests for src/render/*, src/views/* and src/styles/*.
//
// Markup and DOM patching are pure functions of a view model. These tests take that
// literally: there is no custom
// element anywhere in this file, no hass object, no configuration, and — for most of
// it — no global document either. A view model is written by hand, a renderer is
// called, and the resulting string or DOM is asserted.
//
// The renderer must work in a jsdom realm that is not the ambient one, and the daily-range
// scale's geometry is never computed for a view nobody asked for.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

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
let cardShell;
let registry;
let scaleView;
let rangeScaleView;
let rangeViewModule;
let extremesViewModule;
let styles;
let viewContent;
let viewState;

test.before(async () => {
  renderContext = await import("../../src/render/primitives/render-context.js");
  average = await import("../../src/render/primitives/average.js");
  roomGrid = await import("../../src/render/primitives/room-grid.js");
  metricCardPrimitive = await import("../../src/render/primitives/metric-card.js");
  markerPrimitive = await import("../../src/render/primitives/marker.js");
  scaleBarPrimitive = await import("../../src/render/primitives/scale-bar.js");
  focus = await import("../../src/render/primitives/focus.js");
  dom = await import("../../src/render/primitives/dom.js");
  labelForm = await import("../../src/render/layout/label-form.js");
  sideLabels = await import("../../src/render/layout/side-labels.js");
  cardShell = await import("../../src/render/composition/card-shell.js");
  registry = await import("../../src/views/registry.js");
  scaleView = await import("../../src/views/scale.js");
  rangeScaleView = await import("../../src/views/range-scale.js");
  rangeViewModule = await import("../../src/views/range.js");
  extremesViewModule = await import("../../src/views/extremes.js");
  styles = await import("../../src/styles/index.js");
  viewContent = await import("../../src/presentation/view-model/view-content/index.js");
  viewState = await import("../../src/presentation/view-model/view-state.js");
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

function marker(overrides = {}) {
  return { position: 50, shiftPx: 0, color: "#4488cc", shadow: "rgba(68,136,204,0.28)", title: "Tooltip", ...overrides };
}

function axis(overrides = {}) {
  return {
    scaleMin: 19,
    scaleMax: 25,
    comfortLeft: 16.7,
    comfortWidth: 66.7,
    comfortVisible: true,
    comfortCenter: 50,
    optimalLeft: 33.3,
    optimalWidth: 33.3,
    optimalVisible: true,
    optimalCenter: 50,
    optimalMin: 21,
    optimalMax: 23,
    displayStep: 1,
    markerPositions: { avg: 50, min: 20, max: 80, current: 50, coolest: 20, warmest: 80 },
    boundaryLabels: { min: "19 °C", max: "25 °C" },
    ...overrides,
  };
}

function scaleBarContent(overrides = {}) {
  return {
    key: "scale",
    geometry: axis(),
    showComfortBand: true,
    showOptimalBand: true,
    optimalLabel: { long: "Optimal 21–23 °C", short: "Opt. 21–23 °C", center: 50, visible: true },
    boundaryLabels: axis().boundaryLabels,
    footerText: "3 of 4 in comfort",
    ...overrides,
  };
}

function metricCardModel(overrides = {}) {
  return {
    label: "Coldest room",
    nameText: "Kitchen",
    numText: "19.2",
    unitText: " °C",
    roomIndex: 0,
    entity: "sensor.kitchen",
    color: "#4488cc",
    background: "rgba(68,136,204,0.09)",
    border: "rgba(68,136,204,0.36)",
    lineShadow: "rgba(68,136,204,0.24)",
    title: "Coldest room: Kitchen 19.2 °C",
    ariaLabel: "Open Coldest room Kitchen",
    ...overrides,
  };
}

function chip(index, label, overrides = {}) {
  return {
    room: { index, name: label },
    entity: `sensor.r${index}`,
    index,
    displayLabel: label,
    shortGuaranteed: true,
    color: "#4488cc",
    mark: "•",
    out: false,
    markBackground: "rgba(68,136,204,0.18)",
    background: "var(--rtc-chip-bg)",
    border: "var(--rtc-hairline)",
    valueText: "21.0",
    unitText: "°C",
    title: `${label}: 21.0 °C`,
    ariaLabel: `Open ${label}`,
    ...overrides,
  };
}

// A complete, hand-written CardViewModel. Only the fields the rendering layer reads —
// which is exactly the point: if a renderer needed anything else, this fixture could
// not exist.
function viewModel(overrides = {}) {
  const chips = [chip(0, "KI"), chip(1, "BA")];
  return {
    empty: false,
    metric: { kind: "temperature", unit: "°C", displayUnitProfile: null },
    title: "Temperature",
    subtitle: "All rooms comfortable",
    tone: { label: "Optimal", color: "#79A86C", soft: "rgba(121,168,108,0.2)", icon: "mdi:thermometer" },
    toneStyle: "--tone-color:#79A86C;--tone-soft:rgba(121,168,108,0.2);",
    header: { icon: "mdi:thermometer", title: "Temperature", subtitle: "All rooms comfortable", hasSubtitle: true, subtitleOverflow: "clip", statusLabel: "Optimal" },
    average: {
      value: 22,
      valueText: "22.0",
      unitText: "°C",
      label: "Average",
      hasLabel: true,
      entity: "sensor.avg",
      source: "sensor",
      roomIndex: null,
      color: "#79A86C",
      position: 50,
      tooltip: "Average 22.0 °C",
      ariaLabel: "Open average",
      trendDirection: null,
    },
    rooms: {
      visible: chips.map((c) => c.room),
      rowSizes: [{ itemCount: 2, columnCount: 2 }],
      count: 2,
      comparable: true,
      showChips: true,
      chips,
      chipRows: [{ columnCount: 2, chips }],
    },
    roomMarkers: [],
    carousel: { hint: "Swipe to switch views", noActiveViewsHint: "No views available" },
    views: {
      keys: ["scale"],
      entries: [],
      options: {},
      collapsed: false,
      hasRangeScale: false,
      byKey: {
        range: null,
        range_scale: null,
        scale: {
          ...scaleBarContent(),
          comfortLabel: { long: "Comfort 20–24 °C", short: "Comfort 20–24 °C", center: 50, visible: true },
          emphasizeAverage: false,
          markers: { extremes: null, rooms: [], average: marker() },
        },
        extremes: null,
      },
    },
    ...overrides,
  };
}

function emptyViewModel(overrides = {}) {
  const base = viewModel();
  return {
    ...base,
    empty: true,
    metric: { kind: "co2", unit: "", displayUnitProfile: null },
    title: "CO₂",
    subtitle: "No data yet.",
    noData: { hintKind: "value-unavailable" },
    header: { icon: "mdi:molecule-co2", title: "CO₂", subtitle: "No data yet.", hasSubtitle: true, subtitleOverflow: "clip", statusLabel: "No data" },
    average: {
      ...base.average,
      value: null,
      valueText: "--",
      unitText: "",
      entity: "",
      trendDirection: null,
      unavailable: true,
    },
    rooms: { ...base.rooms, visible: [], rowSizes: [], count: 0, comparable: false, showChips: false, chips: [], chipRows: [] },
    views: { keys: [], entries: [], options: {}, collapsed: true, hasRangeScale: false, byKey: {} },
    carousel: { hint: "", noActiveViewsHint: "" },
    ...overrides,
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
  // failure names the mismatch instead of surfacing as an empty carousel slot.
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
  // jsdom has no layout engine, but it does have a working getComputedStyle per realm;
  // what matters here is that neither call needs an ambient window.
  assert.equal(typeof dom.computedStyleOf(first.root).display, "string");
  assert.equal(typeof dom.computedStyleOf(second.root).display, "string");
  assert.equal(dom.measuredWidth(first.root), 0, "jsdom reports zero geometry, which is fine — the value is not asserted");
});

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

// ------------------------------------------------------------------ card shell --

// A synthetic registry: two views that record what they were handed. Proves the shell
// composes whatever it is given, in the order it is given, and never names a view.
function syntheticRegistry(calls) {
  const make = (key) => ({
    key,
    render: (context, model) => {
      calls.push(["render", key, model]);
      return `<div class="synthetic-${key}"></div>`;
    },
    patch: (context, root, model) => calls.push(["patch", key, model]),
    resolveLayout: (context, root, model) => calls.push(["layout", key, model]),
  });
  return [make("alpha"), make("beta")];
}

test("the shell renders the views the model lists, in registry order, through the injected registry", () => {
  const realm = makeRealm();
  const calls = [];
  const model = viewModel({ views: { ...viewModel().views, keys: ["beta", "alpha"] } });
  const html = cardShell.renderCardBody(realm.context, model, syntheticRegistry(calls));
  assert.ok(html.indexOf("synthetic-beta") < html.indexOf("synthetic-alpha"), "the MODEL's key order decides");
  assert.deepEqual(calls.map((call) => [call[0], call[1]]), [["render", "beta"], ["render", "alpha"]]);
  assert.match(html, /rtc-rotator/);
  assert.match(html, /rtc-track/);
});

test("one view renders without the carousel machinery at all", () => {
  const realm = makeRealm();
  const model = viewModel({ views: { ...viewModel().views, keys: ["alpha"] } });
  const html = cardShell.renderCardBody(realm.context, model, syntheticRegistry([]));
  assert.match(html, /rtc-rotator-solo/);
  assert.ok(!html.includes("rtc-track"), "no track means the pointer handlers never treat it as swipeable");
  assert.ok(!html.includes("rtc-no-views"));
});

test("zero views collapse the view area entirely, or show a hint — never both", () => {
  const realm = makeRealm();
  const collapsed = cardShell.renderCardBody(
    realm.context,
    viewModel({ views: { ...viewModel().views, keys: [], collapsed: true } }),
    syntheticRegistry([])
  );
  assert.ok(!collapsed.includes("rtc-rotator"), "asking for nothing draws nothing");
  assert.ok(!collapsed.includes("rtc-no-views"), "and is not reported as a misconfiguration");

  const unavailable = cardShell.renderCardBody(
    realm.context,
    viewModel({ views: { ...viewModel().views, keys: [], collapsed: false } }),
    syntheticRegistry([])
  );
  assert.match(unavailable, /rtc-no-views/);
  assert.match(unavailable, /No views available/);
});

test("the shell renders no data through the normal card frame", () => {
  const realm = makeRealm();
  const html = cardShell.renderCardBody(realm.context, emptyViewModel(), syntheticRegistry([]));
  assert.match(html, /class="rtc-root" data-state="no-data"/);
  assert.match(html, /rtc-header/);
  assert.match(html, /rtc-average/);
  assert.match(html, />--</);
  assert.ok(!html.includes("rtc-no-views"));
});

test("the shell's chip grid follows showChips only", () => {
  const realm = makeRealm();
  const base = viewModel({ views: { ...viewModel().views, keys: ["alpha"] } });
  const shown = cardShell.renderCardBody(realm.context, base, syntheticRegistry([]));
  assert.match(shown, /rtc-room-grid/);
  const hidden = cardShell.renderCardBody(
    realm.context,
    { ...base, rooms: { ...base.rooms, showChips: false } },
    syntheticRegistry([])
  );
  assert.ok(!hidden.includes("rtc-room-grid"));
  assert.match(hidden, /rtc-average/, "everything else is unaffected");
});

test("the shell patches the header, the average, the chips and then every view", () => {
  const realm = makeRealm();
  const calls = [];
  const model = viewModel({ views: { ...viewModel().views, keys: ["alpha"] } });
  realm.root.innerHTML = cardShell.renderCardBody(realm.context, model, syntheticRegistry(calls));

  const changed = viewModel({
    views: { ...model.views, keys: ["alpha"] },
    header: { icon: "mdi:water-percent", title: "Humidity", subtitle: "Dry", hasSubtitle: true, subtitleOverflow: "clip", statusLabel: "Low" },
  });
  calls.length = 0;
  cardShell.patchCardBody(realm.context, realm.root, changed, syntheticRegistry(calls));
  assert.equal(realm.root.querySelector(".rtc-title").textContent, "Humidity");
  assert.equal(realm.root.querySelector(".rtc-subtitle").textContent, "Dry");
  assert.equal(realm.root.querySelector(".rtc-status-pill").textContent, "Low");
  assert.equal(realm.root.querySelector(".rtc-icon-badge ha-icon").getAttribute("icon"), "mdi:water-percent");
  assert.deepEqual(calls.map((call) => [call[0], call[1]]), [["patch", "alpha"], ["patch", "beta"]]);
});

test("the shell resolves the layout of every view that declares one, and skips those that do not", () => {
  const realm = makeRealm();
  const calls = [];
  const views = syntheticRegistry(calls);
  delete views[1].resolveLayout;
  cardShell.resolveViewLayouts(realm.context, realm.root, viewModel(), views);
  assert.deepEqual(calls.map((call) => [call[0], call[1]]), [["layout", "alpha"]]);

  calls.length = 0;
  cardShell.resolveViewLayouts(realm.context, realm.root, emptyViewModel(), views);
  assert.deepEqual(calls, [], "an empty card has no view to measure");
});

// ------------------------------------------------------- structure signature --

test("the structure signature composes the shell's parts with each view's own", () => {
  const model = viewModel();
  const signature = cardShell.cardStructureSignature(model, registry.VIEW_RENDERERS);
  assert.match(signature, /^state:data\|chips:1\|avgLabel:1\|subtitle:1\|views:scale\|collapsed:0\|/);
  assert.match(signature, /scale:/, "the active view contributes its own part");
  assert.ok(!signature.includes("range:"), "an inactive view contributes nothing");
});

test("no-data structures distinguish the headline shape and hint kind", () => {
  const base = emptyViewModel();
  const reference = cardShell.cardStructureSignature(base, registry.VIEW_RENDERERS);
  assert.match(reference, /^state:no-data\|/);
  assert.notEqual(
    cardShell.cardStructureSignature(emptyViewModel({ average: { ...base.average, entity: "sensor.avg" } }), registry.VIEW_RENDERERS),
    reference
  );
  assert.notEqual(
    cardShell.cardStructureSignature(emptyViewModel({ noData: { hintKind: "entity-missing" } }), registry.VIEW_RENDERERS),
    reference
  );
});

test("every optional node of the scale view changes the signature", () => {
  const base = viewModel();
  const signatureOf = (mutate) => {
    const model = viewModel();
    mutate(model.views.byKey.scale);
    return cardShell.cardStructureSignature(model, registry.VIEW_RENDERERS);
  };
  const reference = cardShell.cardStructureSignature(base, registry.VIEW_RENDERERS);

  assert.notEqual(signatureOf((c) => { c.showComfortBand = false; }), reference, "the comfort band");
  assert.notEqual(signatureOf((c) => { c.comfortLabel = null; }), reference, "the comfort label");
  assert.notEqual(signatureOf((c) => { c.showOptimalBand = false; }), reference, "the optimal band");
  assert.notEqual(signatureOf((c) => { c.optimalLabel = null; }), reference, "the optimal label");
  assert.notEqual(signatureOf((c) => { c.footerText = null; }), reference, "the footer");
  assert.notEqual(
    signatureOf((c) => { c.markers.extremes = { cold: marker(), warm: marker() }; }),
    reference,
    "the extrema marker pair"
  );
});

test("a part the view reconciles itself must NOT change the signature", () => {
  // Room markers and marker values are patched in place. Listing them would cost a
  // full rebuild — and a reset carousel — on every routine data change.
  const reference = cardShell.cardStructureSignature(viewModel(), registry.VIEW_RENDERERS);

  const withRoomMarkers = viewModel();
  withRoomMarkers.views.byKey.scale.markers.rooms = [{ ...marker(), index: 0 }, { ...marker(), index: 1 }];
  assert.equal(cardShell.cardStructureSignature(withRoomMarkers, registry.VIEW_RENDERERS), reference);

  const moved = viewModel();
  moved.views.byKey.scale.markers.average = marker({ position: 90, title: "elsewhere" });
  moved.views.byKey.scale.footerText = "a different sentence";
  assert.equal(cardShell.cardStructureSignature(moved, registry.VIEW_RENDERERS), reference);
});

test("the chip grid, the view list and the collapsed state each move the signature", () => {
  const reference = cardShell.cardStructureSignature(viewModel(), registry.VIEW_RENDERERS);
  const base = viewModel();

  const hiddenChips = { ...base, rooms: { ...base.rooms, showChips: false } };
  assert.notEqual(cardShell.cardStructureSignature(hiddenChips, registry.VIEW_RENDERERS), reference);

  const noViews = { ...base, views: { ...base.views, keys: [], collapsed: true } };
  const hintViews = { ...base, views: { ...base.views, keys: [], collapsed: false } };
  assert.notEqual(cardShell.cardStructureSignature(noViews, registry.VIEW_RENDERERS), reference);
  assert.notEqual(
    cardShell.cardStructureSignature(noViews, registry.VIEW_RENDERERS),
    cardShell.cardStructureSignature(hintViews, registry.VIEW_RENDERERS),
    "collapsed and requested-but-unavailable are different structures"
  );
});

test("a view that reconciles everything declares no signature, and is skipped", () => {
  const reconcilingViews = ["range", "extremes"];
  for (const key of reconcilingViews) {
    const view = registry.VIEW_RENDERERS.find((candidate) => candidate.key === key);
    assert.equal(typeof view.structureSignature, "undefined", key + " reconciles its own markup");
  }
  const model = viewModel();
  model.views.byKey.range = { key: "range", cards: [] };
  assert.ok(!cardShell.cardStructureSignature(model, registry.VIEW_RENDERERS).includes("range:"));
});

// ---------------------------------------------- realm independence and safety --

test("the whole render path works with no global document at all", () => {
  // The strongest form of the contract: temporarily remove the ambient document, then
  // render and patch a card end to end through a context built from a foreign realm.
  const realm = makeRealm();
  const hadGlobal = "document" in globalThis;
  const previous = globalThis.document;
  if (hadGlobal) delete globalThis.document;
  try {
    const model = viewModel();
    realm.root.innerHTML = cardShell.renderCardBody(realm.context, model, registry.VIEW_RENDERERS);
    assert.match(realm.root.innerHTML, /rtc-scale-view/);
    cardShell.patchCardBody(realm.context, realm.root, model, registry.VIEW_RENDERERS);
    cardShell.resolveViewLayouts(realm.context, realm.root, model, registry.VIEW_RENDERERS);
    assert.equal(realm.root.querySelectorAll(".rtc-room-chip").length, 2);
  } finally {
    if (hadGlobal) globalThis.document = previous;
  }
});

test("two independent realms render into their own documents without interfering", () => {
  const first = makeRealm();
  const second = makeRealm();
  const model = viewModel();
  first.root.innerHTML = cardShell.renderCardBody(first.context, model, registry.VIEW_RENDERERS);
  second.root.innerHTML = cardShell.renderCardBody(second.context, model, registry.VIEW_RENDERERS);

  cardShell.patchCardBody(first.context, first.root, model, registry.VIEW_RENDERERS);
  for (const chipEl of first.root.querySelectorAll(".rtc-room-chip")) {
    assert.equal(chipEl.ownerDocument, first.ownerDocument);
  }
  for (const chipEl of second.root.querySelectorAll(".rtc-room-chip")) {
    assert.equal(chipEl.ownerDocument, second.ownerDocument);
  }
});

test("every string a renderer interpolates into markup is escaped", () => {
  const realm = makeRealm();
  const payload = '"><img src=x onerror=alert(1)>';
  const model = viewModel({
    title: payload,
    subtitle: payload,
    header: { icon: payload, title: payload, subtitle: payload, hasSubtitle: true, subtitleOverflow: "clip", statusLabel: payload },
    average: { ...viewModel().average, entity: payload, label: payload, tooltip: payload, ariaLabel: payload, unitText: payload },
    carousel: { hint: payload, noActiveViewsHint: payload },
    rooms: {
      ...viewModel().rooms,
      chips: [chip(0, payload, { title: payload, ariaLabel: payload, entity: payload, unitText: payload })],
      chipRows: [{ columnCount: 1, chips: [chip(0, payload, { title: payload, ariaLabel: payload, entity: payload, unitText: payload })] }],
    },
  });
  const html = cardShell.renderCardBody(realm.context, model, registry.VIEW_RENDERERS);
  // The angle brackets are what makes an injection an injection. The payload's TEXT is
  // expected to survive verbatim — escaped — which is exactly the point.
  assert.ok(!html.includes("<img"), "no injected tag may survive");
  assert.match(html, /&lt;img/, "it survives as text instead");

  realm.root.innerHTML = html;
  assert.equal(realm.root.querySelectorAll("img").length, 0, "and the parsed DOM contains no injected element");
  for (const element of realm.root.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.ok(!attribute.name.startsWith("on"), `no event-handler attribute may be created (${element.tagName}[${attribute.name}])`);
    }
  }
  assert.equal(realm.root.querySelector(".rtc-title").textContent, payload, "while the text itself is preserved verbatim");
});

// ---------------------------------------------------------------------- styles --

test("the stylesheet is assembled from its sections with nothing inserted between them", () => {
  const inputs = { keyframes: "@keyframes x {}", trackAnimationCss: "animation: none;", viewCount: 3, viewWidthPct: 33.3333 };
  const css = styles.buildStyles(inputs);
  assert.match(css, /@keyframes x \{\}/);
  assert.match(css, /width: 300%;/, "the track spans viewCount * 100%");
  assert.match(css, /flex: 0 0 33\.3333%;/);
  assert.match(css, /animation: none;/);
  // The section order is normative: a token block before the card, motion overrides
  // last, or the cascade changes.
  assert.ok(css.indexOf(":host {") < css.indexOf(".rtc-card {"));
  assert.ok(css.indexOf(".rtc-card {") < css.indexOf("@container rtc-card"));
  assert.ok(css.indexOf("@container rtc-card") < css.indexOf("prefers-reduced-motion"));
});

test("the stylesheet is a pure function of its four inputs", () => {
  const inputs = { keyframes: "", trackAnimationCss: "", viewCount: 1, viewWidthPct: 100 };
  assert.equal(styles.buildStyles(inputs), styles.buildStyles({ ...inputs }));
  assert.notEqual(styles.buildStyles(inputs), styles.buildStyles({ ...inputs, viewCount: 2 }));
});

test("a zero view count still yields a usable track width", () => {
  // Before the first render this._views is empty; the track must not collapse to 0%.
  assert.match(styles.buildStyles({ keyframes: "", trackAnimationCss: "", viewCount: 0, viewWidthPct: 100 }), /width: 100%;/);
});
