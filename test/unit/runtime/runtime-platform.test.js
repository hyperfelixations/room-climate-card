"use strict";

// Direct tests for resize ownership and the browser-platform boundary: browser-capability
// degradation, realm-bound handles, ResizeObserver and fonts-ready lifecycle. Carousel
// integration appears only where it proves the platform clock is used. Nothing waits — a
// millisecond is set and an exact answer asserted; the real browser test is the integration
// proof. See interne Doku §4 „Platform-Adapter-Vertrag" and §5 „Resize- und Fonts-Ready-System".

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { createFakePlatform } = require("../../helpers/fake-platform.js");

let runtime;
let resizeRuntime;
let browserPlatform;

test.before(async () => {
  runtime = await import("../../../src/controllers/runtime/carousel-runtime.js");
  resizeRuntime = await import("../../../src/controllers/runtime/resize-runtime.js");
  browserPlatform = await import("../../../src/controllers/runtime/browser-platform.js");
});

// ---------------------------------------------------------------- fixtures --

function makeTrack(jsdomWindow) {
  const document = jsdomWindow.document;
  document.body.innerHTML = `
    <div class="rtc-track">
      <div class="rtc-view"></div>
      <div class="rtc-view"></div>
      <div class="rtc-view"></div>
    </div>`;
  return document.querySelector(".rtc-track");
}

// A controller wired to a fake platform and a real (jsdom) track. `viewCount` decides how
// many .rtc-view nodes exist; the timing values are what a card resolves from its config.
function makeController({
  viewCount = 3,
  rotationSeconds = 12,
  slideSeconds = 1,
  autoSlide = true,
  platform = createFakePlatform(),
  interacting = false,
} = {}) {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const track = makeTrack(jsdom.window);
  const views = [...jsdom.window.document.querySelectorAll(".rtc-view")].slice(0, Math.max(viewCount, 0));
  // Keep exactly viewCount view nodes so the accessibility pass has something to walk.
  [...jsdom.window.document.querySelectorAll(".rtc-view")].slice(viewCount).forEach((node) => node.remove());

  const controller = runtime.createCarouselController({
    platform,
    getTrack: () => track,
    getViewElements: () => jsdom.window.document.querySelectorAll(".rtc-view"),
    getTimingConfig: () => ({ rotationSeconds, slideSeconds, autoSlide }),
    isInteracting: () => interacting,
  });
  controller.setViews(Array.from({ length: viewCount }, (_, index) => `view${index}`));
  return { controller, platform, track, views, jsdom };
}

// ------------------------------------------------------------ resize runtime --

test("many resize callbacks coalesce onto exactly one animation frame", () => {
  const platform = createFakePlatform();
  let measures = 0;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });
  const jsdom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
  resize.connect(jsdom.window.document.getElementById("host"));
  assert.equal(resize.isObserving(), true);

  for (let i = 0; i < 20; i++) platform.triggerResize();
  assert.equal(platform.pendingFrameCount(), 1, "twenty callbacks, one frame");
  assert.equal(measures, 0, "nothing is measured before the frame runs");

  platform.flushFrames();
  assert.equal(measures, 1);

  platform.triggerResize();
  platform.flushFrames();
  assert.equal(measures, 2, "and the next burst schedules again");
});

test("disconnect cancels a pending frame and stops observing, and reconnect works", () => {
  const platform = createFakePlatform();
  let measures = 0;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });
  const jsdom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
  const host = jsdom.window.document.getElementById("host");

  resize.connect(host);
  platform.triggerResize();
  assert.equal(resize.hasPendingFrame(), true);

  resize.disconnect();
  assert.equal(resize.hasPendingFrame(), false, "the frame is cancelled, not left to fire into a dead card");
  assert.equal(resize.isObserving(), false);
  platform.flushFrames();
  assert.equal(measures, 0);

  resize.connect(host);
  assert.equal(resize.isObserving(), true);
  platform.triggerResize();
  platform.flushFrames();
  assert.equal(measures, 1, "a reconnected card measures again");
});

test("connect is idempotent and a platform without ResizeObserver simply stays unobserved", () => {
  const platform = createFakePlatform();
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => {} });
  const jsdom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
  const host = jsdom.window.document.getElementById("host");
  resize.connect(host);
  resize.connect(host);
  assert.equal(platform.observers.length, 1, "no second observer");

  const without = resizeRuntime.createResizeRuntime({
    platform: createFakePlatform({ noResizeObserver: true }),
    onMeasure: () => {},
  });
  without.connect(host);
  assert.equal(without.isObserving(), false, "unsupported is not the same as broken");
  without.disconnect();
});

