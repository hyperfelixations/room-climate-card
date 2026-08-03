// The custom element: Home Assistant's lifecycle, the render pipeline, and the
// state transitions between them.
//
// What it does is deliberately narrow, and everything it does NOT do lives one layer
// down:
//
//   config and hass          it owns these, because Home Assistant hands them to it
//   the shadow DOM           it is the only thing that may write markup
//   warning deduplication    stateful, so it cannot live in a pure normalizer
//   lifecycle orchestration  connect, disconnect, and what each one starts or stops
//
// The render controller owns the three signatures, the deferred-render debt, whether
// anything has been rendered at all and the view model on screen. The carousel owns the
// active index and both timers. The interaction runtime owns the pointer, the drag flag
// and the click-suppression deadline. The resize runtime owns the observer, the
// animation frame and the fonts subscription. The element holds windows onto those —
// accessors, never copies — because a second copy of a fact is how the two drift apart.
//
// Import direction is enforced by test/unit/architecture-imports.test.js:
//
//   core -> config / i18n / domain -> application/model
//        -> presentation/view-model -> render/primitives + render/layout + styles
//        -> views + render/composition
//        -> controllers/runtime + controllers/render -> this file -> index.js
//
// The two controller groups sit on the same layer and may not import each other:
// controllers/render decides WHETHER and HOW MUCH to render, controllers/runtime
// decides WHEN things move. This file is the only place that knows both exist.
//
// Nothing below may be imported by a module above it, and Rollup's onwarn (see
// rollup.config.mjs) turns any cycle or unresolved specifier into a build failure.

// dist/room-climate-card.js is generated from this tree and committed; never edit it by
// hand. `npm run build` regenerates it, `npm run verify:dist` proves the committed copy
// still matches src/. The IIFE wrapper and the "use strict" prologue are emitted by the
// build (see rollup.config.mjs), which is why this file is a plain module.

