// The custom element: Home Assistant's lifecycle, the render pipeline, and the
// state transitions between them.
//
// What it does is deliberately narrow, and everything it does NOT do lives one layer
// down:
//
//   config and hass          it owns these, because Home Assistant hands them to it
//   render signatures        when a render is needed at all, and how much of one
//   _renderPending           a render deferred because a gesture is in flight
//   warning deduplication    stateful, so it cannot live in a pure normalizer
//   lifecycle orchestration  connect, disconnect, and what each one starts or stops
//
// The carousel owns the active index and both timers. The interaction runtime owns the
// pointer, the drag flag and the click-suppression deadline. The resize runtime owns
// the observer, the animation frame and the fonts subscription. The element holds
// windows onto those — accessors, never copies — because a second copy of a fact is how
// the two drift apart.
//
// Import direction is enforced by test/unit/architecture-imports.test.js:
//
//   core -> config / i18n / domain -> application/model
//        -> presentation/view-model -> render/primitives + render/layout + styles
//        -> views + render/composition -> controllers/runtime -> this file
//        -> index.js
//
// Nothing below may be imported by a module above it, and Rollup's onwarn (see
// rollup.config.mjs) turns any cycle or unresolved specifier into a build failure.

// Build entry module. Rollup bundles this into the single, dependency-free
// IIFE that Home Assistant loads (dist/room-climate-card.js) — the IIFE
// wrapper and "use strict" prologue that used to be written by hand here are
// now emitted by the build (see rollup.config.mjs), which is why this file
// starts directly with the module body.
//
// dist/room-climate-card.js is generated and committed; never edit it.
// `npm run build` regenerates it, `npm run verify:dist` proves the committed
// copy still matches this source.
//
// This module is the composition root, and it is shrinking. The whole data path is
// now extracted:
//
//   core/                     card identity, numbers, text, colour, easing
//   config/                   the complete YAML normalization
//   i18n/                     languages, registry, formatting, translation
//   domain/                   units and conversion, metric definitions and kind
//                             resolution, classification profiles and services,
//                             scale geometry, trend rules
//   application/model/        EntityModel, MeasurementContext, aggregates,
//                             auxiliary models, the CardDomainModel
//   presentation/view-model/  METRIC_META, tone, room layout, view state, the
//                             per-view content models, the CardViewModel and the
//                             temporary legacy DTO adapter
//   render/primitives/        the RenderContext plus the average, room grid, metric
//                             card, marker, scale bar, empty state and focus fallback
//   render/layout/            long/short label resolution and collision-free label
//                             placement, measured against the real rendered widths
//   render/composition/       the card shell: header, average, view area, chips
//   views/                    one module per view, plus the registry composed from
//                             the view definitions' own order
//   styles/                   the stylesheet
//
// What is still HERE, for the platform/controller/element step that follows:
//   - the carousel timing, the auto-slide keyframes and the accessibility sync
//   - the pointer gestures, the timers, the resize observer and the event wiring
//   - the custom element itself: lifecycle, render scheduling, memoization and
//     the stateful, deduplicated console diagnostics
//   - thin delegations that existing element-level tests still call directly;
//     each forwards to a module and holds no logic of its own
//
// Import direction is enforced by test/unit/architecture-imports.test.js:
//
//   core -> config / i18n / domain -> application/model
//        -> presentation/view-model -> render/primitives + render/layout + styles
//        -> views + render/composition -> controllers/runtime -> element -> this file
//
// Nothing below may be imported by a module above it, and Rollup's onwarn
// (see rollup.config.mjs) turns any cycle or unresolved specifier into a
// build failure.

