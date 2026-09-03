"use strict";

// A platform implementation whose clock, timers and animation frames a test drives by
// hand, making wall-clock carousel questions deterministic and exact. It lives in the test
// suite because the shipped bundle must contain exactly one implementation of the contract
// (see internal dev doc §4 "Platform-Adapter-Vertrag").

function createFakePlatform(options = {}) {
  let now = options.now ?? 1750000000000;
  // Opaque handles, exactly like the browser adapter: the map is keyed by the token
  // object itself, so no numeric detail leaks into anything a caller could rely on.
  const timers = new Map();
  const frames = new Map();
  const visibilityListeners = new Set();
  const colorSchemeListeners = new Set();
  const mutationObservers = [];
  let hidden = Boolean(options.hidden);
  let reducedMotion = Boolean(options.reducedMotion);
  let currentFontsReady = options.fontsReady ?? null;
  const observers = [];
  const calls = { setTimeout: 0, clearTimeout: 0, requestAnimationFrame: 0, cancelAnimationFrame: 0 };

  const platform = {
    now: () => now,

    setTimeout(fn, ms) {
      calls.setTimeout += 1;
      const handle = { cancel: () => timers.delete(handle) };
      timers.set(handle, { fn, dueAt: now + Math.max(0, Number(ms) || 0) });
      return handle;
    },
    clearTimeout(handle) {
      calls.clearTimeout += 1;
      handle?.cancel?.();
    },

    requestAnimationFrame(fn) {
      calls.requestAnimationFrame += 1;
      const handle = { cancel: () => frames.delete(handle) };
      frames.set(handle, fn);
      return handle;
    },
    cancelAnimationFrame(handle) {
      calls.cancelAnimationFrame += 1;
      handle?.cancel?.();
    },

    prefersReducedMotion: () => reducedMotion,
    isDocumentHidden: () => hidden,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },

    onColorSchemeChange(listener) {
      // Null-shaped the way the adapter is: a realm without matchMedia hands back an
      // unsubscribe that does nothing, so a caller never has to ask which it got.
      if (options.noColorScheme) return () => {};
      colorSchemeListeners.add(listener);
      return () => colorSchemeListeners.delete(listener);
    },

    // Records what was observed with its options: "watches the root element" and "watches
    // its attributes without the subtree" are different claims.
    createMutationObserver(callback) {
      if (options.noMutationObserver) return null;
      const observer = {
        callback,
        observed: [],
        disconnected: false,
        observe(target, observeOptions) {
          observer.observed.push({ target, options: observeOptions });
        },
        disconnect() {
          observer.disconnected = true;
        },
        takeRecords: () => [],
      };
      mutationObservers.push(observer);
      return observer;
    },

    createResizeObserver(callback) {
      if (options.noResizeObserver) return null;
      const observer = {
        callback,
        observed: [],
        disconnected: false,
        observe(element) {
          observer.observed.push(element);
        },
        unobserve(element) {
          observer.observed = observer.observed.filter((candidate) => candidate !== element);
        },
        disconnect() {
          observer.disconnected = true;
          observer.observed = [];
        },
      };
      observers.push(observer);
      return observer;
    },

    fontsReady: () => currentFontsReady,

    createEvent: (type, init) => ({ type, ...init, __fake: true }),

    readTranslateXPx: (element) => options.translateXPx ?? element?.__translateXPx ?? null,

    // Null by default (a realm without the Web Animations API), keeping tests on the
    // wall-clock fallback. Set `animationPhase` / `element.__animationPhase` to
    // {phaseMs, cycleMs} to reproduce the real browser's clock offset.
    readAnimationPhase: (element, _animationName) => options.animationPhase ?? element?.__animationPhase ?? null,
  };

  // ---- the controls a test drives -------------------------------------------
  return Object.assign(platform, {
    // Moves the clock forward and fires every timer that came due, in due order, so a
    // timer that re-arms itself is picked up within the same advance.
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((a, b) => a[1].dueAt - b[1].dueAt);
        if (due.length === 0) break;
        if (++guard > 10000) throw new Error("fake platform: timer storm, a timer is re-arming with no delay");
        const [handle, timer] = due[0];
        timers.delete(handle);
        now = Math.max(now, timer.dueAt);
        timer.fn();
      }
      now = target;
    },
    setNow(value) {
      now = value;
    },
    // Simulates the card being adopted into a document with its own font loading state.
    setFontsReady(promise) {
      currentFontsReady = promise ?? null;
    },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
    },
    setHidden(value) {
      hidden = Boolean(value);
    },
    emitVisibilityChange() {
      for (const listener of [...visibilityListeners]) listener();
    },
    emitColorSchemeChange() {
      for (const listener of [...colorSchemeListeners]) listener();
    },
    // Runs every pending animation frame callback exactly once.
    flushFrames() {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, fn] of pending) fn();
    },
    triggerResize() {
      for (const observer of observers) observer.callback([], observer);
    },

    // ---- inspection ----------------------------------------------------------
    pendingTimerCount: () => timers.size,
    // How long the soonest pending timer still has to wait — for a test that checks when a
    // chain re-armed, not just that it did.
    nextTimerDelay() {
      let soonest = null;
      for (const timer of timers.values()) {
        if (soonest === null || timer.dueAt < soonest) soonest = timer.dueAt;
      }
      return soonest === null ? null : soonest - now;
    },
    pendingFrameCount: () => frames.size,
    visibilityListenerCount: () => visibilityListeners.size,
    colorSchemeListenerCount: () => colorSchemeListeners.size,
    mutationObservers,
    observers,
    calls,
  });
}

module.exports = { createFakePlatform };