test("the fonts subscription happens once per instance and honours a disconnected card", async () => {
  let resolveFonts;
  const fontsReady = new Promise((resolve) => {
    resolveFonts = resolve;
  });
  const platform = createFakePlatform({ fontsReady });
  let measures = 0;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });

  resize.measureOnceFontsReady(() => true);
  resize.measureOnceFontsReady(() => true);
  resize.measureOnceFontsReady(() => true);
  resolveFonts();
  await fontsReady;
  await Promise.resolve();
  assert.equal(measures, 1, "three renders before the fonts land still measure once");
});

test("a platform without the Fonts API is simply skipped, and one with it still measures", async () => {
  // Both halves: the negative case alone also passes if measureOnceFontsReady() does nothing
  // at all, so the positive case is what makes "skipped" mean skipped rather than dead.
  let measuredWithout = 0;
  const without = resizeRuntime.createResizeRuntime({
    platform: createFakePlatform({ fontsReady: null }),
    onMeasure: () => (measuredWithout += 1),
  });
  without.measureOnceFontsReady(() => true);
  await Promise.resolve();
  assert.equal(measuredWithout, 0, "with no Fonts API there is nothing to wait for, so nothing measures");

  let measuredWith = 0;
  const fontsReady = Promise.resolve();
  const withApi = resizeRuntime.createResizeRuntime({
    platform: createFakePlatform({ fontsReady }),
    onMeasure: () => (measuredWith += 1),
  });
  withApi.measureOnceFontsReady(() => true);
  await fontsReady;
  await Promise.resolve();
  assert.equal(measuredWith, 1, "the same call on a platform that HAS the API does measure");
});

// ---------------------------------------------------------- browser adapter --

test("the browser adapter resolves its realm on every call, never at construction", () => {
  const first = new JSDOM("<!doctype html><html><body></body></html>");
  const second = new JSDOM("<!doctype html><html><body></body></html>");
  let current = first.window.document;
  const platform = browserPlatform.createBrowserPlatform(() => current);

  const handleInFirst = platform.setTimeout(() => {}, 1000);
  assert.notEqual(handleInFirst, null);
  platform.clearTimeout(handleInFirst);

  // The card is adopted into another document; an adapter that captured the first realm
  // would keep scheduling there.
  current = second.window.document;
  const event = platform.createEvent("hass-action", { bubbles: true, composed: true });
  assert.ok(event instanceof second.window.Event, "the event belongs to the CURRENT realm");
  assert.ok(!(event instanceof first.window.Event), "and not to the one the adapter was built with");
});

test("the browser adapter degrades rather than throwing when a capability is missing", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const platform = browserPlatform.createBrowserPlatform(() => jsdom.window.document);
  // A bare jsdom has no ResizeObserver, matchMedia or Fonts API and reports itself hidden;
  // the adapter reports each faithfully rather than throwing or inventing a value.
  assert.equal(platform.createResizeObserver(() => {}), null);
  assert.equal(platform.prefersReducedMotion(), false, "no matchMedia means no stated preference");
  assert.equal(platform.fontsReady(), null);
  assert.equal(platform.isDocumentHidden(), jsdom.window.document.hidden, "visibility is reported, not assumed");
  assert.equal(platform.readTranslateXPx(null), null);
  // No WAAPI, no element, and an element running nothing: three ways of "cannot be read".
  assert.equal(platform.readAnimationPhase(null, "rtc-track-slide"), null);
  assert.equal(platform.readAnimationPhase({}, "rtc-track-slide"), null);
  assert.equal(platform.readAnimationPhase({ getAnimations: () => [] }, "rtc-track-slide"), null);
  assert.equal(typeof platform.now(), "number");
});

