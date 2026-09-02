// The controllers' closed browser boundary: clock, timers/rAF, preferences, visibility,
// observers, fonts, realm-correct events, surface and animation/transform reads.
// New capabilities resolve from the card's current document; existing timer/rAF handles
// retain cancellation bound to the realm that created them. Details and full port list:
// internal documentation §4 "Platform-Adapter-Vertrag".

// Transform reading needs both computed style and DOMMatrixReadOnly from the element's realm.
import { compositeOver, cssColorToHex, gradientSamples } from "../../core/color.js";

function readTranslateXPx(element) {
  if (!element) return null;
  const view = element.ownerDocument?.defaultView;
  if (!view) return null;
  try {
    const transform = view.getComputedStyle(element).transform;
    if (!transform || transform === "none") return null;
    return new view.DOMMatrixReadOnly(transform).m41;
  } catch (_error) {
    // The caller has a value-derived fallback; do not guess on missing APIs/bad syntax.
    return null;
  }
}

// Animation timelines advance between rendered frames, so timer callbacks see a frame-old
// phase. Extrapolate by the frame age only while running; paused/finished animations must
// remain still. Missing clocks yield the unextrapolated phase. Details: internal documentation
// §4 "Platform-Adapter-Vertrag".
function msSinceAnimationFrame(element, animation) {
  if (animation?.playState !== "running") return 0;
  const document = element.ownerDocument;
  const frameMs = Number(animation.timeline?.currentTime ?? document?.timeline?.currentTime);
  const nowMs = Number(document?.defaultView?.performance?.now?.());
  if (!Number.isFinite(frameMs) || !Number.isFinite(nowMs)) return 0;
  // Both clocks share a document time origin; a negative age means no measurable age.
  const ageMs = nowMs - frameMs;
  return ageMs > 0 ? ageMs : 0;
}

// Read the named animation's own clock: its start-frame latency creates a persistent offset
// from the wall clock. Return cycleMs with phaseMs so callers can reject a phase belonging to
// stale timing. Details: internal documentation §5 "Carousel, Swipe und Accessibility".
function readAnimationPhase(element, animationName) {
  if (typeof element?.getAnimations !== "function") return null;
  try {
    const animation = element.getAnimations().find((candidate) => candidate.animationName === animationName);
    const timing = animation?.effect?.getComputedTiming?.();
    const cycleMs = Number(timing?.duration);
    const progress = timing?.progress;
    if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
    if (!Number.isFinite(cycleMs) || cycleMs <= 0) return null;
    // `progress` is last-frame phase; extrapolate it to the calling instant.
    return { phaseMs: (progress * cycleMs + msSinceAnimationFrame(element, animation)) % cycleMs, cycleMs };
  } catch (_error) {
    // The caller retains its wall-clock fallback.
    return null;
  }
}

// Read exactly `--primary-text-color`, which the stylesheet uses for track/chip tints.
// Return opaque hex or null; guessing from `style.color` would measure a colour those tints
// do not use. Reading ladders: internal documentation §5 "Die Leseleiter".
function readTextColor(element) {
  try {
    const view = element?.ownerDocument?.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return null;
    const style = view.getComputedStyle(element);
    if (!style) return null;
    const parsed = cssColorToHex(style.getPropertyValue("--primary-text-color"));
    return parsed && parsed.alpha >= 1 ? parsed.hex : null;
  } catch (_error) {
    return null;
  }
}