import { CARD_NAME } from "../core/card-metadata.js";
import { formatNumber, formatTimeOfDay } from "../i18n/formatters.js";
import { isSupportedLanguage, resolveLanguage, translate } from "../i18n/translate.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { normalizeConfig } from "../config/normalize-config.js";
import { CLASSIFICATION_ZONES } from "../domain/classification/zones.js";
import { METRIC_DEFINITIONS } from "../domain/metrics/definitions.js";
import { METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } from "../domain/metrics/resolution.js";
import { normalizeUnitToken } from "../domain/units/unit-token.js";
import { resolveMeasurementContext } from "../application/model/measurement-context.js";
import { buildCardDomainModel } from "../application/model/card-domain-model.js";
import { autoRoomColumnsFor, metricMetaFor } from "../presentation/view-model/metric-meta.js";
import { roomGridRows } from "../presentation/view-model/room-layout.js";
import {
  VIEW_DEFINITIONS,
  optionSchemaForView,
  resolveActiveViews,
} from "../presentation/view-model/view-state.js";
import { buildCardViewModel } from "../presentation/view-model/card-view-model.js";
import { createRenderContext } from "../render/primitives/render-context.js";
import {
  patchCardBody,
  patchEmptyCardBody,
  renderCardBody,
  resolveViewLayouts,
} from "../render/composition/card-shell.js";
import { VIEW_RENDERERS } from "../views/registry.js";
import { buildStyles } from "../styles/index.js";
import { createBrowserPlatform } from "../controllers/runtime/browser-platform.js";
import { createCarouselController } from "../controllers/runtime/carousel-runtime.js";
import { createResizeRuntime } from "../controllers/runtime/resize-runtime.js";
import { createInteractionRuntime } from "../controllers/runtime/interaction-runtime.js";
import { createActionRuntime } from "../controllers/runtime/action-runtime.js";
import { createRenderController } from "../controllers/render/render-controller.js";
import { entityDataSignature, structuralConfigSignature } from "../controllers/render/render-signatures.js";


  // Custom card for Home Assistant room climate data (temperature, humidity,
  // CO2, PM2.5). Usage and configuration are documented in this repository's
  // README.
  //
  // One card-wide classification policy resolves complete HA attributes,
  // built-in profiles, or a validated custom YAML profile. A profile owns
  // tiers, score/zone metadata, bands, scale policy, and profile icons together.

  // ==== Composition: what the configuration layer is handed ====
  // config/ deliberately imports neither the domain, the i18n registry nor the
  // view registry — it normalizes input shapes, it does not own semantics. The
  // few facts it nevertheless needs are injected from here, which keeps the
  // dependency pointing one way and keeps a single copy of every registry.
  //
  // The lookups are wrapped rather than passed through so the configuration
  // layer never sees a registry object it could index into directly.
  const CONFIG_COLLABORATORS = {
    classificationZones: CLASSIFICATION_ZONES,
    isSupportedLanguage,
    optionSchemaForView,
    metricKindForUnit: (unit) => METRIC_TYPE_BY_UNIT[normalizeUnitToken(unit)],
    unitProfileForUnit: (metricKind, unit) => {
      const profileKey = resolveUnitProfileKey(metricKind, unit);
      return profileKey ? METRIC_DEFINITIONS[metricKind].unitProfiles[profileKey] : null;
    },
  };

  // ==== Card class: lifecycle, configuration, rendering ====
  // Main class for the custom Lovelace card; Home Assistant instantiates it
  // when the card is displayed.
  // NOTE ON INDENTATION: the class is deliberately indented by two spaces even though
  // it sits at module scope. Its render methods build markup from template literals
  // whose leading whitespace reaches the browser verbatim and is pinned by the DOM
  // characterization baselines. Re-indenting the class would change the shipped HTML.
  class RoomClimateCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });

      // _config/_hass come from Home Assistant; everything else drives
      // rendering, slider position, and pointer interaction.
      this._config = null;
      this._hass = null;

      // The only route to the outside world: a clock, timers, animation frames, the
      // reduced-motion preference, visibility, a ResizeObserver, the fonts promise,
      // event construction and one transform read. The document is resolved through a
      // thunk on every call rather than captured here, so a card adopted into another
      // document keeps scheduling and dispatching in the realm it now lives in.
      this._platform = createBrowserPlatform(() => this.ownerDocument);

      // Owns the active view index, both timers and every clock read. It is given a
      // platform, two narrow DOM ports and scalar timing values — never hass, the
      // configuration object, the domain model or a renderer.
      this._carousel = createCarouselController({
        platform: this._platform,
        getTrack: () => this.shadowRoot?.querySelector(".rtc-track") ?? null,
        getViewElements: () => this.shadowRoot?.querySelectorAll(".rtc-view") ?? null,
        // Three scalars, pulled on demand. The controller never sees the config object,
        // and there is no push that could be missed before the first render.
        getTimingConfig: () => ({
          rotationSeconds: this._config?.rotation_seconds ?? DEFAULT_CONFIG.rotation_seconds,
          slideSeconds: this._config?.slide_seconds ?? DEFAULT_CONFIG.slide_seconds,
          autoSlide: this._config?.auto_slide,
        }),
        // Whether a gesture is in flight is the interaction runtime's answer to give.
        // Resolved late, because that runtime is constructed below this one.
        isInteracting: () => Boolean(this._interaction?.isInteracting()),
      });

      // Container resizes and the web font finishing loading — the two triggers that
      // change the rendered width without any entity changing.
      this._resize = createResizeRuntime({
        platform: this._platform,
        onMeasure: () => this._resolveViewLayouts(this._renderController.lastViewModel),
      });

      // Hands a user action to Home Assistant. Gets neither hass nor this element:
      // two narrow configuration lookups and one dispatch callback.
      this._actions = createActionRuntime({
        platform: this._platform,
        getRooms: () => this._config?.rooms,
        getCardActions: () => ({ tap_action: this._config?.tap_action, hold_action: this._config?.hold_action }),
        dispatch: (event) => this.dispatchEvent(event),
      });

      // Owns the in-flight pointer, the confirmed-drag flag and the click-suppression
      // deadline. It decides what a gesture MEANS; the carousel decides how the track
      // moves.
      this._interaction = createInteractionRuntime({
        platform: this._platform,
        carousel: this._carousel,
        findInPath: (event, selector) => this._findInPath(event, selector),
        getRotator: (event) => this._findInPath(event, ".rtc-rotator"),
        isSwipeEnabled: () => this._config?.swipe !== false,
        getHoldSeconds: () => this._config.hold_seconds,
        // Routed through the element's own one-line entry point rather than straight
        // into the action runtime: that method is the seam existing tests substitute to
        // observe which action a gesture resolved to, and it holds no logic of its own.
        fireAction: (target, action) => this._fireHassAction(target, action),
        // The gesture reports what it did; whether anything was already owed is the
        // render controller's to answer. The debt is only READ here — the render that
        // follows clears it, and only if it succeeds.
        requestRender: ({ viewChanged }) => {
          if (!viewChanged && !this._renderController.isRenderPending) return;
          this._render(false);
        },
      });
      // This state is separate from this._views because the key list
      // alone can't distinguish a deliberately empty/collapsed view area
      // from one that's requested-but-unavailable — both resolve to an
      // empty list (see views.collapsed in presentation/view-model/
      // view-state.js). Set alongside this._views in _renderAll(), and part
      // of the structure signature _render() compares.
      this._viewAreaCollapsed = false;

      // Decides whether a render is needed and how much of one: the three signatures,
      // the deferred-render debt, whether anything has been rendered at all, and the
      // view model currently on screen. The element supplies the inputs and performs
      // the three paths; it no longer decides between them.
      this._renderController = createRenderController({
        viewRenderers: VIEW_RENDERERS,
        computeViewModel: () => this._computeViewModel(),
        isDragging: () => this._isDragging,
        isCurrentlyEmpty: () => Boolean(this.shadowRoot.querySelector(".rtc-empty")),
        renderAll: (viewModel, options) => this._renderAll(viewModel, options),
        updateEmpty: (viewModel) => this._updateEmpty(viewModel),
        updateContent: (viewModel) => this._updateContent(viewModel),
      });

      this._eventsBound = false;
      // Returned by the platform when the visibility listener is attached; the only
      // thing that knows how to detach it again.
      this._unlistenVisibility = null;
      // _language() memoization — see _language().
      this._languageCacheHass = undefined;
      this._languageCacheConfigLanguage = undefined;
      this._languageCacheValue = undefined;
      // _resolveMetricContext() memoization — see there.
      this._metricContextCacheHass = undefined;
      this._metricContextCacheConfig = undefined;
      this._metricContextCacheValue = undefined;
      // _warnAboutViewConfigOnce() dedup — see there.
      this._lastViewConfigWarningKey = null;
      // _warnMixedMetricKindsOnce() deduplication state — see there.
      this._lastMetricContextWarningKey = null;

      // Bind handlers once so add/removeEventListener always reference the
      // same function.
      this._boundClick = this._handleClick.bind(this);
      this._boundKeydown = this._handleKeydown.bind(this);
      this._boundPointerDown = this._handlePointerDown.bind(this);
      this._boundPointerMove = this._handlePointerMove.bind(this);
      this._boundPointerUp = this._handlePointerUp.bind(this);
      this._boundPointerCancel = this._handlePointerCancel.bind(this);
      this._boundContextMenu = this._handleContextMenu.bind(this);
      this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
    }

    // ==== Accessors over controller-owned state ====
    // Read-write only where the render path legitimately assigns — the resolved view
    // list and the active index, both of which a structural rebuild recomputes.
    // Everything else is read-only: a setter would either create a second copy of the
    // same fact or, in the strict-mode bundle, throw. None of them stores anything;
    // there is exactly one owner, and these are the window onto it.
    get _views() {
      return this._carousel.viewKeys;
    }

    set _views(keys) {
      this._carousel.setViews(keys);
    }

    get _activeView() {
      return this._carousel.activeIndex;
    }

    set _activeView(index) {
      this._carousel.activeIndex = index;
    }

    get _isDragging() {
      return this._interaction.isDragging;
    }

    static getStubConfig() {
      // Example config for the Home Assistant card editor; entity/rooms are
      // generic editor placeholders only (matching the README's own
      // Quickstart examples) — the card never falls back to default
      // entities at runtime (see _normalizeConfig()).
      return {
        entity: "sensor.house_temperature",
        rooms: [
          { name: "Kitchen", short: "KI", entity: "sensor.kitchen_temperature" },
          { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
          { name: "Living Room", short: "LR", entity: "sensor.living_room_temperature" },
        ],
      };
    }

    // STRONG EXCEPTION SAFETY. Either the whole configuration change happens, or
    // nothing observable does.
    //
    // Home Assistant's live YAML editor calls setConfig() on every keystroke, so most
    // calls during editing are INVALID — a half-typed entity id, a `rooms:` list with
    // one line still missing. Those must propagate the error (the editor shows it) and
    // otherwise leave the card exactly as it was.
    //
    // The previous ordering ended the running gesture before validating. That looked
    // harmless, because the render deferred during the gesture was correctly kept. But
    // the pointerup that would have SETTLED that render was now the end of a gesture
    // that no longer existed, so nothing applied it: a card mid-swipe when an update
    // arrived, followed by one rejected keystroke in the editor, kept showing the old
    // value until an unrelated update happened along. Keeping the debt is not enough if
    // the occasion to pay it is destroyed.
    //
    // Hence the split below. Everything that can throw runs first and writes nothing;
    // the commit phase cannot fail.
    setConfig(config) {
      // ---- validate: no observable state may change in here --------------------
      const normalized = this._normalizeConfig(config);

      // ---- commit: from here on nothing throws ---------------------------------
      // The view visible "before" must be read while the OLD configuration and view
      // list are still installed: _currentVisualViewIndex() reads this._config for its
      // wall-clock phase math, so computing it after the overwrite would reinterpret
      // the still-running old animation with the new timing and preserve the wrong
      // view. _renderAll() prefers this snapshot over recomputing live.
      this._renderController.capturePreConfigVisualKey(this._views[this._currentVisualViewIndex()] ?? null);
      try {
        // A configuration change can arrive mid-swipe. The gesture is aborted through
        // its owner, which settles a confirmed drag the same way a pointercancel does.
        // A render deferred by that gesture is deliberately NOT dropped — the
        // _render(false) below settles it.
        this._interaction.cancelForConfigChange();
        this._config = normalized;
        this._warnAboutViewConfigOnce();
        // _activeView is intentionally left untouched here — _renderAll() preserves it
        // across a structural change when the previously active view key still exists,
        // falling back to config.start_view then the first active view otherwise.
        this._renderController.invalidateDataSignature();
        // Do not restart rotation after this render: doing so would re-engage the
        // synchronized animation and undo the freeze _renderAll() performs for every
        // non-first-render structural change. _render(false) already handles rotation
        // state completely on its own — via _renderAll() when the change is structural,
        // or not at all when it is a purely cosmetic edit that must not disturb an
        // in-progress resume wait. connectedCallback() independently starts rotation
        // when the card is first attached to the DOM.
        this._render(false);
      } finally {
        // The snapshot is transient by construction: it belongs to exactly the one
        // render above. A `finally` because _render() can still throw on a malformed
        // entity STATE (a runtime problem, not a configuration one), and a stuck
        // snapshot would then leak into a later, unrelated rebuild.
        this._renderController.releasePreConfigVisualKey();
      }
    }

    _warnAboutViewConfigOnce() {
      // Validates views: against the view definitions once per setConfig() call
      // (i.e. once per actual config change) rather than inside
      // _computeViewModel(), which runs on every hass update — logging there
      // would flood the console for a persistently misconfigured YAML
      // value. Availability is "everything available" here on purpose: only the
      // static shape (unknown/duplicate type) is checked, not current
      // runtime availability, which resolveActiveViews() re-derives fresh
      // on every render anyway. Combines resolveActiveViews()'s own
      // unknown/duplicate-type diagnostics with _normalizeViewsConfig()'s
      // (non-array/unparseable-entry/invalid-enabled) diagnostics, carried
      // forward on this._config._viewsDiagnostics (see _normalizeConfig()),
      // into one flat list.
      //
      // The dedup key is updated on every
      // call, including when the current diagnostics list is empty — only
      // the actual console.warn() calls are skipped for an empty list. The
      // Returning early on an empty list without touching
      // _lastViewConfigWarningKey would make a sequence invalid -> valid -> the
      // SAME invalid config again incorrectly stayed silent on the third
      // step (the key still held the first invalid config's value, so it
      // looked like a duplicate). Resetting the key on the valid step fixes
      // that: only a genuinely repeated diagnostics list is deduplicated.
      const configDiagnostics = this._config?._viewsDiagnostics || [];
      const { diagnostics: resolveDiagnostics } = resolveActiveViews(
        VIEW_DEFINITIONS,
        { hasRange: true, hasRoomsView: true, rangeScaleAvailable: true },
        this._config
      );
      const diagnostics = [...configDiagnostics, ...resolveDiagnostics];
      const key = JSON.stringify(diagnostics);
      const isRepeat = key === this._lastViewConfigWarningKey;
      this._lastViewConfigWarningKey = key;
      if (!diagnostics.length || isRepeat) return;
      diagnostics.forEach((w) => console.warn(`${CARD_NAME}: ${w}`));
    }

    set hass(hass) {
      this._hass = hass;
      try {
        this._render();
      } catch (err) {
        // A malformed/unexpected entity state shouldn't crash the whole
        // dashboard on every subsequent hass update; log once per
        // occurrence for diagnosability and leave the last good render in place.
        console.error(`${CARD_NAME}: render failed`, err);
      }
    }

    connectedCallback() {
      // Lifecycle order is events -> carousel -> deferred-render catch-up -> resize.
      // Starting the carousel before catch-up restores runtime state needed by the
      // render path; a catch-up rebuild then rebinds events and recalculates carousel
      // styles against its new markup. Resize and fonts observation comes last because
      // it must inspect the view model committed by that render.
      this._bindEvents();
      this._startRotation();
      this._catchUpDeferredRender();
      this._bindResizeObserver();
    }

    // Pays a render deferred by a gesture that the disconnect then ended.
    //
    // Home Assistant hands over a new hass and does not hand it over again. If that
    // arrived mid-swipe it was deliberately not rendered, and if the card was then
    // removed from the document the gesture that would have released it never ends. Left
    // alone the card comes back showing a value Home Assistant superseded before the
    // removal, until some unrelated update happens along.
    //
    // Cheap when nothing is owed: the debt is a plain flag, and a card that never
    // deferred anything does no work at all here. `_render(false)` rather than
    // `_render()` because the point is to apply an update the signature fast path would
    // otherwise be entitled to skip — the deferral means the signature was never
    // committed, but bypassing it says so explicitly.
    _catchUpDeferredRender() {
      if (!this._renderController.isRenderPending) return;
      try {
        this._render(false);
      } catch (err) {
        // Same contract as set hass(): a bad state must not turn a dashboard reflow into
        // a thrown connectedCallback. The debt stays outstanding (see the controller's
        // commit-on-success), so the next connect tries again.
        console.error(`${CARD_NAME}: render failed`, err);
      }
    }

    disconnectedCallback() {
      // Card is removed or rebuilt by Home Assistant. Every runtime ends what it was
      // doing; nothing schedules anything into a card that is no longer in the document.
      //
      // The gesture goes first, and deliberately so: it is the only one of the three
      // whose state would otherwise BLOCK the reconnected card rather than merely leak.
      // A pointer that survives the removal keeps isInteracting() true, which stops the
      // carousel from starting and turns every hass update into a deferred render
      // waiting on a pointerup that can never arrive.
      //
      // The deferred render is deliberately NOT cleared here. It is a different kind of
      // obligation: the gesture must not survive, but the DATA behind the deferral must.
      // `_hass` already holds the newest state and Home Assistant will not send it again,
      // so dropping the debt here left the card showing a superseded value until some
      // unrelated update happened along. connectedCallback() pays it instead.
      this._interaction.disconnect();
      this._carousel.destroy();
      this._unbindEvents();
      this._unbindResizeObserver();
    }

    _bindResizeObserver() {
      // Re-measures the labels on a pure container resize (sidebar toggle, dashboard
      // column reflow, browser resize, device rotation). Safe to observe repeatedly
      // because the layout pass is idempotent — it always derives the position fresh
      // from the view model and never reads back its own previous pixel output.
      // Observing the card host remains valid across every structural rebuild.
      this._resize.connect(this);
      // A fonts.ready that settled while the card was out of the DOM still owes one
      // measurement — nothing could be measured on a detached node. Asking again on
      // reconnect is what collects that debt; it is a no-op in every other case.
      const onScreen = this._renderController.lastViewModel;
      if (onScreen && !onScreen.empty) {
        this._resize.measureOnceFontsReady(() => this.isConnected);
      }
    }

    _unbindResizeObserver() {
      this._resize.disconnect();
    }

    getCardSize() {
      // Rough size hint for Home Assistant's masonry layout (config-based, not live
      // data, so it uses the configured room count as an upper-bound proxy
      // for "will show room chips" — a room without live data yet still
      // gets counted here, unlike the live-data-driven capacity cap in
      // roomGridRows()). Extra chip rows add to the
      // base size one-for-one.
      const roomCount = this._config?.rooms?.length ?? 0;
      // show_rooms:false never renders the chip grid, so its rows
      // must not inflate the size hint either — same base size as too few
      // rooms to ever have shown chips at all.
      if (roomCount < 2 || this._config?.show_rooms === false) return 3;
      const rowCount = this._roomGridRows(roomCount, this._config?.room_columns, this._config?.room_rows, this._autoRoomColumnsFor(this._metricType())).rowSizes.length;
      return 4 + Math.max(0, rowCount - 1);
    }

    getGridOptions() {
      // Column bounds for the modern sections/grid view; no fixed row height,
      // so the card only takes up its actual content height.
      return {
        columns: 12,
        min_columns: 6,
        max_columns: 12,
      };
    }

    // ==== Configuration ====
    _normalizeConfig(config) {
      // The whole normalization lives in config/ as pure
      // functions without `this`. What stays here is only the wiring — the
      // registries the configuration layer is not allowed to import are passed
      // in from this composition root.
      return normalizeConfig(config, CONFIG_COLLABORATORS);
    }

    // ==== Auto-slide, track and accessibility controller boundary ====
    // Everything below forwards to this._carousel, which owns the active index, both
    // timers and every read of the wall clock. They are named entry points the render
    // and lifecycle paths above call — a structural rebuild freezes the track and
    // reschedules the accessibility sync through exactly these — and none of them holds
    // state of its own. An element member without a production caller is a failing
    // architecture test (see architecture-imports.test.js), so nothing below survives
    // only because a test likes the name.
    _startRotation() {
      this._carousel.start();
    }

    _stopRotation() {
      this._carousel.stop();
    }

    _viewWidthPct() {
      return this._carousel.viewWidthPct();
    }

    _trackAnimationCss() {
      return this._carousel.trackAnimationCss();
    }

    _slideKeyframes() {
      return this._carousel.slideKeyframes();
    }

    _currentVisualViewIndex() {
      return this._carousel.currentVisualIndex();
    }

    _applyAutoSlideStyles() {
      this._carousel.applyAutoSlideStyles();
    }

    _scheduleAccessibilitySync() {
      this._carousel.scheduleAccessibilitySync();
    }

    _resumeSynchronizedSlideWhenAligned(targetView, minDelayMs = 10000) {
      this._carousel.resumeWhenAligned(targetView, minDelayMs);
    }

    _updateTrackTransform(transition = true) {
      this._carousel.updateTrackTransform(transition);
    }

    _language() {
      // Base language code (e.g. "de" from "de-AT"), checked against
      // the registered translations. An explicit config.language override (see
      // _normalizeLanguage()) wins outright; otherwise locale.language
      // takes priority as HA's most granular, explicitly user-selectable
      // setting, then language/selectedLanguage. A single render calls
      // this many times (once per _fmt()/_t() call); cached by hass
      // reference identity plus the config override value, so a plain
      // hass update (HA reassigns a new object on every real update) never
      // returns a stale value, and a setConfig()-only language change
      // (no new hass object) invalidates the cache too.
      const configLanguage = this._config?.language;
      if (this._languageCacheHass === this._hass && this._languageCacheConfigLanguage === configLanguage) {
        return this._languageCacheValue;
      }
      const value = resolveLanguage(configLanguage, this._hass);
      this._languageCacheHass = this._hass;
      this._languageCacheConfigLanguage = configLanguage;
      this._languageCacheValue = value;
      return value;
    }

    _t(key, vars) {
      // Translates key in the current language — see translate() in
      // i18n/translate.js for the English fallback and key-fallback rules.
      return translate(this._language(), key, vars);
    }

    _metricMetaFor(metricType) {
      // Shared fallback: unknown/missing metric types resolve to temperature.
      return metricMetaFor(metricType);
    }

    _autoRoomColumnsFor(metricType) {
      return autoRoomColumnsFor(metricType);
    }

    _metricMeta() {
      return this._metricMetaFor(this._metricType());
    }

    _fmt(value, digits) {
      // The digit count is resolved here, where the config override and the
      // metric's own default are known; the formatting itself is locale work.
      const d = digits ?? this._config.decimals ?? this._metricMeta().decimals;
      return formatNumber(this._language(), value, d);
    }

    _formatTime(isoString) {
      return formatTimeOfDay(this._language(), isoString);
    }

    _warnMixedMetricKindsOnce(diagnostic) {
      // Deduplicated the same way as _warnAboutViewConfigOnce() (see there),
      // but keyed on the resolved diagnosis itself rather than on
      // setConfig() calls: _resolveMetricContext() re-resolves on every hass
      // update (HA reassigns a new hass object each time, invalidating the
      // memoization above), so without this a persistently misconfigured
      // set of rooms would log on every single update instead of once,
      // while a genuinely NEW diagnosis (different disagreeing kinds) still
      // needs to be surfaced again.
      const key = JSON.stringify(diagnostic);
      if (key === this._lastMetricContextWarningKey) return;
      this._lastMetricContextWarningKey = key;
      console.warn(
        `${CARD_NAME}: rooms report incompatible metric kinds (${diagnostic.metricKinds.join(", ")}) and no usable primary entity is configured to arbitrate — no average is computed (see the empty-state hint) — configure a consistent device_class/unit_of_measurement across all room entities, or set a primary entity.`
      );
    }

    // Memoized by hass/config identity. Home Assistant reassigns a fresh hass
    // object on every real update, so identity is exactly the right invalidation
    // signal, and a single render asks for the context many times.
    //
    // The mixed-kind warning is deduplicated and therefore stateful, which is why
    // it stays out here rather than inside the pure resolution. It fires on a cache
    // MISS only — the same moments it fired before.
    _resolveMetricContext() {
      if (this._metricContextCacheHass === this._hass && this._metricContextCacheConfig === this._config) {
        return this._metricContextCacheValue;
      }
      const value = resolveMeasurementContext(this._hass?.states, this._config);
      const mixed = value.diagnostics.find((diagnostic) => diagnostic.code === 'mixed_metric_kinds');
      if (mixed) this._warnMixedMetricKindsOnce(mixed);
      this._metricContextCacheHass = this._hass;
      this._metricContextCacheConfig = this._config;
      this._metricContextCacheValue = value;
      return value;
    }

    _unit() {
      // Card unit — see _resolveMetricContext() for how it's kept
      // consistent with _metricType(). Always a real unit string (never
      // null), even when metricType itself is null (the
      // "mixed_metric_kinds" configuration state) — _resolveMetricContext()
      // resolves canonicalUnit/unit via _metricMetaFor()'s own
      // temperature-default fallback in that case.
      return this._resolveMetricContext().unit;
    }

    _metricType() {
      // Card mode — see _resolveMetricContext() for how it's kept
      // consistent with _unit(). Can be null when
      // _resolveMetricContext() finds rooms reporting genuinely
      // incompatible metric kinds with no usable primary to arbitrate
      // ("mixed_metric_kinds") — this safety fallback keeps every existing
      // direct caller (icon/title lookups via _metricMetaFor(), etc.)
      // working with a sensible default instead of suddenly receiving null.
      return this._resolveMetricContext().metricType || "temperature";
    }

    // ==== MetricDefinition / UnitProfile / QuantityKind ====
    // Testable instance-method wrappers around the module-scope
    // METRIC_DEFINITIONS registry and its pure helper functions above — the
    // same pattern this class already uses for other pure logic
    // (_isPhysicallyValid(), _floorToStep()/_ceilToStep()). _convertMetricValue()
    // and _getUnitProfile() are called from _buildEntityModel() (see
    // below _resolveMetricContext()) for every metric kind. Temperature has
    // real Celsius/Fahrenheit/Kelvin conversion; the other profiles use
    // identity conversion.

    _fmtWithUnit(value, digits, withSpace = true) {
      // Combines the formatted number and its unit.
      const separator = withSpace ? " " : "";
      return `${this._fmt(value, digits)}${separator}${this._unit()}`;
    }

    _roomGridRows(count, columns, rows, autoMaxColumns = 7) {
      return roomGridRows(count, columns, rows, autoMaxColumns);
    }

    // ==== Data computation ====
    // The production entry point. Domain logic lives in application/model
    // (numbers and semantic tokens) and presentation/view-model (titles, formatting,
    // geometry, colours); this method only supplies the inputs.
    _computeViewModel() {
      const context = this._resolveMetricContext();
      const domainModel = buildCardDomainModel({
        // hass.states is read, never written or copied.
        states: this._hass?.states,
        config: this._config,
        context,
        // A plain locale string, needed for the name tie-break that keeps the
        // extrema and the "stands out most" room agreeing on ties.
        language: this._language(),
      });
      return buildCardViewModel({ domainModel, config: this._config, texts: this._texts() });
    }

    // The narrow presentation collaborator: a translator and three formatters,
    // nothing that could reach the card, the DOM or the configuration.
    _texts() {
      return {
        language: this._language(),
        t: (key, vars) => this._t(key, vars),
        fmt: (value, digits) => this._fmt(value, digits),
        fmtWithUnit: (value, digits, withSpace) => this._fmtWithUnit(value, digits, withSpace),
        formatTime: (isoString) => this._formatTime(isoString),
      };
    }

    // The only DOM capability the rendering layer is given: this card's own document,
    // that document's window, and the two element operations derived from them. Built
    // per call because it is a handful of property reads, and because caching it would
    // add the one failure mode it does not otherwise have — going stale if the card is
    // ever adopted into another document.
    _renderContext() {
      return createRenderContext(this.ownerDocument);
    }

    // ==== Rendering ====
    // Builds the card HTML into the shadow DOM; once built, only the
    // dynamic values are updated so the slide animation never jumps.
    // Returns which path the render took (see RENDER_PATH), or null when there is
    // nothing to render from yet. Returned rather than kept private because "this
    // update was a patch, not a rebuild" is the property the partial-update pipeline
    // exists to provide, and asserting it should not require reading private state.
    _render(allowSkip = true) {
      if (!this._config || !this._hass) return null;
      // Config and hass are the element's; everything derived from them is not. The two
      // signatures are computed here because this is the only place both are in hand,
      // and handed to the controller that decides what to do with them.
      return this._renderController.render({
        allowSkip,
        dataSignature: entityDataSignature({
          config: this._config,
          states: this._hass.states,
          language: this._language(),
          activeViewIndex: this._activeView,
        }),
        structuralConfigSignature: structuralConfigSignature(this._config),
      });
    }

    _renderAll(viewModel, { isFirstRender = !this._renderController.hasRendered, preConfigVisualKey = undefined } = {}) {
      // Full (re)build on first render, empty/normal-state changes, or a
      // view-composition change. _views/_activeView must be set before
      // _styles(), which derives track/view widths and keyframes from the
      // current view list; a structural change preserves the previously
      // active view when it still exists (see previousActiveKey below),
      // falling back to config.start_view, then the first active view.
      //
      // A structural rebuild can happen while the user is deliberately
      // "parked" on a manually-swiped view, still waiting out its resume
      // timer (e.g. a range_entity blips unavailable and back while the
      // user is looking at the daily-range view). Naively calling
      // _applyAutoSlideStyles() below would immediately re-engage the
      // synced animation and jump away from that view, defeating the whole
      // point of the phase-aware resume: the card must remain on the manually
      // selected view until the shared wall-clock phase reaches that view again.
      // isFirstRender arrives as an argument: the controller flips its `rendered` flag
      // only after this method returns, so "is there a previous view worth protecting"
      // is decided once, by the owner of that fact, rather than read back mid-render.

      // The innerHTML replacement below destroys everything an
      // unclassified in-flight gesture is anchored to. The runtime owns that decision
      // and states the reasoning in full; the element only has to say when.
      this._interaction.abandonGestureForRebuild();

      // Dropping to fewer than two active views renders a
      // track-less solo/empty layout (no ".rtc-track" at all — see
      // renderCardBody()'s view-area branch). _applyAutoSlideStyles()
      // bails out on its very first line when there's no track, so it
      // never reaches _scheduleAccessibilitySync() — the only place that
      // otherwise clears the accessibility timer. Without this, a timer armed
      // while at least two views were active would linger until it fires.
      // _stopRotation() clears both
      // timers unconditionally; the branches below re-arm exactly what's
      // actually warranted for the NEW view count — for every other
      // transition this is a harmless no-op, since
      // _scheduleAccessibilitySync()/_resumeSynchronizedSlideWhenAligned()
      // already clear-before-set themselves.
      this._stopRotation();

      // _currentVisualViewIndex() (shared with
      // _updateViewAccessibility(), see there) is read against the
      // still-mounted PREVIOUS render's track/this._views, before either is
      // replaced below — so a structural change mid-auto-slide preserves
      // whichever view was actually on screen, not the stale
      // this._activeView. A live setConfig() change already captured this
      // BEFORE overwriting this._config (see there) — using the OLD timing
      // definition, never the new one — and the controller carries that snapshot in
      // as preConfigVisualKey; prefer it when present, otherwise (the ordinary
      // hass-driven-update case, where this._config never changed) compute it live.
      // `undefined` means no snapshot; `null` is a real snapshot of "no view".
      const previousActiveKey = preConfigVisualKey !== undefined
        ? preConfigVisualKey
        : (this._views[this._currentVisualViewIndex()] ?? null);
      this._views = viewModel.empty ? [] : viewModel.views.keys;
      this._viewAreaCollapsed = viewModel.empty ? false : Boolean(viewModel.views.collapsed);
      let nextIndex = this._views.indexOf(previousActiveKey);
      if (nextIndex === -1) nextIndex = this._views.indexOf(this._config?.start_view);
      // No view is mandatory: nextIndex === -1 ? 0 : nextIndex already means "the first
      // active view" (index 0 of this._views), which is exactly the
      // correct final fallback now that any view, including "scale", can
      // be absent.
      this._activeView = nextIndex === -1 ? 0 : nextIndex;

      const context = this._renderContext();
      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>
        <ha-card class="rtc-card">
          ${renderCardBody(context, viewModel, VIEW_RENDERERS)}
        </ha-card>
      `;
      this._bindEvents();
      if (!isFirstRender && !viewModel.empty) {
        // previousActiveKey above is correctly preserved, but that alone is only a JS
        // bookkeeping value. Applying auto-slide styles here would re-engage the synchronized animation
        // immediately, which ignores this._activeView entirely and can show
        // any view depending on the current phase. That silently defeated
        // preserving previousActiveKey/start_view/the first-active-view fallback.
        // Every non-first,
        // non-empty rebuild now freezes visually on the just-resolved
        // this._activeView first, then schedules the same phase-aware
        // resume used by the manual-swipe path, so DOM/CSS and
        // this._activeView stay aligned. The very first render is
        // deliberately excluded: there is no previous view to protect, so
        // going straight into synced auto-slide is correct there.
        this._updateTrackTransform(false);
        // The track just landed back in manual/frozen mode (see
        // _updateTrackTransform()), so accessibility must be computed AFTER
        // that decision, not before it (a freshly rebuilt track has no
        // "rtc-manual" class yet — computing it earlier would briefly treat
        // the track as auto-engaged, see _currentVisualViewIndex()). The
        // else branch below doesn't need this call: _applyAutoSlideStyles()
        // already schedules it internally.
        this._scheduleAccessibilitySync();
        this._resumeSynchronizedSlideWhenAligned(this._activeView, 10000);
      } else {
        this._applyAutoSlideStyles();
      }
      this._resolveViewLayouts(viewModel);
      // On a cold dashboard reload the measurement above can run before the page's
      // web font has loaded (the card inherits its font from the page and has no
      // @font-face of its own), and fallback-font metrics produce a slightly wrong
      // position that looks like an overlap until something else re-renders. The
      // runtime subscribes exactly once per card instance and measures from the
      // controller's committed view model at fire time, so a later render cannot be
      // undone by an older one arriving late.
      if (!viewModel.empty) this._resize.measureOnceFontsReady(() => this.isConnected);
    }

    // Every mounted view re-measures its own labels. The card holds no knowledge of
    // which views have a layout pass — the registry does, and a view that declares no
    // resolveLayout hook is simply skipped.
    _resolveViewLayouts(viewModel) {
      resolveViewLayouts(this._renderContext(), this.shadowRoot, viewModel, VIEW_RENDERERS);
    }

    _updateEmpty(viewModel) {
      // Updates the empty state without a full DOM rebuild.
      if (!this.shadowRoot) return;
      patchEmptyCardBody(this.shadowRoot, viewModel);
    }

    _updateContent(viewModel) {
      // Fast partial update on new HA values: only text, markers, colors,
      // and dynamic subsections change, so the slider animation never restarts.
      const root = this.shadowRoot;
      if (!root) return;
      patchCardBody(this._renderContext(), root, viewModel, VIEW_RENDERERS);
    }

    // ==== Event handling ====
    // Event listeners for click, keyboard, and touch/pointer interaction.
    _bindEvents() {
      if (this._eventsBound || !this.shadowRoot) return;
      this.shadowRoot.addEventListener("click", this._boundClick);
      this.shadowRoot.addEventListener("keydown", this._boundKeydown);
      this.shadowRoot.addEventListener("pointerdown", this._boundPointerDown);
      this.shadowRoot.addEventListener("pointermove", this._boundPointerMove);
      this.shadowRoot.addEventListener("pointerup", this._boundPointerUp);
      this.shadowRoot.addEventListener("pointercancel", this._boundPointerCancel);
      this.shadowRoot.addEventListener("pointerleave", this._boundPointerCancel);
      this.shadowRoot.addEventListener("contextmenu", this._boundContextMenu);
      // Not shadow-root-scoped (visibilitychange only fires on the document) —
      // resyncs the accessibility timer when the tab becomes visible again after the
      // sync paused itself while hidden. The platform hands back the unsubscribe, so
      // the pair can never disagree about what was attached.
      this._unlistenVisibility = this._platform.onVisibilityChange(this._boundVisibilityChange);
      this._eventsBound = true;
    }

    _unbindEvents() {
      if (!this._eventsBound || !this.shadowRoot) return;
      this.shadowRoot.removeEventListener("click", this._boundClick);
      this.shadowRoot.removeEventListener("keydown", this._boundKeydown);
      this.shadowRoot.removeEventListener("pointerdown", this._boundPointerDown);
      this.shadowRoot.removeEventListener("pointermove", this._boundPointerMove);
      this.shadowRoot.removeEventListener("pointerup", this._boundPointerUp);
      this.shadowRoot.removeEventListener("pointercancel", this._boundPointerCancel);
      this.shadowRoot.removeEventListener("pointerleave", this._boundPointerCancel);
      this.shadowRoot.removeEventListener("contextmenu", this._boundContextMenu);
      this._unlistenVisibility?.();
      this._unlistenVisibility = null;
      this._eventsBound = false;
    }

    _handleVisibilityChange() {
      if (this._platform.isDocumentHidden() || !this._renderController.hasRendered) return;
      this._scheduleAccessibilitySync();
    }

    _findInPath(event, selector) {
      // Finds the closest element matching selector along the event's composed path (shadow-DOM-safe).
      const path = event.composedPath ? event.composedPath() : [];
      return path.find((node) => node?.matches?.(selector)) || null;
    }

    // ==== Interaction and actions controller boundary ====
    // The listeners are bound to these methods, and a number of tests call them
    // directly with a synthetic event. Neither holds any logic or state of its own.
    _handleClick(event) {
      this._interaction.handleClick(event);
    }

    _handleKeydown(event) {
      this._interaction.handleKeydown(event);
    }

    _handlePointerDown(event) {
      this._interaction.handlePointerDown(event);
    }

    _handlePointerMove(event) {
      this._interaction.handlePointerMove(event);
    }

    _handlePointerUp(event) {
      this._interaction.handlePointerUp(event);
    }

    _handlePointerCancel(event) {
      this._interaction.handlePointerCancel(event);
    }

    _handleContextMenu(event) {
      this._interaction.handleContextMenu(event);
    }

    _fireHassAction(target, action) {
      this._actions.fire(target, action);
    }

    // ==== Styles ====
    // All CSS for the card, scoped to the shadow DOM. The stylesheet itself lives in
    // styles/; the four values below are the only per-render inputs it has, and all
    // four come from the carousel.
    _styles() {
      return buildStyles({
        keyframes: this._slideKeyframes(),
        trackAnimationCss: this._trackAnimationCss(),
        viewCount: (this._views || []).length,
        viewWidthPct: this._viewWidthPct(),
      });
    }
  }


export { RoomClimateCard };