test("the browser adapter reads the named animation's own phase and ignores every other one", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const platform = browserPlatform.createBrowserPlatform(() => jsdom.window.document);
  const element = {
    getAnimations: () => [
      { animationName: "something-else", effect: { getComputedTiming: () => ({ progress: 0.9, duration: 100 }) } },
      { animationName: "rtc-track-slide", effect: { getComputedTiming: () => ({ progress: 0.25, duration: 4600 }) } },
    ],
  };
  assert.deepEqual(platform.readAnimationPhase(element, "rtc-track-slide"), { phaseMs: 1150, cycleMs: 4600 });

  // A finished or not-yet-started animation reports a null progress: no phase to read.
  const idle = {
    getAnimations: () => [
      { animationName: "rtc-track-slide", effect: { getComputedTiming: () => ({ progress: null, duration: 4600 }) } },
    ],
  };
  assert.equal(platform.readAnimationPhase(idle, "rtc-track-slide"), null);

  // "auto"/0 durations cannot carry a phase either, and must not divide anything.
  const durationless = {
    getAnimations: () => [
      { animationName: "rtc-track-slide", effect: { getComputedTiming: () => ({ progress: 0.5, duration: "auto" }) } },
    ],
  };
  assert.equal(platform.readAnimationPhase(durationless, "rtc-track-slide"), null);

  const throwing = {
    getAnimations: () => {
      throw new Error("no");
    },
  };
  assert.equal(platform.readAnimationPhase(throwing, "rtc-track-slide"), null, "a throwing realm degrades");
});

// An animation clock is frozen for the whole of one task and only advances between rendered
// frames — inside requestAnimationFrame it is current, from a timer callback it is as old as
// the last paint. These fixtures build a standing timeline against a performance clock that
// has moved on.
function animatedElement({ progress, duration, playState = "running", animationTimeMs, documentTimeMs, nowMs }) {
  const animation = {
    animationName: "rtc-track-slide",
    playState,
    timeline: animationTimeMs === undefined ? undefined : { currentTime: animationTimeMs },
    effect: { getComputedTiming: () => ({ progress, duration }) },
  };
  return {
    getAnimations: () => [animation],
    ownerDocument: {
      timeline: documentTimeMs === undefined ? undefined : { currentTime: documentTimeMs },
      defaultView: { performance: { now: () => nowMs } },
    },
  };
}

test("the browser adapter reports the animation phase now, not the phase of the last painted frame", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const platform = browserPlatform.createBrowserPlatform(() => jsdom.window.document);
  const read = (overrides) =>
    platform.readAnimationPhase(
      animatedElement({ progress: 0.25, duration: 4600, animationTimeMs: 8000, nowMs: 8040, ...overrides }),
      "rtc-track-slide"
    );

  // 0.25 * 4600 = 1150ms was true at the last frame, and that frame is 40ms old.
  assert.deepEqual(read(), { phaseMs: 1190, cycleMs: 4600 }, "the frame's age belongs on the phase");

  // The same reading taken inside a frame, where the two clocks agree: nothing to add.
  assert.deepEqual(read({ nowMs: 8000 }), { phaseMs: 1150, cycleMs: 4600 });

  // A paused animation's clock stands still; adding wall-clock time would invent a position.
  assert.deepEqual(read({ playState: "paused" }), { phaseMs: 1150, cycleMs: 4600 });
  assert.deepEqual(read({ playState: "finished" }), { phaseMs: 1150, cycleMs: 4600 });

  // The document's timeline is the fallback when the animation does not name its own.
  assert.deepEqual(read({ animationTimeMs: undefined, documentTimeMs: 8000 }), { phaseMs: 1190, cycleMs: 4600 });
  // With neither, the frame phase is the honest answer rather than a guess.
  assert.deepEqual(read({ animationTimeMs: undefined }), { phaseMs: 1150, cycleMs: 4600 });

  // A frame that claims to be in the future has no measurable age.
  assert.deepEqual(read({ nowMs: 7900 }), { phaseMs: 1150, cycleMs: 4600 });

  // Extrapolation stays inside the cycle: 500ms in, 600ms later, is 100ms into the next.
  assert.deepEqual(
    platform.readAnimationPhase(
      animatedElement({ progress: 0.5, duration: 1000, animationTimeMs: 1000, nowMs: 1600 }),
      "rtc-track-slide"
    ),
    { phaseMs: 100, cycleMs: 1000 }
  );
});