// Return every opaque surface sample: gradient stops plus interior blends; else opaque
// background; else translucent background composed over the first opaque ancestor; else theme
// card properties; else []. `url(...)` images are unreadable and deliberately fall through.
// All CSSOM reads use the element's realm. Details: internal documentation §5 "Die Leseleiter".
function readBackgroundSamples(element) {
  try {
    const view = element?.ownerDocument?.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return [];
    const style = view.getComputedStyle(element);
    if (!style) return [];

    const gradient = gradientSamples(style.backgroundImage);
    if (gradient.length) return gradient;

    const own = cssColorToHex(style.backgroundColor);
    if (own) {
      if (own.alpha >= 1) return [own.hex];
      const behind = backdropOf(element, view);
      if (behind) return [compositeOver(own.hex, own.alpha, behind)];
      // If the backdrop is unreadable, the translucent colour is still the known paint.
      return [own.hex];
    }

    for (const property of ["--ha-card-background", "--card-background-color"]) {
      const value = style.getPropertyValue(property);
      const parsed = cssColorToHex(value);
      if (parsed) return [parsed.hex];
    }
    return [];
  } catch (_error) {
    // A card without a usable CSSOM still renders through the caller's fallback.
    return [];
  }
}

// First opaque ancestor for compositing; bounded so hostile/deep DOM cannot extend a render.
function backdropOf(element, view) {
  let node = element.parentNode;
  for (let depth = 0; depth < 12 && node; depth += 1) {
    // Cross shadow boundaries the way paint does.
    if (node.host) node = node.host;
    if (typeof node.nodeType === "number" && node.nodeType === 1) {
      const parsed = cssColorToHex(view.getComputedStyle(node)?.backgroundColor);
      if (parsed && parsed.alpha >= 1) return parsed.hex;
    }
    node = node.parentNode || node.host || null;
  }
  return null;
}

export function createBrowserPlatform(getDocument) {
  const documentOf = () => getDocument() || null;
  const viewOf = () => documentOf()?.defaultView || null;

  return {
    now: () => Date.now(),

    setTimeout(fn, ms) {
      const view = viewOf();
      if (!view) return null;
      const id = view.setTimeout(fn, ms);
      // The handle retains cancellation in the issuing realm after document adoption.
      return { cancel: () => view.clearTimeout(id) };
    },
    clearTimeout(handle) {
      handle?.cancel?.();
    },

    requestAnimationFrame(fn) {
      const view = viewOf();
      if (!view) return null;
      const id = view.requestAnimationFrame(fn);
      return { cancel: () => view.cancelAnimationFrame(id) };
    },
    cancelAnimationFrame(handle) {
      handle?.cancel?.();
    },

    // Match CSS; a realm without matchMedia safely degrades to no preference.
    prefersReducedMotion: () => Boolean(viewOf()?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),

    isDocumentHidden: () => Boolean(documentOf()?.hidden),

    onVisibilityChange: (listener) => {
      const target = documentOf();
      if (!target) return () => {};
      target.addEventListener("visibilitychange", listener);
      // The unsubscribe retains the subscribed document and matching arguments.
      return () => target.removeEventListener("visibilitychange", listener);
    },

    // Realm-bound unsubscribe; absent matchMedia is simply an inert source.
    onColorSchemeChange: (listener) => {
      const query = viewOf()?.matchMedia?.("(prefers-color-scheme: dark)");
      if (!query || typeof query.addEventListener !== "function") return () => {};
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },

    // null makes capability degradation an explicit caller decision; construct in-card realm.
    createMutationObserver: (callback) => {
      const view = viewOf();
      if (!view || typeof view.MutationObserver !== "function") return null;
      return new view.MutationObserver(callback);
    },

    // null makes capability degradation an explicit caller decision.
    createResizeObserver: (callback) => {
      const view = viewOf();
      if (!view || typeof view.ResizeObserver !== "function") return null;
      return new view.ResizeObserver(callback);
    },

    fontsReady: () => documentOf()?.fonts?.ready ?? null,

    createEvent: (type, init) => {
      const view = viewOf();
      // Foreign-realm Events can fail listener-side instanceof checks.
      const EventConstructor = view?.Event ?? Event;
      return new EventConstructor(type, init);
    },

    readTranslateXPx,
    readAnimationPhase,
    readBackgroundSamples,
    readTextColor,
  };
}