import { CARD_NAME } from "../core/card-metadata.js";
import { rgba } from "../core/color.js";
import {
  ceilToStep,
  clamp,
  floorToStep,
  parseConfigNumber,
  parseNumericState,
  percentInRange,
} from "../core/numbers.js";
import { escapeHtml } from "../core/text.js";
import {
  A11Y_FLIP_TIME_FRACTION,
  SLIDE_EASING_CSS,
  timeFractionForEasedProgress,
} from "../core/easing.js";
import { formatNumber, formatTimeOfDay } from "../i18n/formatters.js";
import { isSupportedLanguage, resolveLanguage, translate } from "../i18n/translate.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { boolOption } from "../config/option-schemas.js";
import { normalizeConfig } from "../config/normalize-config.js";
import { normalizeAction } from "../config/actions.js";
import { decimalsOverride, positiveInteger, positiveSeconds } from "../config/primitives.js";
import { CLASSIFICATION_ZONES } from "../domain/classification/zones.js";
import { readEntityClassification } from "../domain/classification/entity-attributes.js";
import { temperatureIconForProfile } from "../domain/classification/icons.js";
import { scaleConfigFor } from "../domain/scale/scale-config.js";
import { dynamicScale, resolveDynamicStep } from "../domain/scale/dynamic-scale.js";
import { rangePosition, scaleGeometry } from "../domain/scale/geometry.js";
import { METRIC_DEFINITIONS } from "../domain/metrics/definitions.js";
import { METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } from "../domain/metrics/resolution.js";
import { normalizeUnitToken } from "../domain/units/unit-token.js";
// The registry-free primitives. Aliased because domain/metrics/access.js exports
// registry-aware wrappers of the same names, and both are still reachable through
// their own delegations.
import {
  convertUnitValue,
  deriveBandForProfile as deriveBandForProfileFromBand,
  deriveThresholdsForProfile as deriveThresholdsForProfileFromTiers,
} from "../domain/units/conversion.js";
import {
  convertMetricValue,
  deriveBandForProfile,
  deriveThresholdsForProfile,
  getMetricDefinition,
  getUnitProfile,
} from "../domain/metrics/access.js";
import {
  buildEntityModel,
  hasEntity,
  metricKindForEntity,
  rawUnitForEntity,
  readNumericAttribute,
  readNumericState,
  resolveAuxiliaryUnitProfileKey,
} from "../application/model/entity-model.js";
import {
  classificationPolicyOf,
  classifyNumericTier,
  classifyValue,
  isValuePhysicallyValid,
  resolveCanonicalProfile,
  resolveDisplayProfile,
  resolveProfileIcon,
} from "../application/model/classification.js";
import { resolveMeasurementContext } from "../application/model/measurement-context.js";
import { buildTrendModel, resolveTrendPolicy } from "../application/model/auxiliary-models.js";
import { buildCardDomainModel } from "../application/model/card-domain-model.js";
import { autoRoomColumnsFor, metricMetaFor } from "../presentation/view-model/metric-meta.js";
import { roomGridRows } from "../presentation/view-model/room-layout.js";
import {
  VIEW_DEFINITIONS,
  optionSchemaForView,
  resolveActiveViews,
  resolveViewOptions,
} from "../presentation/view-model/view-state.js";
import { buildScaleAxis } from "../presentation/view-model/scale-view-model.js";
import { buildTone, numericTone } from "../presentation/view-model/tone.js";
import { buildCardViewModel, buildTrendText } from "../presentation/view-model/card-view-model.js";
import { createRenderContext } from "../render/primitives/render-context.js";
import { computedStyleOf } from "../render/primitives/dom.js";
import { applyFocusFallback, focusFallbackTarget } from "../render/primitives/focus.js";
import { renderMetricCards } from "../render/primitives/metric-card.js";
import { resolveLabelForm } from "../render/layout/label-form.js";
import {
  cardStructureSignature,
  patchCardBody,
  patchEmptyCardBody,
  renderCardBody,
  resolveViewLayouts,
} from "../render/composition/card-shell.js";
import { VIEW_RENDERERS } from "../views/registry.js";
import { buildStyles } from "../styles/index.js";
import { createBrowserPlatform } from "../controllers/runtime/browser-platform.js";
import {
  accessibleViewIndexAt,
  formatPercent,
  holdWindowsForView,
  isPhaseInStableViewHold,
  msUntilNextAccessibilityFlip,
  phaseForTimestamp,
  waitFromTimestampUntilViewHold,
} from "../controllers/runtime/carousel-timing.js";
import { createCarouselController } from "../controllers/runtime/carousel-runtime.js";
import { createResizeRuntime } from "../controllers/runtime/resize-runtime.js";
import { createInteractionRuntime } from "../controllers/runtime/interaction-runtime.js";
import { createActionRuntime, cloneAction } from "../controllers/runtime/action-runtime.js";


  // Custom card for Home Assistant room climate data (temperature, humidity,
  // CO2, PM2.5). Public usage documentation lives in this repository's
  // README. Private architecture and audit documentation is maintained
  // separately from the public project.
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
        onMeasure: () => this._resolveViewLayouts(this._lastViewModel),
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
        // The render pipeline stays with the element: _renderPending is a render
        // concern, not a gesture one.
        requestRender: ({ viewChanged }) => {
          if (!viewChanged && !this._renderPending) return;
          this._renderPending = false;
          this._render(false);
        },
      });
      // P1 fix (post-2.22.1): sibling to this._views, since the key list
      // alone can't distinguish a deliberately empty/collapsed view area
      // from one that's requested-but-unavailable — both resolve to an
      // empty list (see views.collapsed in presentation/view-model/
      // view-state.js). Set alongside this._views in _renderAll(), and part
      // of the structure signature _render() compares.
      this._viewAreaCollapsed = false;
      // AP-07: transient snapshot for the setConfig()-triggered old-timing
      // fix — see setConfig()/_renderAll(). undefined outside the narrow
      // window of one _render() cycle immediately following a setConfig()
      // call; _renderAll() falls back to computing live whenever it's
      // undefined (which is the normal, hass-driven-update case).
      this._preConfigChangeVisualKey = undefined;
      this._lastRenderSignature = "";
      this._structuralConfigSignature = null;
      // The last RENDERED markup structure (see cardStructureSignature()). Committed
      // alongside the other two, only after a render path actually succeeded.
      this._structureSignature = null;
      this._eventsBound = false;
      // Returned by the platform when the visibility listener is attached; the only
      // thing that knows how to detach it again.
      this._unlistenVisibility = null;
      this._rendered = false;
      // Set when a hass update arrives while a swipe is in progress (see
      // _render()); a pending update is applied once the drag ends (see
      // _handlePointerUp()/_handlePointerCancel()) so it's never silently lost.
      this._renderPending = false;
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
      // _warnMixedMetricKindsOnce() dedup (AP-02) — see there.
      this._lastMetricContextWarningKey = null;
      // Most recent view model, kept so the resize observer below can re-resolve
      // every mounted view's measured layout without needing a fresh hass update.
      this._lastViewModel = null;

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
    // Read-write where the render path legitimately assigns (the resolved view list,
    // the active index), read-only for the timer handles. None of them stores
    // anything: there is exactly one owner, and these are the window onto it.
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

    get _resumeAutoTimer() {
      return this._carousel.resumeTimerHandle;
    }

    // The interaction runtime's state, same rule: windows, never copies. _pointer and
    // _isDragging are writable because existing tests drive a gesture by constructing
    // the exact pointer shape a real pointerdown would produce.
    get _pointer() {
      return this._interaction.pointer;
    }

    set _pointer(value) {
      this._interaction.pointer = value;
    }

    get _isDragging() {
      return this._interaction.isDragging;
    }

    set _isDragging(value) {
      this._interaction.isDragging = value;
    }

    get _suppressClickUntil() {
      return this._interaction.suppressClickUntil;
    }

    get _a11ySyncTimer() {
      return this._carousel.accessibilityTimerHandle;
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

    _cancelInteractionForConfigChange() {
      // A configuration change can arrive mid-swipe — live editing in the dashboard
      // editor. The gesture itself is the interaction runtime's to abort; the pending
      // render is the element's.
      this._interaction.cancelForConfigChange();
      this._renderPending = false;
    }

    setConfig(config) {
      this._cancelInteractionForConfigChange();
      // AP-07 (audit 14.1): the view visible "before" this call must be
      // read via the OLD this._config/this._views (both still intact right
      // here) — _currentVisualViewIndex() internally reads this._config for
      // its wall-clock phase math, so computing it AFTER the overwrite two
      // lines down would reinterpret the still-on-screen OLD CSS animation
      // with whatever NEW rotation_seconds/slide_seconds this call installs
      // (a live timing change is itself a structural change, see
      // structuralConfigSignature in _render()) — landing in the wrong
      // segment and preserving the wrong view. _renderAll() prefers this
      // snapshot over recomputing live.
      this._preConfigChangeVisualKey = this._views[this._currentVisualViewIndex()] ?? null;
      // P2 fix (reviewer finding, post-AP-07): the cleanup below must run
      // even if _normalizeConfig()/_render() throws (Home Assistant's own
      // config-validation contract requires setConfig() to still propagate
      // that error, so this is finally, not catch) — otherwise a thrown
      // config leaves this._preConfigChangeVisualKey stuck on a stale
      // value, ready to leak into a later, unrelated hass-driven rebuild.
      try {
        this._config = this._normalizeConfig(config);
        this._warnAboutViewConfigOnce();
        // _activeView is intentionally left untouched here — _renderAll()
        // preserves it across a structural change when the previously
        // active view key still exists, falling back to config.start_view
        // then the first active view otherwise (see _renderAll()).
        this._lastRenderSignature = "";
        // P1 fix (reviewer finding, post-AP-07): no trailing
        // _restartRotation() after this — it used to unconditionally
        // re-engage the synced auto-slide animation immediately,
        // undoing the freeze _renderAll() now performs for every
        // non-first-render structural change (see there). _render(false)
        // already handles rotation state completely on its own: via
        // _renderAll() when the change is structural, or not at all when
        // it's a purely cosmetic config edit that must not disturb an
        // in-progress resume wait. connectedCallback() independently
        // starts rotation when the card is first attached to the DOM.
        this._render(false);
      } finally {
        this._preConfigChangeVisualKey = undefined;
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
      // Review fix (P1, post-2.21.1): the dedup key is now updated on EVERY
      // call, including when the current diagnostics list is empty — only
      // the actual console.warn() calls are skipped for an empty list. The
      // previous version returned early on an empty list WITHOUT touching
      // _lastViewConfigWarningKey, so a sequence invalid -> valid -> the
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
      // Card is attached to the dashboard DOM; safe to bind events and start auto-slide.
      this._bindEvents();
      this._startRotation();
      this._bindResizeObserver();
    }

    disconnectedCallback() {
      // Card is removed/rebuilt by Home Assistant; clean up timers and listeners.
      this._carousel.destroy();
      this._unbindEvents();
      this._unbindResizeObserver();
    }

    _bindResizeObserver() {
      // Re-measures the labels on a pure container resize (sidebar toggle, dashboard
      // column reflow, browser resize, device rotation). Safe to observe repeatedly
      // because the layout pass is idempotent — it always derives the position fresh
      // from the view model and never reads back its own previous pixel output, so the
      // double-interpretation bug that led to removing the observer in 2.11.1 cannot
      // recur. Observes the card host, which survives every structural rebuild.
      this._resize.connect(this);
    }

    _unbindResizeObserver() {
      this._resize.disconnect();
    }

    getCardSize() {
      // Rough size hint for the legacy masonry view (config-based, not live
      // data, so it uses the configured room count as an upper-bound proxy
      // for "will show room chips" — a room without live data yet still
      // gets counted here, unlike the live-data-driven capacity cap in
      // roomGridRows()). Extra chip rows add to the
      // base size one-for-one.
      const roomCount = this._config?.rooms?.length ?? 0;
      // AP-C2: show_rooms:false never renders the chip grid, so its rows
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
      // Thin delegation: the whole normalization lives in config/, as pure
      // functions without `this`. What stays here is only the wiring — the
      // registries the configuration layer is not allowed to import are passed
      // in from this composition root.
      return normalizeConfig(config, CONFIG_COLLABORATORS);
    }

    // Delegations kept for the existing config-validation tests, which exercise
    // these value-level rules through the element. They are migration
    // scaffolding, not an API: config/primitives.js and config/actions.js are
    // the real implementations and are now tested directly. Each one disappears
    // once its element-level test moves to the module.
    _parseConfigNumber(value) {
      return parseConfigNumber(value);
    }

    _normalizeDecimalsOverride(value) {
      return decimalsOverride(value);
    }

    _normalizePositiveInteger(value) {
      return positiveInteger(value);
    }

    _normalizePositiveSeconds(value, fallback, min, max) {
      return positiveSeconds(value, fallback, min, max);
    }

    _normalizeAction(value, fallback) {
      return normalizeAction(value, fallback);
    }

    // ==== Classification: delegations, not a second implementation ====
    // Every method below forwards to application/model/classification.js, which owns
    // the policy resolution, the projection into the display unit, the entity/auto/
    // profile/custom priority and the lazy numeric branch. What is added here is only
    // the two things the module cannot know: which policy this card was configured
    // with, and which entity's attributes to read. Existing element-level tests call
    // these directly; the mathematics behind them exists exactly once.
    _classificationPolicy() {
      return classificationPolicyOf(this._config);
    }

    _resolveClassificationProfile(metricType, { lenient = false } = {}) {
      return resolveCanonicalProfile(this._classificationPolicy(), metricType, { lenient });
    }

    _classificationProfileForDisplay(metricType, unitProfile) {
      return resolveDisplayProfile(this._classificationPolicy(), metricType, unitProfile);
    }

    _getEntityClassification(entityId, { allowPartial = false } = {}) {
      // Resolves the entity's attributes here, where hass lives; the validation
      // itself is pure (see domain/classification/entity-attributes.js).
      if (!entityId || !this._hass?.states?.[entityId]) return null;
      return readEntityClassification(this._hass.states[entityId].attributes, { allowPartial });
    }

    _resolveValueClassification(value, entityId, metricType, unitProfile) {
      return classifyValue(this._classificationPolicy(), metricType, unitProfile, value, this._attributesOf(entityId));
    }

    _attributesOf(entityId) {
      return entityId ? this._hass?.states?.[entityId]?.attributes ?? null : null;
    }

    _temperatureIconForProfile(temp, unitProfile) {
      return temperatureIconForProfile(temp, this._classificationProfileForDisplay('temperature', unitProfile));
    }

    _profileIconForValue(value, metricType, unitProfile) {
      // A metric kind without icon tiers keeps its stable presentation icon, so
      // adding another kind never forces a semantically dubious icon family.
      return resolveProfileIcon(this._classificationPolicy(), metricType, unitProfile, value) || metricMetaFor(metricType).icon;
    }

    // ==== Auto-slide, track and accessibility: delegations to the controller ====
    // Everything below forwards to this._carousel, which owns the active index, both
    // timers and every read of the wall clock. The methods stay on the element because
    // a large number of tests call them directly; not one of them holds state of its
    // own, and the two timer accessors expose the controller's actual handles rather
    // than a second copy.
    _startRotation() {
      this._carousel.start();
    }

    _stopRotation() {
      this._carousel.stop();
    }

    _restartRotation() {
      this._carousel.restart();
    }

    _hasAutoSlide() {
      return this._carousel.hasAutoSlide();
    }

    _viewWidthPct() {
      return this._carousel.viewWidthPct();
    }

    _holdSequence() {
      return this._carousel.holdSequence();
    }

    _slideTiming() {
      return this._carousel.timing();
    }

    _trackAnimationCss() {
      return this._carousel.trackAnimationCss();
    }

    _slideKeyframes() {
      return this._carousel.slideKeyframes();
    }

    _timeFractionForEasedProgress(easing, targetY) {
      // Thin delegate to the module-level pure function, for direct testability of the
      // bezier inversion in isolation (see accessibility-carousel-timing.test.js).
      return timeFractionForEasedProgress(easing, targetY);
    }

    _boolOption(defaultValue) {
      return boolOption(defaultValue);
    }

    _resolveViewOptions(descriptor, providedOptions) {
      return resolveViewOptions(descriptor, providedOptions);
    }

    _accessibleViewIndexAt(phaseMs, timing) {
      return accessibleViewIndexAt(phaseMs, timing);
    }

    _msUntilNextAccessibilityFlip(phaseMs, timing) {
      return msUntilNextAccessibilityFlip(phaseMs, timing);
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

    _waitFromTimestampUntilViewHold(targetView, timestampMs, timing = this._slideTiming()) {
      return waitFromTimestampUntilViewHold(targetView, timestampMs, timing);
    }

    _isPhaseInStableViewHold(targetView, phaseMs, timing = this._slideTiming()) {
      return isPhaseInStableViewHold(targetView, phaseMs, timing);
    }

    _holdWindowsForView(targetView, timing = this._slideTiming()) {
      return holdWindowsForView(targetView, timing);
    }

    _phaseForTimestamp(timestampMs, cycleMs) {
      return phaseForTimestamp(timestampMs, cycleMs);
    }

    _maxTrackOffsetPct() {
      return this._carousel.maxTrackOffsetPct();
    }

    _updateTrackTransform(transition = true) {
      this._carousel.updateTrackTransform(transition);
    }

    _updateViewAccessibility() {
      this._carousel.updateViewAccessibility();
    }

    _getTrackTranslatePct(track) {
      return this._carousel.trackTranslatePct(track);
    }

    _parseNum(raw) {
      // Shared numeric parser for _getNum()/_getAttrNum() — see
      // parseNumericState() in core/numbers.js for the parsing rules.
      return parseNumericState(raw);
    }

    _getNum(entityId) {
      return readNumericState(this._hass?.states, entityId);
    }

    _getAttrNum(entityId, attrName) {
      return readNumericAttribute(this._hass?.states, entityId, attrName);
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

    _scaleConfigFor(metricType, unitProfile) {
      return scaleConfigFor(this._classificationProfileForDisplay(metricType, unitProfile));
    }

    _floorToStep(value, step) {
      return floorToStep(value, step);
    }

    _ceilToStep(value, step) {
      return ceilToStep(value, step);
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

    _resolveUnitProfileKey(metricKind, rawUnit) {
      // See resolveUnitProfileKey() in domain/metrics/resolution.js.
      return resolveUnitProfileKey(metricKind, rawUnit);
    }

    _resolveAuxiliaryUnitProfile(entityId, metricKind, { rateSuffix = false } = {}) {
      return resolveAuxiliaryUnitProfileKey(this._hass?.states, entityId, metricKind, { rateSuffix });
    }

    _buildEntityModel(entityId, sourceRole) {
      return buildEntityModel(this._hass?.states, this._config, entityId, sourceRole);
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
      // null), even when metricType itself is null (AP-02's
      // "mixed_metric_kinds" configuration state) — _resolveMetricContext()
      // resolves canonicalUnit/unit via _metricMetaFor()'s own
      // temperature-default fallback in that case.
      return this._resolveMetricContext().unit;
    }

    _metricType() {
      // Card mode — see _resolveMetricContext() for how it's kept
      // consistent with _unit(). Can be null when AP-02's
      // _resolveMetricContext() finds rooms reporting genuinely
      // incompatible metric kinds with no usable primary to arbitrate
      // ("mixed_metric_kinds") — this safety fallback keeps every existing
      // direct caller (icon/title lookups via _metricMetaFor(), etc.)
      // working with a sensible default instead of suddenly receiving null.
      return this._resolveMetricContext().metricType || "temperature";
    }

    // ==== MetricDefinition / UnitProfile / QuantityKind (AP-01) ====
    // Thin, testable instance-method wrappers around the module-scope
    // METRIC_DEFINITIONS registry and its pure helper functions above — the
    // same pattern this class already uses for other pure logic
    // (_isPhysicallyValid(), _floorToStep()/_ceilToStep()). _convertMetricValue()
    // and _getUnitProfile() are called from _buildEntityModel() (AP-02, see
    // below _resolveMetricContext()) for every metric kind. Temperature has
    // real Celsius/Fahrenheit/Kelvin conversion; the other profiles use
    // identity conversion.

    _getMetricDefinition(metricKind) {
      return getMetricDefinition(metricKind);
    }

    _getUnitProfile(metricKind, profileKey) {
      return getUnitProfile(metricKind, profileKey);
    }

    // Raw primitives: operate directly on profile/tier/band objects, with
    // no registry lookup — this is what makes them reusable for a metric
    // kind that isn't registered in METRIC_DEFINITIONS yet (see the
    // registry's "Extension point" comment).
    _convertUnitValue(value, quantityKind, fromProfile, toProfile) {
      return convertUnitValue(value, quantityKind, fromProfile, toProfile);
    }

    _deriveThresholdsForProfileFromTiers(canonicalTiers, profile) {
      return deriveThresholdsForProfileFromTiers(canonicalTiers, profile);
    }

    _deriveBandForProfileFromBand(band, profile) {
      return deriveBandForProfileFromBand(band, profile);
    }

    _convertMetricValue(value, options) {
      return convertMetricValue(value, options);
    }

    _deriveThresholdsForProfile(metricKind, profileKey) {
      return deriveThresholdsForProfile(metricKind, profileKey);
    }

    _deriveBandForProfile(metricKind, profileKey, bandName) {
      return deriveBandForProfile(metricKind, profileKey, bandName);
    }

    _fmtWithUnit(value, digits, withSpace = true) {
      // Combines the formatted number and its unit.
      const separator = withSpace ? " " : "";
      return `${this._fmt(value, digits)}${separator}${this._unit()}`;
    }

    _esc(value) {
      // HTML-escapes a value before it enters a template string (entity names, room labels).
      return escapeHtml(value);
    }

    _pos(value, min, max) {
      // Converts a value into a percentage position on the scale.
      return percentInRange(value, min, max);
    }

    _roomGridRows(count, columns, rows, autoMaxColumns = 7) {
      return roomGridRows(count, columns, rows, autoMaxColumns);
    }

    _dynamicScale(coolestValue, warmestValue, metricType, unitProfile) {
      // Keeps the registry guard of _resolveDynamicStep() in the loop by passing
      // the dynamic steps only for a registered metric kind.
      const dynamicDisplaySteps = METRIC_DEFINITIONS[metricType] ? unitProfile?.dynamicDisplaySteps : undefined;
      return dynamicScale(coolestValue, warmestValue, this._scaleConfigFor(metricType, unitProfile), dynamicDisplaySteps);
    }

    _buildScaleModel({ metricType, unitProfile, comfortMin, comfortMax, optimalMin, optimalMax, low, high, markers }) {
      return buildScaleAxis({
        scaleConfig: this._scaleConfigFor(metricType, unitProfile),
        displayUnitProfile: METRIC_DEFINITIONS[metricType] ? unitProfile : undefined,
        comfort: { min: comfortMin, max: comfortMax },
        optimal: { min: optimalMin, max: optimalMax },
        low,
        high,
        markers,
        formatBoundary: (value) => this._fmtWithUnit(value, 0, false),
      });
    }

    _avgTone(value, entityId, metricType, unitProfile) {
      return buildTone({
        classification: this._resolveValueClassification(value, entityId, metricType, unitProfile),
        icon: this._config.icon || this._profileIconForValue(value, metricType, unitProfile),
        texts: this._texts(),
      });
    }

    _classificationTableFor(metricType, unitProfile) {
      return this._classificationProfileForDisplay(metricType, unitProfile);
    }

    _classifyNumericValue(value, metricType, unitProfile) {
      return numericTone(classifyNumericTier(this._classificationPolicy(), metricType, unitProfile, value), this._texts());
    }

    _fallbackTone(value, metricType, unitProfile) {
      const classification = this._classifyNumericValue(value, metricType, unitProfile);
      return { ...classification, label: classification.level };
    }

    _isPhysicallyValid(value, metricType, unitProfile = null, { lenient = false } = {}) {
      return isValuePhysicallyValid(this._classificationPolicy(), metricType, unitProfile, value, { lenient });
    }

    _fallbackTemperatureIcon(temp, unitProfile) {
      return this._temperatureIconForProfile(temp, unitProfile);
    }

    _roomTone(value, entityId, metricType, unitProfile) {
      return this._resolveValueClassification(value, entityId, metricType, unitProfile).color;
    }

    _rgba(color, alpha) {
      // Semi-transparent variant of a tone/marker color — see rgba() in
      // core/color.js for the accepted input shapes.
      return rgba(color, alpha);
    }

    // ==== Data computation ====
    // The production entry point. Everything fachlich lives in application/model
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
    _render(allowSkip = true) {
      if (!this._config || !this._hass) return;
      // A hass update arriving mid-swipe can't be rendered without jumping
      // the track; remember it and catch up once the drag ends (see
      // _handlePointerUp()/_handlePointerCancel()) instead of silently
      // losing it until some later, unrelated update happens to arrive.
      if (this._isDragging) {
        this._renderPending = true;
        return;
      }

      const relevantEntities = [
        this._config.entity,
        this._config.range_entity,
        this._config.trend_entity,
        ...this._config.rooms.map((room) => room.entity),
      ].filter(Boolean);
      const relevantStates = relevantEntities
        .map((entity) => {
          const stateObj = this._hass.states?.[entity];
          // last_updated (not last_changed) also catches attribute-only changes.
          return `${entity}:${stateObj?.state ?? ""}:${stateObj?.last_updated ?? ""}`;
        })
        .join("|");
      const signature = [
        relevantStates,
        `lang:${this._language()}`,
        `rotation:${this._config.rotation_seconds}`,
        `slide:${this._config.slide_seconds}`,
        `view:${this._activeView}`,
      ].join("|");
      // The fast path, deliberately BEFORE any model or view-model work: an
      // unchanged signature means an unchanged card, and computing a view model
      // only to throw it away would make every no-op hass push cost a full
      // pipeline run.
      if (allowSkip && signature === this._lastRenderSignature) return;

      const viewModel = this._computeViewModel();
      const currentlyEmpty = Boolean(this.shadowRoot.querySelector(".rtc-empty"));
      // What the MARKUP would look like, as one comparable value: the chip grid, the
      // ordered view keys, the collapsed-vs-hint null-view state, and whatever each
      // view declares about its own optional nodes (see cardStructureSignature()).
      // A change here cannot be expressed by patching, so it forces a full rebuild.
      //
      // This replaced a hand-maintained list of booleans. That list was correct for
      // everything on it and silently wrong for everything else: with show_rooms:false
      // the chip grid is absent either way, so a second room becoming valid changed
      // nothing on the list — while the scale view's footer and its two extrema
      // markers genuinely had to appear. Composing the signature from the renderers
      // themselves means a new view, or a new optional element in an existing view,
      // extends its own signature and this method never learns about it.
      const structureSignature = cardStructureSignature(viewModel, VIEW_RENDERERS);
      const structureChanged = structureSignature !== this._structureSignature;

      // hide_footer/rotation_seconds/slide_seconds don't show up in the
      // views list, but a partial update can't add/remove the footer
      // markup, and the auto-slide @keyframes percentage breakpoints
      // (baked into <style> at full-render time, see _slideKeyframes())
      // depend on rotation_seconds/slide_seconds too — so a config-only
      // change to any of them (e.g. live-editing in the dashboard editor)
      // also needs a full rebuild, not just the inline animation-duration
      // update _applyAutoSlideStyles() already does.
      //
      // auto_slide (P1 review fix, post-AP-C1): _applyAutoSlideStyles()/
      // _stopRotation()/_startRotation() are only ever invoked from
      // _renderAll()'s structural path below — _updateContent() never
      // touches the timer/CSS animation at all. Without auto_slide here, a
      // live setConfig() that toggles ONLY auto_slide would leave the
      // running/stopped animation exactly as it was until some other,
      // unrelated structural change happened to force a rebuild.
      //
      // this._config.views (Teil 2, view-customizer Baukasten): the active
      // VIEW KEYS list is already covered by viewsChanged above, but a
      // views:[i].options change alone (e.g. show_comfort_band toggling)
      // doesn't touch that list at all — the partial patch path can't
      // add/remove the comfort/optimal band <div>s (patchScaleBar() only
      // patches elements that already exist), so any options change must
      // force a full rebuild too. Generic and future-proof: covers every
      // current and future structural view option, not just the band
      // toggles.
      const structuralConfigSignature = `${this._config.hide_footer}|${this._config.rotation_seconds}|${this._config.slide_seconds}|${this._config.auto_slide}|${JSON.stringify(this._config.views)}`;
      const structuralConfigChanged = structuralConfigSignature !== this._structuralConfigSignature;

      // All three signatures are committed only after a render path actually
      // succeeds (set hass()'s try/catch means a thrown _computeViewModel()/
      // _renderAll()/_updateContent()/_updateEmpty() skips the assignment
      // below entirely) — committing upfront would suppress a correct
      // retry of the exact same, currently-failing update, since the next
      // identical hass push would compute the same signature and be
      // silently skipped as "unchanged".
      const commit = () => {
        this._lastRenderSignature = signature;
        this._structuralConfigSignature = structuralConfigSignature;
        this._structureSignature = structureSignature;
      };

      if (
        !this._rendered ||
        viewModel.empty !== currentlyEmpty ||
        (!viewModel.empty && (structureChanged || structuralConfigChanged))
      ) {
        this._renderAll(viewModel);
        commit();
        return;
      }

      if (viewModel.empty) {
        this._updateEmpty(viewModel);
        commit();
        return;
      }

      this._updateContent(viewModel);
      commit();
    }

    _renderAll(viewModel) {
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
      // point of the phase-aware resume — see readme climate card.md,
      // "Auto-Slide und Bedienung".
      // P1 fix (reviewer finding, post-AP-07): must be read before
      // this._rendered is set true a few lines down (see there).
      const isFirstRender = !this._rendered;
      this._lastViewModel = viewModel;

      // AP-07 (audit 14.2): an in-flight-but-not-yet-classified pointer
      // gesture (this._pointer set, this._isDragging still false — the
      // user has only just touched down, never crossed the swipe
      // threshold) references DOM nodes/geometry (_pointer.width/
      // startTranslate/entityTarget) that are about to be destroyed by the
      // innerHTML replacement below. _render() already defers the whole
      // rebuild via _renderPending while a CONFIRMED drag (_isDragging) is
      // in progress, so by the time _renderAll() runs, _isDragging is
      // always false — but a bare pointerdown has no such guard, and the
      // pointer listeners live on the shadow root itself (survive the
      // innerHTML replacement, see _bindEvents()). Left alone, a later
      // pointermove/up on this same gesture would compute a swipe from
      // stale geometry (wrong target view), and _applyAutoSlideStyles()
      // below would bail out entirely (its own `|| this._pointer` guard),
      // silently skipping the accessibility resync for this render. Nulling
      // it here makes the gesture a safe no-op instead (the existing
      // !this._pointer guards in _handlePointerMove()/_handlePointerUp()/
      // _handlePointerCancel() already handle "no pointer" cleanly).
      this._pointer = null;

      // AP-07 (audit 14.2, Bug C): dropping to <2 active views renders a
      // track-less solo/empty layout (no ".rtc-track" at all — see
      // renderCardBody()'s view-area branch). _applyAutoSlideStyles()
      // bails out on its very first line when there's no track, so it
      // never reaches _scheduleAccessibilitySync() — the only place that
      // otherwise clears this._a11ySyncTimer. Without this, a timer armed
      // while >=2 views were active would linger (harmless once it
      // eventually fires and self-corrects, but violates "Timer nur ab
      // zwei aktiven Views" until then). _stopRotation() clears both
      // timers unconditionally; the branches below re-arm exactly what's
      // actually warranted for the NEW view count — for every other
      // transition this is a harmless no-op, since
      // _scheduleAccessibilitySync()/_resumeSynchronizedSlideWhenAligned()
      // already clear-before-set themselves.
      this._stopRotation();

      // AP-07 (audit 14.1): _currentVisualViewIndex() (shared with
      // _updateViewAccessibility(), see there) is read against the
      // still-mounted PREVIOUS render's track/this._views, before either is
      // replaced below — so a structural change mid-auto-slide preserves
      // whichever view was actually on screen, not the stale
      // this._activeView. A live setConfig() change already captured this
      // BEFORE overwriting this._config (see there) — using the OLD timing
      // definition, never the new one — and stashed it on
      // this._preConfigChangeVisualKey; prefer that snapshot when present,
      // otherwise (the ordinary hass-driven-update case, where this._config
      // never changed) compute it live exactly as before.
      const previousActiveKey = this._preConfigChangeVisualKey !== undefined
        ? this._preConfigChangeVisualKey
        : (this._views[this._currentVisualViewIndex()] ?? null);
      this._views = viewModel.empty ? [] : viewModel.views.keys;
      this._viewAreaCollapsed = viewModel.empty ? false : Boolean(viewModel.views.collapsed);
      let nextIndex = this._views.indexOf(previousActiveKey);
      if (nextIndex === -1) nextIndex = this._views.indexOf(this._config?.start_view);
      // AP-04: the "mandatory scale" fallback is gone along with mandatory
      // itself — nextIndex === -1 ? 0 : nextIndex already IS "the first
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
      this._rendered = true;
      if (!isFirstRender && !viewModel.empty) {
        // P1 fix (reviewer finding, post-AP-07): previousActiveKey above is
        // correctly preserved, but that alone is only a JS bookkeeping
        // value — _applyAutoSlideStyles() (the old unconditional else
        // branch) re-engages the wall-clock-driven SYNCED animation
        // immediately, which ignores this._activeView entirely and can show
        // any view depending on the current phase. That silently defeated
        // the whole point of preserving previousActiveKey/start_view/the
        // first-active-view fallback for every EXCEPT the one case that
        // happened to already have a resume timer pending. Every non-first,
        // non-empty rebuild now freezes visually on the just-resolved
        // this._activeView first, then schedules the same phase-aware
        // resume the manual-swipe path already used — "keine Sprünge"
        // (audit 14.2) now actually holds for the DOM/CSS, not just for the
        // this._activeView bookkeeping. The very first render is
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
      // runtime subscribes exactly once per card instance and measures from
      // this._lastViewModel at fire time, so a later render cannot be undone by an
      // older one arriving late.
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
      this._lastViewModel = viewModel;
      patchEmptyCardBody(this.shadowRoot, viewModel);
    }

    _updateContent(viewModel) {
      // Fast partial update on new HA values: only text, markers, colors,
      // and dynamic subsections change, so the slider animation never restarts.
      const root = this.shadowRoot;
      if (!root) return;
      this._lastViewModel = viewModel;
      patchCardBody(this._renderContext(), root, viewModel, VIEW_RENDERERS);
    }

    // ==== Compatibility delegations for element-level tests ====
    // Production never calls anything below. A large number of tests were written
    // against the pre-extraction method names on the element, and rewriting all of them
    // in the same round as extracting the renderers would have made a refactoring
    // mistake indistinguishable from an intended change. Each of these forwards to the
    // rendering layer and holds no logic of its own; they are removed together with the
    // flat DTO in the element/test cleanup round.

    _renderViewMarkup(key) {
      const viewModel = this._computeViewModel();
      if (!viewModel.views.byKey[key]) {
        throw new Error(`${CARD_NAME}: view "${key}" is not active for this configuration`);
      }
      return VIEW_RENDERERS.find((view) => view.key === key).render(this._renderContext(), viewModel);
    }

    _renderScaleView() {
      return this._renderViewMarkup("scale");
    }

    _renderRangeScaleView() {
      return this._renderViewMarkup("range_scale");
    }

    _renderRangeCards() {
      return renderMetricCards(this._computeViewModel().views.byKey.range.cards);
    }

    _renderExtremeCards() {
      return renderMetricCards(this._computeViewModel().views.byKey.extremes.cards);
    }

    _scaleFooterText() {
      return this._computeViewModel().views.byKey.scale.footerText;
    }

    _rangeScaleFooterText() {
      return this._computeViewModel().views.byKey.range_scale.footerText;
    }

    _trendDisplayText(trend) {
      return buildTrendText(trend, this._texts());
    }

    _resolveLabelForm(element, longText, shortText, fitsWithWidth) {
      return resolveLabelForm(element, longText, shortText, fitsWithWidth);
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
      if (this._platform.isDocumentHidden() || !this._rendered) return;
      this._scheduleAccessibilitySync();
    }

    _findInPath(event, selector) {
      // Finds the closest element matching selector along the event's composed path (shadow-DOM-safe).
      const path = event.composedPath ? event.composedPath() : [];
      return path.find((node) => node?.matches?.(selector)) || null;
    }

    // ==== Interaction and actions: delegations to their controllers ====
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