test("the accessibility state is re-derived on the frame that actually starts the animation", () => {
  // Declaring `animation` does not create one; the frame that applies it does. Anything the
  // card decides in between has only the wall clock, which the running animation then lags by
  // however long that frame took.
  const platform = createFakePlatform();
  const { controller, track, views } = makeController({ rotationSeconds: 1, slideSeconds: 0.15, platform });
  const cycleMs = controller.timing().cycleMs;
  const inertFlags = () => views.map((view) => view.hasAttribute("inert"));

  // Wall clock at phase 4550: past the flip in the last segment, so it says the accessible
  // view is already view 0.
  platform.setNow(Math.ceil(platform.now() / cycleMs) * cycleMs + 4550);
  controller.applyAutoSlideStyles();
  assert.deepEqual(inertFlags(), [false, true, true], "with no animation to ask, the wall clock is all there is");
  assert.notEqual(controller.animationStartFrameHandle, null, "and a frame must be booked to ask again");

  // One frame later the animation exists and is 60ms behind the wall clock, putting it
  // before that flip and on view 1. Without this second pass the card holds the wrong
  // accessible view until the next flip.
  track.__animationPhase = { phaseMs: 4490, cycleMs };
  platform.flushFrames();
  assert.deepEqual(inertFlags(), [true, false, true], "the animation's own phase wins as soon as there is one");
  assert.equal(controller.animationStartFrameHandle, null, "the frame is a one-shot, not a poll");
});

test("the animation-start frame is cancelled with everything else the controller owns", () => {
  const { controller, platform } = makeController();
  controller.applyAutoSlideStyles();
  assert.equal(platform.pendingFrameCount(), 1);
  controller.destroy();
  assert.equal(platform.pendingFrameCount(), 0, "a card torn down before its first frame leaves no callback behind");
  assert.equal(controller.animationStartFrameHandle, null);
});

test("a flip that is already due is not deferred by the re-arm floor", () => {
  // holdMs 1000, slideMs 150: a segment is 1150ms and the accessible view flips 1053.06ms
  // into it. Park the clock ~1ms before that boundary, as a timer firing a hair early does.
  const platform = createFakePlatform();
  const { controller, views } = makeController({ rotationSeconds: 1, slideSeconds: 0.15, platform });
  const cycleMs = controller.timing().cycleMs;
  platform.setNow(Math.ceil(platform.now() / cycleMs) * cycleMs + 1052);

  const inertFlags = () => views.map((view) => view.hasAttribute("inert"));

  controller.applyAutoSlideStyles();
  assert.deepEqual(inertFlags(), [false, true, true], "before the boundary the first view is still the accessible one");

  // The floor rounds the wait up only to the shortest delay a browser will schedule;
  // anything longer holds back a due flip.
  platform.advance(5);
  assert.deepEqual(inertFlags(), [true, false, true], "the flip lands within a schedulable delay, not a twentieth of a second");
});

test("the browser adapter hands back a working unsubscribe for visibility", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const platform = browserPlatform.createBrowserPlatform(() => jsdom.window.document);
  let fired = 0;
  const unsubscribe = platform.onVisibilityChange(() => (fired += 1));
  jsdom.window.document.dispatchEvent(new jsdom.window.Event("visibilitychange"));
  assert.equal(fired, 1);
  unsubscribe();
  jsdom.window.document.dispatchEvent(new jsdom.window.Event("visibilitychange"));
  assert.equal(fired, 1, "the unsubscribe detaches exactly what it attached");
});

test("a detached document leaves the adapter inert instead of throwing", () => {
  const platform = browserPlatform.createBrowserPlatform(() => null);
  assert.equal(platform.setTimeout(() => {}, 10), null);
  assert.equal(platform.requestAnimationFrame(() => {}), null);
  assert.equal(platform.prefersReducedMotion(), false);
  assert.equal(platform.isDocumentHidden(), false);
  assert.equal(platform.fontsReady(), null);
  assert.equal(platform.createResizeObserver(() => {}), null);
  assert.doesNotThrow(() => platform.clearTimeout(null));
  assert.doesNotThrow(() => platform.cancelAnimationFrame(null));
  assert.doesNotThrow(() => platform.onVisibilityChange(() => {})());
});

// -------------------------------------------------- realm-bound lifetimes ----
//
// A new capability comes from the current realm, but an existing handle must be cancelled in
// the realm that created it: a timer id is only meaningful to the window that issued it.

function twoRealms() {
  const first = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>", { pretendToBeVisual: true });
  const second = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>", { pretendToBeVisual: true });
  let current = first.window.document;
  const platform = browserPlatform.createBrowserPlatform(() => current);
  return { first, second, platform, adopt: () => (current = second.window.document) };
}

