// The custom element: Home Assistant's lifecycle, the render pipeline, and the state
// transitions between them. It owns config, hass, the shadow DOM, warning dedup and
// lifecycle orchestration; the controllers own everything else and the element holds
// accessors onto them, never copies. Owner/runtime split: interne Doku §4
// „Owner- und Runtime-Verträge".
//
// Import direction, enforced by test/unit/architecture-imports.test.js (a cycle or
// unresolved specifier is also a Rollup build failure):
//
//   core -> config / i18n / domain -> application/model
//        -> presentation/view-model -> render/primitives + render/layout + styles
//        -> views + render/composition
//        -> controllers/runtime + controllers/render -> this file -> index.js
//
// The two controller groups sit on one layer and may not import each other:
// controllers/render decides WHETHER and HOW MUCH, controllers/runtime decides WHEN.

import { CARD_NAME } from "../core/card-metadata.js";
import { formatNumber, formatTimeOfDay } from "../i18n/formatters.js";
import { isSupportedLanguage, resolveLanguage, translate } from "../i18n/translate.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { normalizeConfig } from "../config/normalize-config.js";
import { CLASSIFICATION_ZONES } from "../domain/classification/zones.js";
import {
  DEFAULT_PALETTE,
  assertPalette,
  completePalette,
  MAX_GRADIENT_COLORS,
  paletteForColor,
  paletteForGradient,
  paletteForName,
  paletteKeys,
} from "../domain/classification/palettes/registry.js";
import { SURFACE_BACKGROUNDS } from "../domain/classification/surface.js";
import { surfaceOf } from "../domain/classification/paint-roles.js";
import { METRIC_DEFINITIONS } from "../domain/metrics/definitions.js";
import { METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } from "../domain/metrics/resolution.js";
import { normalizeUnitToken } from "../domain/units/unit-token.js";
import { resolveMeasurementContext } from "../application/model/measurement-context.js";
import { buildCardDomainModel } from "../application/model/card-domain-model.js";
import {
  chipsWouldDuplicateHeadline,
  resolveSourceEligibility,
  resolveSourceTopology,
} from "../application/model/source-topology.js";
import { stubConfigFor } from "../application/model/card-suggestions.js";
import { autoRoomColumnsFor, metricMetaFor } from "../presentation/view-model/metric-meta.js";
import { roomGridRows } from "../presentation/view-model/room-layout.js";
import {
  VIEW_DEFINITIONS,
  optionSchemaForView,
  resolveActiveViews,
} from "../presentation/view-model/view-state.js";
import { buildCardViewModel } from "../presentation/view-model/card-view-model.js";
import { createRenderContext } from "../render/primitives/render-context.js";
import { applyFocusFallback } from "../render/primitives/focus.js";
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
import { createSurfaceWatch } from "../controllers/runtime/surface-watch.js";
import { createInteractionRuntime } from "../controllers/runtime/interaction-runtime.js";
import { createActionRuntime } from "../controllers/runtime/action-runtime.js";
import { createRenderController } from "../controllers/render/render-controller.js";
import { entityDataSignature, structuralConfigSignature } from "../controllers/render/render-signatures.js";


  // ==== Composition: what the configuration layer is handed ====
  // config/ must not import the domain, i18n or view registries; the facts it needs
  // are injected here, wrapped so it never sees a registry object to index into. The
  // authoritative list is in the head of config/normalize-config.js.
  const CONFIG_COLLABORATORS = {
    classificationZones: CLASSIFICATION_ZONES,
    isSupportedLanguage,
    optionSchemaForView,
    viewTypes: VIEW_DEFINITIONS.map((definition) => definition.key),
    metricKindForUnit: (unit) => METRIC_TYPE_BY_UNIT[normalizeUnitToken(unit)],
    unitProfileForUnit: (metricKind, unit) => {
      const profileKey = resolveUnitProfileKey(metricKind, unit);
      return profileKey ? METRIC_DEFINITIONS[metricKind].unitProfiles[profileKey] : null;
    },
    paletteForName: (name) => (name === null ? DEFAULT_PALETTE : paletteForName(name)),
    paletteForColor,
    paletteForGradient,
    // Handed over rather than restated in the error message, so the number the user is
    // told cannot drift from the one the generator enforces (as with paletteKeys()).
    paletteGradientLimit: MAX_GRADIENT_COLORS,
    paletteKeys,
    assertPalette,
    completePalette,
  };

  // ==== Card class: lifecycle, configuration, rendering ====
  // NOTE ON INDENTATION: the class is indented two spaces at module scope on purpose.
  // Its render methods build markup from template literals whose leading whitespace
  // ships verbatim and is pinned by the DOM characterization baselines — re-indenting
  // the class would change the shipped HTML.
  class RoomClimateCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });

      // _config/_hass come from Home Assistant; everything else drives
      // rendering, slider position, and pointer interaction.
      this._config = null;
      this._hass = null;
      // True only for the duration of _assertRenderable(), which runs the real render
      // path against a configuration that is not installed yet.
      this._rehearsing = false;

      // The only route to browser runtime services (clock, timers, rAF, reduced-motion,
      // visibility, observers, fonts, event construction, transform read). The document
      // is resolved through a thunk on every call, so a card adopted into another
      // document keeps scheduling in the realm it now lives in.
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

      // A theme switch, an OS dark-mode flip, a card-mod repaint — none changes an
      // entity or the config, so nothing else would bring the card back to re-read what
      // it is standing on. The watch supplies the occasion; _render()'s data signature
      // decides whether anything changed. See interne Doku §5 „Wann die Karte erneut fragt".
      this._surfaceWatch = createSurfaceWatch({
        platform: this._platform,
        onChange: () => {
          try {
            this._render();
          } catch (err) {
            // Same contract as set hass(): a background change must not turn a theme
            // switch into a thrown listener that takes the dashboard with it.
            console.error(`${CARD_NAME}: render failed`, err);
          }
        },
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
      // Separate from this._views: the key list alone can't tell a deliberately
      // collapsed view area from a requested-but-unavailable one (both are an empty
      // list — see views.collapsed in view-state.js). Set in _renderAll(); part of the
      // structure signature _render() compares.
      this._viewAreaCollapsed = false;

      // Decides whether a render is needed and how much of one (owns the three
      // signatures, the deferred-render debt, the rendered flag and the on-screen view
      // model). The element supplies inputs and performs the three paths. See interne
      // Doku §5 „Render-Controller".
      this._renderController = createRenderController({
        viewRenderers: VIEW_RENDERERS,
        computeViewModel: () => this._computeViewModel(),
        isDragging: () => this._isDragging,
        isCurrentlyEmpty: () => this.shadowRoot.querySelector(".rtc-root")?.getAttribute("data-state") === "no-data",
        renderAll: (viewModel, options) => this._renderAll(viewModel, options),
        updateEmpty: (viewModel) => this._updateEmpty(viewModel),
        updateContent: (viewModel) => this._updateContent(viewModel),
      });

      this._eventsBound = false;
      // The platform's unsubscribe for the visibility listener.
      this._unlistenVisibility = null;
      // Memoization state, each keyed and invalidated in its own method:
      this._surfaceCacheKey = undefined; // _surface()
      this._surfaceCacheValue = undefined;
      this._languageCacheHass = undefined; // _language()
      this._languageCacheConfigLanguage = undefined;
      this._languageCacheValue = undefined;
      this._metricContextCacheHass = undefined; // _resolveMetricContext()
      this._metricContextCacheConfig = undefined;
      this._metricContextCacheValue = undefined;
      this._lastViewConfigWarningKey = null; // _warnAboutViewConfigOnce() dedup
      this._lastMetricContextWarningKey = null; // _warnMixedMetricKindsOnce() dedup

      // Bind handlers once so add/removeEventListener reference the same function.
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
    // Windows onto the one owner; they store nothing. Read-write only where the render
    // path legitimately assigns (the view list and active index, both recomputed by a
    // structural rebuild); everything else is read-only.
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

    // The configuration the card starts out as in the picker. HA passes the current
    // view's entities and a fallback list (all three args optional); the stub names a
    // real sensor when it can, else the documented placeholder template. See interne
    // Doku §4 „Card-Picker-Vertrag".
    static getStubConfig(hass, entities, entitiesFallback) {
      return stubConfigFor(hass?.states, entities, entitiesFallback);
    }

    // Strong exception safety: everything that can throw runs first and writes nothing;
    // the commit phase cannot fail. HA's live YAML editor calls setConfig() on every
    // keystroke, so invalid calls are the norm and must leave the card untouched. See
    // interne Doku §3 „setConfig() und YAML-Normalisierung" and §5 „setConfig() ist auch
    // für renderzeitige Fehler atomar".
    setConfig(config) {
      // ---- validate: no observable state may change in here --------------------
      const normalized = this._normalizeConfig(config);
      this._assertRenderable(normalized);

      // ---- commit: from here on nothing throws ---------------------------------
      // The "before" view must be read while the OLD config and view list are still
      // installed — _currentVisualViewIndex() does wall-clock phase math against
      // this._config. _renderAll() prefers this snapshot over recomputing live.
      this._renderController.capturePreConfigVisualKey(this._views[this._currentVisualViewIndex()] ?? null);
      try {
        // A config change can arrive mid-swipe; aborting the gesture through its owner
        // settles a confirmed drag like a pointercancel. The render it deferred is NOT
        // dropped — the _render(false) below settles it.
        this._interaction.cancelForConfigChange();
        this._config = normalized;
        this._warnAboutViewConfigOnce();
        // _activeView is left untouched: _renderAll() preserves it across a structural
        // change, else falls back to config.start_view then the first active view.
        this._renderController.invalidateDataSignature();
        // Rotation is deliberately not restarted here: _render(false) handles rotation
        // state itself (via _renderAll() when structural, not at all for a cosmetic edit
        // mid-resume-wait), and connectedCallback() starts it on first attach.
        this._render(false);
      } finally {
        // Transient snapshot for exactly the one render above; `finally` because
        // _render() can still throw on a malformed entity STATE, and a stuck snapshot
        // would leak into a later rebuild.
        this._renderController.releasePreConfigVisualKey();
      }
    }

    _warnAboutViewConfigOnce() {
      // Validates views: against the view definitions once per config change, not in
      // _computeViewModel() (which runs on every hass update and would flood the
      // console). Availability is "everything available" here: only the static shape
      // (unknown/duplicate type) is checked. Combines resolveActiveViews()'s diagnostics
      // with the normalizer's, carried on this._config._configDiagnostics.
      //
      // The dedup key is updated on every call, empty list included — only the
      // console.warn() calls are skipped for an empty list. That reset is what lets the
      // sequence invalid -> valid -> the same invalid config warn again on the third
      // step. See interne Doku §4 „Fehler- und Warnungs-Deduplizierung".
      const configDiagnostics = this._config?._configDiagnostics || [];
      const { diagnostics: resolveDiagnostics } = resolveActiveViews(
        VIEW_DEFINITIONS,
        { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
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
      // Order: events -> carousel -> deferred-render catch-up -> resize. The carousel
      // must be up before catch-up (which rebinds events and recomputes carousel styles
      // against the new markup); resize/fonts observation is last because it inspects
      // the committed view model. See interne Doku §5 „Lifecycle, Disconnect und Reconnect".
      this._bindEvents();
      this._startRotation();
      this._catchUpDeferredRender();
      this._bindResizeObserver();
      // A card can return into a different document, dashboard or theme, and none of
      // that arrives as an update. Costs one signature comparison on the same ground.
      this._render();
    }

    // Pays a render deferred by a gesture that the disconnect then ended: HA sends the
    // new hass once, and a mid-swipe removal leaves that gesture without a pointerup to
    // release it. Cheap when nothing is owed (a plain flag). `_render(false)` bypasses
    // the signature fast path, because the deferral means the signature was never
    // committed. See interne Doku §5 „Lifecycle, Disconnect und Reconnect".
    _catchUpDeferredRender() {
      if (!this._renderController.isRenderPending) return;
      try {
        this._render(false);
      } catch (err) {
        // As in set hass(): a bad state must not throw out of connectedCallback. The
        // debt stays outstanding (controller commit-on-success), retried next connect.
        console.error(`${CARD_NAME}: render failed`, err);
      }
    }

    disconnectedCallback() {
      // Every runtime ends what it was doing. The gesture goes first: it is the only
      // one whose surviving state would BLOCK the reconnected card (a live pointer keeps
      // isInteracting() true, stalling the carousel and every hass update). The deferred
      // render is deliberately NOT cleared — the gesture must not survive, but the data
      // behind it must; connectedCallback() pays it. See interne Doku §5 „Lifecycle,
      // Disconnect und Reconnect".
      this._interaction.disconnect();
      this._carousel.destroy();
      this._unbindEvents();
      this._unbindResizeObserver();
    }

    _bindResizeObserver() {
      // Re-measures labels on a pure container resize. Safe to observe repeatedly: the
      // layout pass is idempotent (derives position fresh from the view model, never
      // reads back its own pixel output), and the card host is stable across rebuilds.
      this._resize.connect(this);
      // A fonts.ready that settled while the card was detached still owes one
      // measurement; asking again on reconnect collects that debt, a no-op otherwise.
      const onScreen = this._renderController.lastViewModel;
      if (onScreen && !onScreen.empty) {
        this._resize.measureOnceFontsReady(() => this.isConnected);
      }
    }

    _unbindResizeObserver() {
      this._resize.disconnect();
    }

    getCardSize() {
      // Rough size hint for HA's masonry layout, an UPPER BOUND: a room with no value
      // yet still counts (unlike roomGridRows()'s live capacity cap). Applies the same
      // chip-visibility contract as the view model minus the live-data parts, and one
      // source set for both the topology and the room count, so the hint never reserves
      // a row for a grid the card decided not to draw. Before the first update the
      // configuration alone decides. See interne Doku §5 „Measurement Context und
      // Raumaggregation".
      const showRooms = this._config?.show?.rooms ?? "auto";
      const states = this._hass?.states;
      const isSource = states ? resolveSourceEligibility(states, this._config) : null;
      const topology = isSource
        ? resolveSourceTopology(this._config, isSource)
        : resolveSourceTopology(this._config);
      const rooms = this._config?.rooms ?? [];
      const roomCount = isSource ? rooms.filter((room) => isSource(room.entity)).length : rooms.length;
      const chipsDrawn =
        roomCount >= 1 && showRooms !== false && (showRooms === true || !chipsWouldDuplicateHeadline(topology));
      if (!chipsDrawn) return 3;
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
      // Normalization is pure functions in config/; this is only the wiring of the
      // registries that layer may not import.
      return normalizeConfig(config, CONFIG_COLLABORATORS);
    }

    // ==== Auto-slide, track and accessibility controller boundary ====
    // Stateless named entry points onto this._carousel, called by the render and
    // lifecycle paths above. An element member without a production caller fails an
    // architecture test (architecture-imports.test.js).
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
      // Base language code; resolution rules in resolveLanguage() (i18n/translate.js).
      // Called many times per render, so cached by hass reference identity plus the
      // config override value — both observable identities that must invalidate it.
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
      // Deduplicated like _warnAboutViewConfigOnce(), but keyed on the resolved
      // diagnosis itself: _resolveMetricContext() re-resolves on every hass update, so
      // a persistently misconfigured set of rooms would otherwise log every time, while
      // a genuinely new diagnosis still needs surfacing.
      const key = JSON.stringify(diagnostic);
      if (key === this._lastMetricContextWarningKey) return;
      this._lastMetricContextWarningKey = key;
      console.warn(
        `${CARD_NAME}: rooms report incompatible metric kinds (${diagnostic.metricKinds.join(", ")}) and no usable primary entity is configured to arbitrate — no average is computed (see the no-data hint) — configure a consistent device_class/unit_of_measurement across all room entities, or set a primary entity.`
      );
    }

    // Memoized by hass/config identity (HA reassigns hass on every real update, so
    // identity is the right invalidation signal; a render asks many times). The
    // mixed-kind warning is stateful, so it lives here rather than in the pure
    // resolution and fires on a cache MISS only.
    _resolveMetricContext() {
      if (this._metricContextCacheHass === this._hass && this._metricContextCacheConfig === this._config) {
        return this._metricContextCacheValue;
      }
      const value = resolveMeasurementContext(this._hass?.states, this._config);
      const mixed = value.diagnostics.find((diagnostic) => diagnostic.code === 'mixed_metric_kinds');
      // A rehearsal is not a render. Warnings describe what the user is looking at, and
      // during _assertRenderable() they are not looking at this configuration yet — it
      // may never be installed at all.
      if (mixed && !this._rehearsing) this._warnMixedMetricKindsOnce(mixed);
      this._metricContextCacheHass = this._hass;
      this._metricContextCacheConfig = this._config;
      this._metricContextCacheValue = value;
      return value;
    }

    _unit() {
      // Always a real unit string, never null — even in the "mixed_metric_kinds" state,
      // where _resolveMetricContext() falls back via _metricMetaFor()'s temperature
      // default. Kept consistent with _metricType() there.
      return this._resolveMetricContext().unit;
    }

    _metricType() {
      // Card mode, kept consistent with _unit(). null in the "mixed_metric_kinds" state
      // (incompatible room kinds, no primary to arbitrate); the fallback keeps direct
      // callers working with a sensible default.
      return this._resolveMetricContext().metricType || "temperature";
    }

    _fmtWithUnit(value, digits, withSpace = true) {
      const separator = withSpace ? " " : "";
      return `${this._fmt(value, digits)}${separator}${this._unit()}`;
    }

    _roomGridRows(count, columns, rows, autoMaxColumns = 7) {
      return roomGridRows(count, columns, rows, autoMaxColumns);
    }

    // ==== Data computation ====

    // Would this configuration survive being rendered? Some faults (a custom profile in
    // %, a sensor in °C) are only decidable once the entities are in hand, so the model
    // builders throw. To keep setConfig() all-or-nothing, the render is REHEARSED here:
    // the candidate is installed for one synchronous call and removed again (the real
    // path, not a reconstruction), and everything it can write — memoization and one
    // deduplicated warning — is restored. No hass, nothing to rehearse. See interne Doku
    // §5 „setConfig() ist auch für renderzeitige Fehler atomar".
    _assertRenderable(candidate) {
      if (!this._hass) return;
      const saved = {
        config: this._config,
        metricContext: [this._metricContextCacheHass, this._metricContextCacheConfig, this._metricContextCacheValue],
        language: [this._languageCacheHass, this._languageCacheConfigLanguage, this._languageCacheValue],
      };
      this._config = candidate;
      this._rehearsing = true;
      try {
        this._computeViewModel();
      } finally {
        this._rehearsing = false;
        this._config = saved.config;
        [this._metricContextCacheHass, this._metricContextCacheConfig, this._metricContextCacheValue] = saved.metricContext;
        [this._languageCacheHass, this._languageCacheConfigLanguage, this._languageCacheValue] = saved.language;
      }
    }

    // The surface this card is painted on: every colour it sits on (a LIST, since a
    // card-mod gradient is several), plus the theme's text colour, both MEASURED from
    // the browser rather than read off `hass.themes.darkMode` — which describes the
    // theme, not what card-mod or a per-card style put under this card. `hass` is the
    // fallback before paint or in a realm that will not answer; HA's light default is
    // last. Memoized on the readings themselves — a theme switch changes both, which is
    // exactly when the answer must change. Full ladder: interne Doku §5 „Die Leseleiter".
    _surface() {
      const root = this.shadowRoot?.querySelector(".rtc-card") ?? this;
      const samples = this._platform.readBackgroundSamples(root);
      // Asked separately because it answers a separate question: the scale track and a
      // chip background are tints of the text colour, not the card, so a palette step on
      // either is not on the card. Null when the theme will not say; paint-roles.js then
      // falls back to the card rather than inventing one.
      const text = this._platform.readTextColor(root);
      // Nothing readable: the theme flag maps to the canonical background of its surface.
      const resolved = samples.length
        ? samples
        : [this._hass?.themes?.darkMode ? SURFACE_BACKGROUNDS.dark : SURFACE_BACKGROUNDS.light];
      const key = `${resolved.join(",")}|${text || ""}`;
      if (this._surfaceCacheKey !== key) {
        this._surfaceCacheKey = key;
        this._surfaceCacheValue = surfaceOf(resolved, text);
      }
      return this._surfaceCacheValue;
    }

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
        // The surface the palette is about to be painted on.
        surface: this._surface(),
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

    // The only DOM capability the rendering layer gets: this card's document, its
    // window, and the operations derived from them. Built per call (a few property
    // reads) so it cannot go stale if the card is adopted into another document.
    _renderContext() {
      return createRenderContext(this.ownerDocument);
    }

    // ==== Rendering ====
    // Returns which path the render took (see RENDER_PATH), or null when there is
    // nothing to render from yet — returned so tests can assert "patch, not rebuild"
    // without reading private state. The two signatures are computed here because this
    // is the only place both config and hass are in hand.
    _render(allowSkip = true) {
      if (!this._config || !this._hass) return null;
      return this._renderController.render({
        allowSkip,
        dataSignature: entityDataSignature({
          config: this._config,
          states: this._hass.states,
          language: this._language(),
          activeViewIndex: this._activeView,
          // A theme switch changes no entity and no configuration, so without this the
          // card would keep the colours of the background it is no longer on.
          surface: this._surface(),
        }),
        structuralConfigSignature: structuralConfigSignature(this._config),
      });
    }

    _renderAll(viewModel, { isFirstRender = !this._renderController.hasRendered, preConfigVisualKey = undefined } = {}) {
      // Full (re)build on first render, data <-> no-data changes, or a view-composition
      // change. _views/_activeView must be set before _styles() (it derives track/view
      // widths and keyframes from the view list). A structural change preserves the
      // on-screen view, then config.start_view, then the first active view — and freezes
      // on it rather than re-engaging synced auto-slide, so a rebuild does not jump away
      // from a view the user manually parked on. isFirstRender is passed in because the
      // controller flips `rendered` only after this returns. See interne Doku §5
      // „Carousel, Swipe und Accessibility".

      // Preserve a focused source across the replacement where possible. Attribute
      // equality is checked in JS, not interpolated into a selector, so a hostile entity
      // id stays plain data.
      const focusedBefore = this.shadowRoot?.activeElement ?? null;
      const focusedEntity = focusedBefore?.getAttribute?.("data-entity") ?? null;
      const hadCardFocus = Boolean(focusedBefore);

      // The innerHTML replacement destroys what an in-flight gesture is anchored to; the
      // runtime owns that decision, the element only says when.
      this._interaction.abandonGestureForRebuild();

      // Clears both timers unconditionally; the branches below re-arm what the NEW view
      // count warrants. Matters when dropping below two views (a track-less layout, where
      // _applyAutoSlideStyles() bails before it would clear the a11y timer).
      this._stopRotation();

      // Read against the still-mounted previous track/_views, so a structural change
      // mid-auto-slide preserves the view actually on screen, not the stale
      // this._activeView. A live setConfig() captured this before overwriting
      // this._config (old timing) and passes it as preConfigVisualKey; prefer it, else
      // compute live. `undefined` = no snapshot; `null` = a real "no view" snapshot.
      const previousActiveKey = preConfigVisualKey !== undefined
        ? preConfigVisualKey
        : (this._views[this._currentVisualViewIndex()] ?? null);
      this._views = viewModel.views.keys;
      this._viewAreaCollapsed = Boolean(viewModel.views.collapsed);
      let nextIndex = this._views.indexOf(previousActiveKey);
      if (nextIndex === -1) nextIndex = this._views.indexOf(this._config?.start_view);
      // No view is mandatory; index 0 is the final "first active view" fallback.
      this._activeView = nextIndex === -1 ? 0 : nextIndex;

      const context = this._renderContext();
      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>
        <ha-card class="rtc-card">
          ${renderCardBody(context, viewModel, VIEW_RENDERERS)}
        </ha-card>
      `;
      if (hadCardFocus) {
        const matchingSource = focusedEntity
          ? Array.from(this.shadowRoot.querySelectorAll("[data-entity]")).find(
              (node) => node.getAttribute("data-entity") === focusedEntity
            )
          : null;
        if (matchingSource) matchingSource.focus();
        else applyFocusFallback(this.shadowRoot);
      }
      this._bindEvents();
      if (!isFirstRender && !viewModel.empty) {
        // A non-first, non-empty rebuild freezes visually on the just-resolved
        // this._activeView, then schedules the same phase-aware resume as a manual
        // swipe. Applying auto-slide styles here instead would re-engage the synced
        // animation and ignore this._activeView. The first render has no previous view
        // to protect, so it goes straight into synced auto-slide (the else branch).
        this._updateTrackTransform(false);
        // After _updateTrackTransform(): a freshly rebuilt track has no "rtc-manual"
        // class yet, so computing accessibility earlier would treat it as auto-engaged.
        // The else branch does not need this — _applyAutoSlideStyles() schedules it.
        this._scheduleAccessibilitySync();
        this._resumeSynchronizedSlideWhenAligned(this._activeView, 10000);
      } else {
        this._applyAutoSlideStyles();
      }
      this._resolveViewLayouts(viewModel);
      // On a cold reload the measurement above can run before the page web font loads
      // (the card has no @font-face of its own), and fallback metrics look like an
      // overlap until a re-render. The runtime subscribes once per instance and measures
      // from the committed view model at fire time, so a later render is not undone by
      // an older one arriving late.
      if (!viewModel.empty) this._resize.measureOnceFontsReady(() => this.isConnected);
    }

    // Every mounted view re-measures its own labels. The card holds no knowledge of
    // which views have a layout pass — the registry does, and a view that declares no
    // resolveLayout hook is simply skipped.
    _resolveViewLayouts(viewModel) {
      resolveViewLayouts(this._renderContext(), this.shadowRoot, viewModel, VIEW_RENDERERS);
    }

    _updateEmpty(viewModel) {
      // Updates the normal no-data shell without a full DOM rebuild.
      if (!this.shadowRoot) return;
      patchEmptyCardBody(this._renderContext(), this.shadowRoot, viewModel);
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
      // Document-scoped (visibilitychange only fires there): resyncs the accessibility
      // timer when the tab becomes visible again. The platform returns the unsubscribe.
      this._unlistenVisibility = this._platform.onVisibilityChange(this._boundVisibilityChange);
      // Also outside the shadow root: what the card is painted ON is decided by the
      // document around it.
      this._surfaceWatch.observe(this);
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
      this._surfaceWatch.disconnect();
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
