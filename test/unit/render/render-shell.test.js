"use strict";

// Direct unit tests for card-shell composition, structure signatures and assembled styles.
//
// Markup and DOM patching are pure functions of a view model, and these tests take that
// literally: no custom element anywhere in this file, no hass object, no configuration, and —
// for most of it — no global document either. A view model is written by hand, a renderer is
// called, and the resulting string or DOM is asserted.
//
// This file owns the SHELL: the markup around the views, which node changes force a rebuild
// rather than a patch, what escaping the shell applies, and the stylesheet the card emits. It
// also holds the realm check, because the shell is what builds the shadow root and is
// therefore where a renderer reaching for the ambient document would show first.
//
// The boundary to render-views.test.js next door: everything INSIDE one view — its markup,
// its patch path, its geometry — is that file's subject. The registry appears in both, from
// opposite sides: here as the thing the shell mounts, there as the thing that mounts.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { marker, chip, viewModel, emptyViewModel } = require("../../fixtures/render-models.js");

let renderContext;
let cardShell;
let registry;
let styles;

test.before(async () => {
  renderContext = await import("../../../src/render/primitives/render-context.js");
  cardShell = await import("../../../src/render/composition/card-shell.js");
  registry = await import("../../../src/views/registry.js");
  styles = await import("../../../src/styles/index.js");
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
  assert.match(
    signature,
    /^state:data\|chips:1\|avgLabel:1\|subtitle:1\|accentLine:1\|icon:1\|title:1\|pill:1\|panel:1\|views:scale\|collapsed:0\|/
  );
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
    header: { ...viewModel().header, icon: payload, title: payload, subtitle: payload, statusLabel: payload },
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