test("a timeout created before adoption is still cancelled in its own realm afterwards", async () => {
  const { first, second, platform, adopt } = twoRealms();
  let fired = 0;
  const handle = platform.setTimeout(() => (fired += 1), 5);

  // The card is adopted; the adapter now resolves everything against the new document.
  adopt();
  platform.clearTimeout(handle);

  await new Promise((resolve) => first.window.setTimeout(resolve, 30));
  await new Promise((resolve) => second.window.setTimeout(resolve, 30));
  assert.equal(fired, 0, "the old realm's timer must genuinely have been cancelled");
});

test("an animation frame created before adoption is cancelled in its own realm too", async () => {
  const { first, second, platform, adopt } = twoRealms();
  let fired = 0;
  const handle = platform.requestAnimationFrame(() => (fired += 1));
  adopt();
  platform.cancelAnimationFrame(handle);

  await new Promise((resolve) => first.window.setTimeout(resolve, 50));
  await new Promise((resolve) => second.window.setTimeout(resolve, 50));
  assert.equal(fired, 0);
});

test("handles created after adoption belong to the new realm and are untouched by the old one", async () => {
  const { first, second, platform, adopt } = twoRealms();
  const beforeAdoption = platform.setTimeout(() => {}, 1000);
  adopt();
  let fired = 0;
  const afterAdoption = platform.setTimeout(() => (fired += 1), 5);

  // Cancelling the old handle must not disturb the new one, even if both realms handed out
  // the same numeric id.
  platform.clearTimeout(beforeAdoption);
  await new Promise((resolve) => second.window.setTimeout(resolve, 40));
  assert.equal(fired, 1, "the new realm's timer must still have fired");
  platform.clearTimeout(afterAdoption);
  await new Promise((resolve) => first.window.setTimeout(resolve, 10));
});

test("a timeout handle is opaque: nothing outside the adapter may read a number out of it", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const platform = browserPlatform.createBrowserPlatform(() => jsdom.window.document);
  const handle = platform.setTimeout(() => {}, 1000);
  assert.equal(typeof handle, "object", "a bare number would tempt a caller to use it directly");
  assert.equal(typeof handle.cancel, "function");
  platform.clearTimeout(handle);
  assert.doesNotThrow(() => platform.clearTimeout(handle), "cancelling twice is harmless");
  assert.doesNotThrow(() => platform.clearTimeout(null));
  assert.doesNotThrow(() => platform.clearTimeout(undefined));
});

test("the visibility unsubscribe detaches from the document it subscribed to, not the current one", () => {
  const { first, second, platform, adopt } = twoRealms();
  let fired = 0;
  const unsubscribe = platform.onVisibilityChange(() => (fired += 1));
  first.window.document.dispatchEvent(new first.window.Event("visibilitychange"));
  assert.equal(fired, 1);

  adopt();
  unsubscribe();
  first.window.document.dispatchEvent(new first.window.Event("visibilitychange"));
  assert.equal(fired, 1, "the listener in the ORIGINAL document must be gone");
});

test("fonts-ready resubscribes exactly once per source, and a stale source measures nothing", async () => {
  const platform = createFakePlatform();
  let measures = 0;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });

  let resolveOld;
  const oldReady = new Promise((resolve) => (resolveOld = resolve));
  platform.setFontsReady(oldReady);
  resize.measureOnceFontsReady(() => true);
  resize.measureOnceFontsReady(() => true);

  // The card is adopted into a document with its own font-loading state, before the old
  // promise ever settles.
  let resolveNew;
  const newReady = new Promise((resolve) => (resolveNew = resolve));
  platform.setFontsReady(newReady);
  resize.measureOnceFontsReady(() => true);
  resize.measureOnceFontsReady(() => true);

  resolveOld();
  await oldReady;
  await Promise.resolve();
  assert.equal(measures, 0, "the abandoned document's fonts must not measure the adopted card");

  resolveNew();
  await newReady;
  await Promise.resolve();
  assert.equal(measures, 1, "and the new source measures exactly once");
});

test("a disconnected card is not measured when its fonts finally land", async () => {
  const platform = createFakePlatform();
  let measures = 0;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });
  let resolveFonts;
  const ready = new Promise((resolve) => (resolveFonts = resolve));
  platform.setFontsReady(ready);

  let connected = true;
  resize.measureOnceFontsReady(() => connected);
  connected = false;
  resolveFonts();
  await ready;
  await Promise.resolve();
  assert.equal(measures, 0);
});

// ------------------------------------------- fonts-ready across a disconnect ----
//
// The web font finishing loading is a measurement trigger that is neither a data change nor
// a resize, and it fires once per document. If it lands while the card is out of the DOM,
// remembering only "already subscribed" loses the measurement.

