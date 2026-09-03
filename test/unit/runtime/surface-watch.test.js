"use strict";

// The occasion that makes the card re-read its background. The card already re-reads it on
// every render and carries it in the data signature, but only a hass push, setConfig, resize
// or fonts promise calls the render path — a theme switch is none of those. This watch
// supplies the occasion and nothing else: it says "ask again", and the data signature
// answers with a string comparison.
// No timer, ever: the three sources are events; the tests assert the absence of timers
// directly. See interne Doku §5 „Wann die Karte erneut fragt".

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { createFakePlatform } = require("../../helpers/fake-platform.js");

let surfaceWatch;

test.before(async () => {
  surfaceWatch = await import("../../../src/controllers/runtime/surface-watch.js");
});

function setup(platformOptions = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='card'></div></body></html>");
  const platform = createFakePlatform(platformOptions);
  let calls = 0;
  const watch = surfaceWatch.createSurfaceWatch({ platform, onChange: () => (calls += 1) });
  return { dom, platform, watch, element: dom.window.document.getElementById("card"), changes: () => calls };
}

test("it subscribes to the colour scheme and to the attributes that carry a theme", () => {
  const { platform, watch, element, dom } = setup();
  watch.observe(element);

  assert.equal(platform.colorSchemeListenerCount(), 1, "the browser's own light/dark switch");
  const [observer] = platform.mutationObservers;
  assert.ok(observer, "one observer, not one per target — the same callback answers for both");

  const targets = observer.observed.map((entry) => entry.target);
  assert.ok(targets.includes(dom.window.document.documentElement), "Home Assistant writes its theme onto the root element");
  assert.ok(targets.includes(element), "a card-mod rule can colour this one card and nothing else");

  // The root is watched for any attribute (theme goes into `style`, `data-theme`, or a
  // class); its attributes change rarely enough that filtering would buy nothing. The card
  // is filtered, because a card element's attributes change during ordinary rendering.
  const rootEntry = observer.observed.find((entry) => entry.target === dom.window.document.documentElement);
  assert.equal(rootEntry.options.attributes, true);
  assert.equal(rootEntry.options.attributeFilter, undefined, "no filter on the root");
  assert.equal(rootEntry.options.subtree, undefined, "and never a subtree — that would be a firehose");

  const cardEntry = observer.observed.find((entry) => entry.target === element);
  assert.deepEqual(cardEntry.options.attributeFilter, ["style", "class"]);

  watch.disconnect();
});

test("nothing is asked until a frame runs, and a burst of mutations costs exactly one", () => {
  const { platform, watch, element, changes } = setup();
  watch.observe(element);

  const [observer] = platform.mutationObservers;
  observer.callback([], observer);
  observer.callback([], observer);
  platform.emitColorSchemeChange();
  assert.equal(changes(), 0, "the work is deferred, so a mutation storm cannot become a render storm");
  assert.equal(platform.pendingFrameCount(), 1, "one frame for the whole burst");

  platform.flushFrames();
  assert.equal(changes(), 1);

  // And the next burst gets its own frame — the coalescing window closes when it runs.
  observer.callback([], observer);
  platform.flushFrames();
  assert.equal(changes(), 2);

  watch.disconnect();
});

test("it never arms a timer", () => {
  const { platform, watch, element } = setup();
  watch.observe(element);
  const [observer] = platform.mutationObservers;
  observer.callback([], observer);
  platform.emitColorSchemeChange();
  platform.flushFrames();

  assert.equal(platform.calls.setTimeout, 0, "a poll would be a timer, and there is none");
  assert.equal(platform.pendingTimerCount(), 0);
  watch.disconnect();
});

test("disconnecting detaches everything, including a frame that had not run yet", () => {
  const { platform, watch, element, changes } = setup();
  watch.observe(element);
  const [observer] = platform.mutationObservers;

  observer.callback([], observer);
  assert.equal(platform.pendingFrameCount(), 1);

  watch.disconnect();
  assert.equal(platform.colorSchemeListenerCount(), 0);
  assert.equal(observer.disconnected, true);
  assert.equal(platform.pendingFrameCount(), 0, "a pending frame would fire into a card that is gone");

  platform.flushFrames();
  assert.equal(changes(), 0);
});

test("observing twice replaces the first subscription rather than doubling it", () => {
  // connectedCallback can run more than once for one element (Home Assistant moves cards
  // between dashboards); two live subscriptions would mean two renders per switch.
  const { platform, watch, element, dom } = setup();
  watch.observe(element);
  const second = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(second);
  watch.observe(second);

  assert.equal(platform.colorSchemeListenerCount(), 1);
  assert.equal(platform.mutationObservers[0].disconnected, true, "the first observer let go");
  assert.equal(platform.mutationObservers[1].disconnected, false);
  watch.disconnect();
});

test("a realm without matchMedia or MutationObserver still works, minus what it cannot do", () => {
  // The card must render in a jsdom-like realm; the ordinary render path still catches a
  // background change on the next hass push. What must not happen is a throw in connectedCallback.
  const { platform, watch, element, changes } = setup({ noColorScheme: true, noMutationObserver: true });
  assert.doesNotThrow(() => watch.observe(element));
  assert.equal(platform.mutationObservers.length, 0);
  assert.equal(changes(), 0);
  assert.doesNotThrow(() => watch.disconnect());
});

test("an element with no document is not a subscription", () => {
  // The card can be constructed and never connected; asking a null document for its root
  // element must not crash.
  const { platform, watch } = setup();
  assert.doesNotThrow(() => watch.observe(null));
  assert.equal(platform.colorSchemeListenerCount(), 0);
  assert.equal(platform.mutationObservers.length, 0);
  watch.disconnect();
});

test("it is inert before observe() and after disconnect()", () => {
  const { platform, watch, element, changes } = setup();
  platform.emitColorSchemeChange();
  assert.equal(platform.pendingFrameCount(), 0, "nothing is attached yet");

  watch.observe(element);
  watch.disconnect();
  platform.emitColorSchemeChange();
  platform.flushFrames();
  assert.equal(changes(), 0);
});