function fontsRuntime({ noResizeObserver = false } = {}) {
  const platform = createFakePlatform({ noResizeObserver });
  let measures = 0;
  let connected = true;
  const resize = resizeRuntime.createResizeRuntime({ platform, onMeasure: () => (measures += 1) });
  return {
    platform,
    resize,
    measures: () => measures,
    setConnected: (value) => (connected = value),
    render: () => resize.measureOnceFontsReady(() => connected),
  };
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("three renders before the same fonts promise settle into exactly one measurement", async () => {
  const runtime = fontsRuntime();
  const fonts = deferredPromise();
  runtime.platform.setFontsReady(fonts.promise);
  runtime.render();
  runtime.render();
  runtime.render();
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "pending");

  fonts.resolve();
  await fonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 1);
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "measured");
});

test("a promise that settles while disconnected defers the measurement, and the reconnect collects it", async () => {
  const runtime = fontsRuntime();
  const fonts = deferredPromise();
  runtime.platform.setFontsReady(fonts.promise);
  runtime.render();

  runtime.setConnected(false);
  fonts.resolve();
  await fonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 0, "nothing may be measured on a detached node");
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "deferred", "but the debt is remembered");

  runtime.setConnected(true);
  runtime.render();
  assert.equal(runtime.measures(), 1, "the reconnect collects exactly one deferred measurement");
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "measured");

  // And only one: a second reconnect owes nothing.
  runtime.render();
  runtime.render();
  assert.equal(runtime.measures(), 1);
});

test("a new realm's fonts source supersedes the old one, which then measures nothing", async () => {
  const runtime = fontsRuntime();
  const oldFonts = deferredPromise();
  const newFonts = deferredPromise();

  runtime.platform.setFontsReady(oldFonts.promise);
  runtime.render();
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "pending");

  // The card is adopted before the old document's fonts finish.
  runtime.platform.setFontsReady(newFonts.promise);
  runtime.render();

  oldFonts.resolve();
  await oldFonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 0, "the abandoned document must not measure the adopted card");
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "pending", "the new source is still loading");

  newFonts.resolve();
  await newFonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 1);
});

test("a superseded source that had already deferred does not measure after the swap", async () => {
  const runtime = fontsRuntime();
  const oldFonts = deferredPromise();
  runtime.platform.setFontsReady(oldFonts.promise);
  runtime.render();

  runtime.setConnected(false);
  oldFonts.resolve();
  await oldFonts.promise;
  await Promise.resolve();
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "deferred");

  // Adopted while the debt was outstanding: it belonged to a document the card has left, so
  // it is dropped rather than paid in the new one.
  const newFonts = deferredPromise();
  runtime.platform.setFontsReady(newFonts.promise);
  runtime.setConnected(true);
  runtime.render();
  assert.equal(runtime.measures(), 0);
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "pending");

  newFonts.resolve();
  await newFonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 1, "only the current realm's source measures");
});

test("a rejected fonts promise is recorded and never retried for that source", async () => {
  const runtime = fontsRuntime();
  const fonts = deferredPromise();
  runtime.platform.setFontsReady(fonts.promise);
  runtime.render();

  fonts.reject(new Error("font loading failed"));
  await fonts.promise.catch(() => {});
  await Promise.resolve();
  assert.equal(runtime.measures(), 0);
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "rejected");

  runtime.render();
  runtime.render();
  assert.equal(runtime.measures(), 0, "no endless resubscription to a promise that failed");
  assert.equal(runtime.resize.fontsStateForCurrentSource(), "rejected");
});

test("no Fonts API at all stays a clean no-op", () => {
  const runtime = fontsRuntime();
  runtime.platform.setFontsReady(null);
  runtime.render();
  runtime.render();
  assert.equal(runtime.measures(), 0);
  assert.equal(runtime.resize.fontsStateForCurrentSource(), null);
});

test("the fonts path works even without a ResizeObserver", async () => {
  const runtime = fontsRuntime({ noResizeObserver: true });
  const jsdom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
  runtime.resize.connect(jsdom.window.document.getElementById("host"));
  assert.equal(runtime.resize.isObserving(), false, "unsupported, and that is fine");

  const fonts = deferredPromise();
  runtime.platform.setFontsReady(fonts.promise);
  runtime.render();
  fonts.resolve();
  await fonts.promise;
  await Promise.resolve();
  assert.equal(runtime.measures(), 1, "the two triggers are independent");
});
