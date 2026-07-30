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

import { CARD_NAME, CARD_TYPE, CARD_VERSION } from "./core/card-metadata.js";
import { rgba } from "./core/color.js";
import {
  ceilToStep,
  clamp,
  floorToStep,
  parseConfigNumber,
  parseNumericState,
  percentInRange,
} from "./core/numbers.js";
import { escapeHtml } from "./core/text.js";
import {
  A11Y_FLIP_TIME_FRACTION,
  SLIDE_EASING_CSS,
  timeFractionForEasedProgress,
} from "./core/easing.js";
import { formatNumber, formatTimeOfDay } from "./i18n/formatters.js";
import { isSupportedLanguage, resolveLanguage, translate } from "./i18n/translate.js";
import { DEFAULT_CONFIG } from "./config/defaults.js";
import { boolOption } from "./config/option-schemas.js";
import { normalizeConfig } from "./config/normalize-config.js";
import { normalizeAction } from "./config/actions.js";
import { decimalsOverride, positiveInteger, positiveSeconds } from "./config/primitives.js";
import { CLASSIFICATION_ZONES } from "./domain/classification/zones.js";
import { readEntityClassification } from "./domain/classification/entity-attributes.js";
import { temperatureIconForProfile } from "./domain/classification/icons.js";
import { scaleConfigFor } from "./domain/scale/scale-config.js";
import { dynamicScale, resolveDynamicStep } from "./domain/scale/dynamic-scale.js";
import { rangePosition, scaleGeometry } from "./domain/scale/geometry.js";
import { METRIC_DEFINITIONS } from "./domain/metrics/definitions.js";
import { METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } from "./domain/metrics/resolution.js";
import { normalizeUnitToken } from "./domain/units/unit-token.js";
// The registry-free primitives. Aliased because domain/metrics/access.js exports
// registry-aware wrappers of the same names, and both are still reachable through
// their own delegations.
import {
  convertUnitValue,
  deriveBandForProfile as deriveBandForProfileFromBand,
  deriveThresholdsForProfile as deriveThresholdsForProfileFromTiers,
} from "./domain/units/conversion.js";
import {
  convertMetricValue,
  deriveBandForProfile,
  deriveThresholdsForProfile,
  getMetricDefinition,
  getUnitProfile,
} from "./domain/metrics/access.js";
import {
  buildEntityModel,
  hasEntity,
  metricKindForEntity,
  rawUnitForEntity,
  readNumericAttribute,
  readNumericState,
  resolveAuxiliaryUnitProfileKey,
} from "./application/model/entity-model.js";
import {
  classificationPolicyOf,
  classifyNumericTier,
  classifyValue,
  isValuePhysicallyValid,
  resolveCanonicalProfile,
  resolveDisplayProfile,
  resolveProfileIcon,
} from "./application/model/classification.js";
import { resolveMeasurementContext } from "./application/model/measurement-context.js";
import { buildTrendModel, resolveTrendPolicy } from "./application/model/auxiliary-models.js";
import { buildCardDomainModel } from "./application/model/card-domain-model.js";
import { autoRoomColumnsFor, metricMetaFor } from "./presentation/view-model/metric-meta.js";
import { roomGridRows } from "./presentation/view-model/room-layout.js";
import {
  VIEW_DEFINITIONS,
  optionSchemaForView,
  resolveActiveViews,
  resolveViewOptions,
} from "./presentation/view-model/view-state.js";
import { buildScaleAxis } from "./presentation/view-model/scale-view-model.js";
import { buildTone, numericTone } from "./presentation/view-model/tone.js";
import { buildCardViewModel, buildTrendText } from "./presentation/view-model/card-view-model.js";
import { toLegacyData } from "./presentation/view-model/legacy-data.js";
import { createRenderContext } from "./render/primitives/render-context.js";
import { computedStyleOf } from "./render/primitives/dom.js";
import { applyFocusFallback, focusFallbackTarget } from "./render/primitives/focus.js";
import { renderMetricCards } from "./render/primitives/metric-card.js";
import { resolveLabelForm } from "./render/layout/label-form.js";
import {
  cardStructureSignature,
  patchCardBody,
  patchEmptyCardBody,
  renderCardBody,
  resolveViewLayouts,
} from "./render/composition/card-shell.js";
import { VIEW_RENDERERS } from "./views/registry.js";
import { buildStyles } from "./styles/index.js";

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
  class RoomClimateCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });

      // _config/_hass come from Home Assistant; everything else drives
      // rendering, slider position, and pointer interaction.
      this._config = null;
      this._hass = null;
      this._activeView = 0;
      // Current view list (keys from VIEW_DEFINITIONS, e.g. "range"/"scale"/
      // "extremes"); populated from the view model's views.keys in
      // _renderAll(), empty before the first render so _hasAutoSlide()/
      // _slideTiming() default safely to "no rotator".
      this._views = [];
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
      this._resumeAutoTimer = null;
      // Timer for _scheduleAccessibilitySync() (A11Y-01) — keeps
      // aria-hidden/inert following the actual CSS-driven visual position
      // during synced auto-slide; cleared in _stopRotation().
      this._a11ySyncTimer = null;
      this._pointer = null;
      this._lastRenderSignature = "";
      this._structuralConfigSignature = null;
      // The last RENDERED markup structure (see cardStructureSignature()). Committed
      // alongside the other two, only after a render path actually succeeded.
      this._structureSignature = null;
      this._eventsBound = false;
      this._suppressClickUntil = 0;
      this._rendered = false;
      this._isDragging = false;
      // Set when a hass update arrives while a swipe is in progress (see
      // _render()); a pending update is applied once the drag ends (see
      // _handlePointerUp()/_handlePointerCancel()) so it's never silently lost.
      this._renderPending = false;
      // Guards document.fonts.ready from being subscribed more than once
      // across repeated full rebuilds (see _renderAll()).
      this._fontsReadyBound = false;
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
      this._resizeObserver = null;
      this._resizeRafId = null;

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
      // A config change (e.g. live-editing in the dashboard editor) can
      // arrive mid-swipe; without this, a stale _pointer (width/
      // startTranslate computed against the about-to-change view count/
      // structure) and a possibly-pending render would carry over into the
      // new config. Clearing them here, before anything else in
      // setConfig() runs, prevents that.
      //
      // Reviewer fix (P1, post-2.27.0): a BESTÄTIGTER swipe (_isDragging)
      // used to be aborted by simply nulling _pointer/_isDragging below,
      // with nothing settling the track afterwards — this comment used to
      // point at a trailing _restartRotation() call in setConfig() for
      // that, but that call was removed in an earlier round (see
      // setConfig()'s own P1 comment) without this cleanup being updated.
      // The track was left permanently frozen in "rtc-manual" at whatever
      // intermediate position the drag had reached, with no resume timer.
      // Settle it first, the same way _handlePointerCancel() already
      // handles an aborted confirmed drag with no reliable final pointer
      // delta to work from: resolve _pointer.startTranslate (the position
      // the track was frozen at when the drag was confirmed, see
      // _pauseTrackAtCurrentPosition()) to its nearest view index, snap the
      // track there, and schedule the same phase-aligned resume a
      // completed swipe gets.
      if (this._isDragging && this._pointer?.rotator) {
        const viewWidthPct = this._viewWidthPct();
        const maxIndex = (this._views?.length || 1) - 1;
        this._activeView = this._clamp(Math.round(-this._pointer.startTranslate / viewWidthPct), 0, maxIndex);
        this._setTrackTransition(true);
        this._updateTrackTransform(true);
        this._scheduleAccessibilitySync();
        this._resumeSynchronizedSlideWhenAligned(this._activeView, 10000);
      }
      this._pointer = null;
      this._isDragging = false;
      this._renderPending = false;
    }

    // Called by Home Assistant when the card is created or reconfigured.
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
      this._stopRotation();
      this._unbindEvents();
      this._unbindResizeObserver();
    }

    _bindResizeObserver() {
      // Re-resolves the optimal-label position on a pure container resize
      // (sidebar toggle, dashboard column reflow, browser resize, device
      // rotation) — previously only a fresh hass update triggered
      // _resolveOptimalLabelPosition(), so the label stayed stale (and could
      // visually overlap) after any resize until the entity's next update.
      // Safe to observe repeatedly because _resolveOptimalLabelPosition() is
      // idempotent (always derives the position fresh from
      // data.optimalCenter, never reads back its own previous pixel output) —
      // the double-interpretation bug that led to removing the observer in
      // 2.11.1 cannot recur here, see readme climate card.md, "Skala".
      // Observes the card root (stable across _renderAll() rebuilds)
      // instead of ".rtc-scale-bar" (recreated on every structural
      // rebuild, which would need re-observing each time).
      if (this._resizeObserver || typeof ResizeObserver === "undefined") return;
      this._resizeObserver = new ResizeObserver(() => {
        // A resize drag fires many callbacks per second; batch to at most
        // one recalculation per animation frame.
        if (this._resizeRafId !== null) return;
        this._resizeRafId = requestAnimationFrame(() => {
          this._resizeRafId = null;
          this._resolveViewLayouts(this._lastViewModel);
        });
      });
      this._resizeObserver.observe(this);
    }

    _unbindResizeObserver() {
      if (this._resizeRafId !== null) {
        cancelAnimationFrame(this._resizeRafId);
        this._resizeRafId = null;
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
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

    // ==== Auto-slide: timing, keyframes, resume alignment ====
    _startRotation() {
      // Auto-rotation runs as a CSS animation with a negative delay derived
      // from wall-clock time, so multiple card instances stay in sync and
      // entity updates never restart it.
      this._applyAutoSlideStyles();
    }

    _stopRotation() {
      if (this._resumeAutoTimer) {
        window.clearTimeout(this._resumeAutoTimer);
        this._resumeAutoTimer = null;
      }
      if (this._a11ySyncTimer) {
        window.clearTimeout(this._a11ySyncTimer);
        this._a11ySyncTimer = null;
      }
    }

    _restartRotation() {
      this._stopRotation();
      this._startRotation();
    }

    _hasAutoSlide() {
      // Whether auto-rotation should run at all — needs at least two views.
      // AP-C1: auto_slide:false disables only this (the timer/synced CSS
      // animation) — independent of swipe, which gates manual dragging in
      // _handlePointerDown() and isn't read here at all.
      const holdSeconds = Number(this._config?.rotation_seconds);
      const slideSeconds = Number(this._config?.slide_seconds);
      return (
        this._config?.auto_slide !== false &&
        Number.isFinite(holdSeconds) &&
        Number.isFinite(slideSeconds) &&
        holdSeconds > 0 &&
        slideSeconds > 0 &&
        (this._views?.length || 0) >= 2 &&
        !this._prefersReducedMotion()
      );
    }

    _prefersReducedMotion() {
      // JS mirrors the CSS media query so reduced-motion users also avoid timers.
      return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    }

    _viewWidthPct() {
      // Width of one view as a percentage of the track's own width (the
      // track itself is views.length*100% wide).
      const count = Math.max(1, (this._views || []).length);
      return 100 / count;
    }

    _holdSequence() {
      // Hold-index sequence for one full auto-slide cycle: a linear
      // ping-pong straight through this._views in its actual
      // left-to-right DOM order — 0,1,...,N-1,N-2,...,1, then wrapping back
      // to 0 — so every transition (including the wrap) moves exactly one
      // position and no view is ever skipped over. Pure function of the
      // view count; doesn't know or care which key sits at which index (see
      // readme climate card.md, "Auto-Slide und Bedienung").
      const n = (this._views || []).length;
      if (n < 2) return [];
      const forward = Array.from({ length: n }, (_, i) => i);
      const backwardInterior = Array.from({ length: Math.max(0, n - 2) }, (_, i) => n - 2 - i);
      return [...forward, ...backwardInterior];
    }

    _slideTiming() {
      // Computes all timing values for the multi-view slider from wall-clock
      // time (so multiple card instances stay in sync); positions is the
      // hold-index sequence from _holdSequence(), each position holds for
      // holdMs with slideMs transitions in between.
      const holdMs = Math.max(0, Number(this._config?.rotation_seconds ?? DEFAULT_CONFIG.rotation_seconds) * 1000);
      const slideMs = Math.max(1, Number(this._config?.slide_seconds ?? DEFAULT_CONFIG.slide_seconds) * 1000);
      const positions = this._holdSequence();
      const enabled = holdMs > 0 && slideMs > 0 && positions.length >= 2;
      const segMs = holdMs + slideMs;
      const cycleMs = Math.max(1, positions.length * segMs);
      const phaseMs = ((Date.now() % cycleMs) + cycleMs) % cycleMs;

      return {
        enabled,
        holdMs,
        slideMs,
        segMs,
        cycleMs,
        phaseMs,
        positions,
        viewWidthPct: this._viewWidthPct(),
      };
    }

    _pct(value) {
      // Formats a CSS percentage compactly so the keyframes stay readable.
      return this._clamp(Number(value) || 0, 0, 100).toFixed(5).replace(/\.?0+$/, "");
    }

    _trackAnimationCss() {
      // Initial CSS for the slider track; a manual swipe later overrides it with inline styles.
      const timing = this._slideTiming();
      if (!timing.enabled) {
        const x = -(this._activeView || 0) * timing.viewWidthPct;
        return `animation:none;transform:translate3d(${x}%,0,0);`;
      }

      // Negative delay synchronizes every instance to the same absolute time cycle.
      return `animation:rtc-track-slide ${timing.cycleMs}ms linear infinite;animation-delay:-${timing.phaseMs}ms;`;
    }

    _slideKeyframes() {
      // Builds keyframes for rotation_seconds/slide_seconds and the current
      // hold sequence: each hold position produces two breakpoints (hold
      // start: linear, hold end: cubic-bezier easing into the next slide);
      // the final 100% breakpoint returns to the first position.
      const timing = this._slideTiming();
      if (!timing.enabled) return "";

      const frames = timing.positions.map((pos, i) => {
        const x = -(pos * timing.viewWidthPct);
        const holdStartPct = ((i * timing.segMs) / timing.cycleMs) * 100;
        const holdEndPct = ((i * timing.segMs + timing.holdMs) / timing.cycleMs) * 100;
        return `
          ${this._pct(holdStartPct)}% {
            transform: translate3d(${x}%,0,0);
            animation-timing-function: linear;
          }
          ${this._pct(holdEndPct)}% {
            transform: translate3d(${x}%,0,0);
            animation-timing-function: ${SLIDE_EASING_CSS};
          }`;
      });
      const closeX = -(timing.positions[0] * timing.viewWidthPct);

      return `
        @keyframes rtc-track-slide {
          ${frames.join("\n")}
          100% {
            transform: translate3d(${closeX}%,0,0);
          }
        }
      `;
    }

    // ==== Auto-slide: JS-side visual-position mirror (A11Y-01) ====
    // The CSS keyframe animation is the only thing that moves the track
    // during synchronized auto-slide (_applyAutoSlideStyles() below) —
    // this._activeView is only ever updated at discrete JS-known moments
    // (initial render, a completed swipe, a pointer-cancel settling back).
    // Anything that needs to know which view is *currently visually front*
    // (accessibility state, "which view was the user just looking at")
    // must derive it from the same wall-clock phase math the CSS keyframes
    // themselves are built from (_slideKeyframes()), not from
    // this._activeView, which goes stale the moment auto-slide starts
    // moving between holds. See readme climate card.md, "Rendering und
    // Robustheit".

    _timeFractionForEasedProgress(easing, targetY) {
      // Thin delegate to the module-level pure function, for direct
      // testability of the bezier-inversion logic in isolation (see
      // accessibility-carousel-timing.test.js) — matches this file's
      // existing convention of exposing pure timing logic exclusively via
      // el._method() for tests, never as a separate global.
      return timeFractionForEasedProgress(easing, targetY);
    }

    _boolOption(defaultValue) {
      // Thin delegate to the module-level pure function, for direct
      // testability of the view-customizer options resolver in isolation
      // (see view-options-resolver.test.js) — same established convention
      // as _timeFractionForEasedProgress() above.
      return boolOption(defaultValue);
    }

    _resolveViewOptions(descriptor, providedOptions) {
      return resolveViewOptions(descriptor, providedOptions);
    }

    _accessibleViewIndexAt(phaseMs, timing) {
      // Mirrors _slideKeyframes()'s hold/transition structure: each
      // segment i spans [i*segMs, (i+1)*segMs) — a holdMs-long stable hold
      // at positions[i], then a slideMs-long transition into
      // positions[(i+1) % n]. AP-08 (audit 17, A11Y-01): the visually
      // "current" view flips where the EASED/spatial progress of that
      // transition crosses 50% (A11Y_FLIP_TIME_FRACTION, ~35.375% of the
      // slide's time for cubic-bezier(.45,0,.16,1) — NOT at 50% of the
      // slide's raw TIME, which is a different point on this curve and was
      // the pre-AP-08 bug: the outgoing view stayed "accessible" for the
      // ~14.6% of the slide's time where the incoming view was already
      // spatially dominant).
      const n = timing.positions.length;
      if (n === 0) return 0;
      const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
      const subPhase = phaseMs - segIndex * timing.segMs;
      const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
      const nextSegIndex = (segIndex + 1) % n;
      return subPhase < flipOffset ? timing.positions[segIndex] : timing.positions[nextSegIndex];
    }

    _msUntilNextAccessibilityFlip(phaseMs, timing) {
      // Time remaining until _accessibleViewIndexAt()'s return value would
      // next change, for scheduling a single precisely-timed timer instead
      // of polling. Must use the exact same flipOffset as
      // _accessibleViewIndexAt() above (AP-08: the spatial-midpoint
      // fraction, not the raw temporal one) or the two would disagree
      // about when the next flip actually happens.
      const n = timing.positions.length;
      if (n === 0) return timing.segMs;
      const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
      const subPhase = phaseMs - segIndex * timing.segMs;
      const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
      if (subPhase < flipOffset) return flipOffset - subPhase;
      return timing.segMs - subPhase + flipOffset;
    }

    _currentVisualViewIndex() {
      // Single shared source for "which view is the user currently looking
      // at" — used both by _updateViewAccessibility() (aria-hidden/inert)
      // and by _renderAll()'s active-view-preservation logic, so the two
      // can never quietly disagree. The track carries "rtc-manual"
      // whenever it's NOT driven by the synced CSS animation (frozen
      // mid-drag, snapped back after a swipe/cancel, or auto-slide
      // disabled — see _updateTrackTransform()/_pauseTrackAtCurrentPosition()/
      // _setTrackTranslate()/_setTrackTransition(), cleared by
      // _applyAutoSlideStyles() below) — in that state this._activeView
      // already IS the visible position.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      const timing = this._slideTiming();
      const autoEngaged = timing.enabled && track && !track.classList.contains("rtc-manual");
      return autoEngaged ? this._accessibleViewIndexAt(timing.phaseMs, timing) : this._activeView;
    }

    _applyAutoSlideStyles() {
      // Switches the track back to the synchronized auto animation, after
      // rendering or once a manual swipe has finished.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      if (!track || this._isDragging || this._pointer) return;

      if (!this._hasAutoSlide()) {
        this._updateTrackTransform(false);
        this._scheduleAccessibilitySync();
        return;
      }

      const timing = this._slideTiming();
      track.classList.remove("rtc-manual");
      track.style.transition = "";
      track.style.transform = "";
      track.style.animation = `rtc-track-slide ${timing.cycleMs}ms linear infinite`;
      track.style.animationDelay = `-${timing.phaseMs}ms`;
      this._scheduleAccessibilitySync();
    }

    _scheduleAccessibilitySync() {
      // Keeps aria-hidden/inert following _currentVisualViewIndex() for as
      // long as the track stays in synced auto-slide mode, via a single
      // precisely-timed timer per flip rather than continuous polling.
      if (this._a11ySyncTimer) {
        window.clearTimeout(this._a11ySyncTimer);
        this._a11ySyncTimer = null;
      }
      this._updateViewAccessibility();
      if (document.hidden) return;
      const track = this.shadowRoot?.querySelector(".rtc-track");
      const timing = this._slideTiming();
      const autoEngaged = timing.enabled && track && !track.classList.contains("rtc-manual");
      if (!autoEngaged) return;
      // Guards against a 0/near-0ms re-arm loop if phaseMs ever lands
      // exactly on (or a floating-point hair past) a flip boundary.
      const MIN_RESCHEDULE_MS = 50;
      const waitMs = Math.max(MIN_RESCHEDULE_MS, this._msUntilNextAccessibilityFlip(timing.phaseMs, timing));
      this._a11ySyncTimer = window.setTimeout(() => {
        this._a11ySyncTimer = null;
        this._scheduleAccessibilitySync();
      }, waitMs);
    }

    _resumeSynchronizedSlide(delayMs = 1800) {
      // After manual interaction, hold briefly then rejoin the synchronized auto-slide.
      this._resumeSynchronizedSlideWhenAligned(this._activeView, delayMs);
    }

    _resumeSynchronizedSlideWhenAligned(targetView, minDelayMs = 10000) {
      // Resume only when the global CSS phase already holds the manual view.
      if (this._resumeAutoTimer) {
        window.clearTimeout(this._resumeAutoTimer);
        this._resumeAutoTimer = null;
      }
      if (!this._hasAutoSlide()) return;

      const view = this._clamp(Math.round(targetView) || 0, 0, (this._views?.length || 1) - 1);
      const delayMs = this._delayUntilAutoPhaseMatchesView(view, minDelayMs);

      this._resumeAutoTimer = window.setTimeout(() => {
        this._resumeAutoTimer = null;
        if (this._isDragging || this._pointer || !this._hasAutoSlide()) return;
        if (!this._autoPhaseMatchesView(view)) {
          this._resumeSynchronizedSlideWhenAligned(view, 0);
          return;
        }
        this._applyAutoSlideStyles();
      }, delayMs);
    }

    _delayUntilAutoPhaseMatchesView(targetView, minDelayMs = 10000) {
      const timing = this._slideTiming();
      const delayMs = Math.max(0, minDelayMs);
      if (!timing.enabled) return delayMs;

      const earliestTs = Date.now() + delayMs;
      return delayMs + this._waitFromTimestampUntilViewHold(targetView, earliestTs, timing);
    }

    _autoPhaseMatchesView(targetView) {
      const timing = this._slideTiming();
      if (!timing.enabled) return false;
      return this._isPhaseInStableViewHold(targetView, timing.phaseMs, timing);
    }

    _waitFromTimestampUntilViewHold(targetView, timestampMs, timing = this._slideTiming()) {
      const phaseMs = this._phaseForTimestamp(timestampMs, timing.cycleMs);
      if (this._isPhaseInStableViewHold(targetView, phaseMs, timing)) return 0;

      // targetView can occur more than once in the hold sequence (e.g. the
      // anchor with more than one other view); pick whichever occurrence is soonest.
      const windows = this._holdWindowsForView(targetView, timing);
      let best = Infinity;
      for (const w of windows) {
        let waitMs = w.start - phaseMs;
        if (waitMs < 0) waitMs += timing.cycleMs;
        if (waitMs < best) best = waitMs;
      }
      return Number.isFinite(best) ? Math.max(0, best) : 0;
    }

    _isPhaseInStableViewHold(targetView, phaseMs, timing = this._slideTiming()) {
      return this._holdWindowsForView(targetView, timing).some(
        (w) => w.end >= w.start && phaseMs >= w.start && phaseMs <= w.end
      );
    }

    _holdWindowsForView(targetView, timing = this._slideTiming()) {
      // Safe resume windows for targetView — one entry per occurrence of
      // targetView in the hold sequence (can be more than one, see _holdSequence()).
      const holdMs = Math.max(0, timing.holdMs);
      const marginMs = Math.min(150, Math.max(0, holdMs / 4));
      const windows = [];
      (timing.positions || []).forEach((pos, i) => {
        if (pos !== targetView) return;
        const start = i * timing.segMs;
        const end = start + holdMs;
        windows.push({
          start: Math.min(start + marginMs, end),
          end: Math.max(start, end - marginMs),
        });
      });
      return windows;
    }

    _phaseForTimestamp(timestampMs, cycleMs) {
      return ((timestampMs % cycleMs) + cycleMs) % cycleMs;
    }

    _hasEntity(entityId) {
      return hasEntity(this._hass?.states, entityId);
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

    _resolveTrendPolicy(metricType) {
      return resolveTrendPolicy(metricType);
    }

    _buildTrendModel(metricType, canonicalValue, displayValue, displayUnit) {
      return buildTrendModel(metricType, canonicalValue, displayValue, displayUnit);
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

    _rawUnitForEntity(entityId) {
      return rawUnitForEntity(this._hass?.states, entityId);
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

    _metricTypeForEntity(entityId) {
      return metricKindForEntity(this._hass?.states, entityId);
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

    _clamp(value, min, max) {
      return clamp(value, min, max);
    }

    _pos(value, min, max) {
      // Converts a value into a percentage position on the scale.
      return percentInRange(value, min, max);
    }

    _rangePosition(minValue, maxValue, scaleMin, scaleMax) {
      return rangePosition(minValue, maxValue, scaleMin, scaleMax);
    }

    _scaleGeometry(comfortMin, comfortMax, optimalMin, optimalMax, scaleMin, scaleMax) {
      return scaleGeometry(comfortMin, comfortMax, optimalMin, optimalMax, scaleMin, scaleMax);
    }

    _roomGridRows(count, columns, rows, autoMaxColumns = 7) {
      return roomGridRows(count, columns, rows, autoMaxColumns);
    }

    _resolveDynamicStep(metricType, unitProfile, staticStep, low, high, baseMin, baseMax, anchorScale = true) {
      // The registry guard stays here: an unregistered metric kind has no unit
      // profile to read span-dependent steps from.
      if (!METRIC_DEFINITIONS[metricType]) return staticStep;
      return resolveDynamicStep(staticStep, unitProfile?.dynamicDisplaySteps, low, high, baseMin, baseMax, anchorScale);
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

    // TEMPORARY compatibility adapter, and by now only that. Nothing on the production
    // render path reads the flat shape any more: the card shell, all four views and
    // every DOM patcher consume the CardViewModel directly, and no module under
    // render/ or views/ may even import legacy-data.js (an architecture test enforces
    // it). This exists so the 32 committed DTO baselines and the element-level
    // assertions written against the flat object keep their meaning while the rendering
    // layer moves out from under them. It goes away together with them in the
    // element/test cleanup round.
    _computeData() {
      return toLegacyData(this._computeViewModel());
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
      // On a cold dashboard reload, this first synchronous measurement can
      // run before the page's web font has actually loaded (the card
      // inherits its font from the page, no @font-face of its own) — the
      // fallback-font metrics produce a slightly wrong position that looks
      // like an overlap until the next real render corrects it. Re-resolve
      // once, exactly once per card instance (not once per full rebuild —
      // _fontsReadyBound guards against registering a fresh .then() on
      // every hasRoomsView/hasRange/hasRangeScale-triggered rebuild before
      // fonts finish loading, which would each close over that call's own
      // view model and could re-apply a stale one after a newer rebuild
      // already ran); a no-op in the common case where fonts were already
      // ready. Uses this._lastViewModel at fire time, not the model closed
      // over here, so it's never stale even if it fires after a later
      // update.
      const fonts = this.ownerDocument.fonts;
      if (!viewModel.empty && fonts?.ready && !this._fontsReadyBound) {
        this._fontsReadyBound = true;
        fonts.ready
          .then(() => {
            if (this.isConnected) this._resolveViewLayouts(this._lastViewModel);
          })
          .catch(() => {});
      }
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

    _maxTrackOffsetPct() {
      // Magnitude of the maximum (negative) track offset — the last view's position.
      const count = Math.max(1, (this._views || []).length);
      return -((count - 1) * this._viewWidthPct());
    }

    _updateTrackTransform(transition = true) {
      // Manually moves the slider to the current _activeView position.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      if (!track) return;
      track.classList.add("rtc-manual");
      track.style.animation = "none";
      track.style.transition = transition ? `transform 420ms ${SLIDE_EASING_CSS}` : "none";
      track.style.transform = `translate3d(${-(this._activeView || 0) * this._viewWidthPct()}%,0,0)`;
    }

    _updateViewAccessibility() {
      // Keeps offscreen carousel views out of the tab order and hidden
      // from assistive tech — every view stays permanently mounted in the
      // DOM (see "Rendering und Robustheit"), so without this a keyboard
      // user could tab into an extreme-value/range card that isn't
      // currently visible. Reflects _currentVisualViewIndex(), which
      // during synced CSS auto-slide tracks the actual wall-clock-driven
      // visible position (A11Y-01) rather than the JS-only this._activeView
      // (which is stale between discrete updates — see
      // _currentVisualViewIndex()). Called directly for a one-off sync, or
      // via _scheduleAccessibilitySync() to keep tracking auto-slide.
      const views = this.shadowRoot?.querySelectorAll(".rtc-view");
      if (!views) return;
      const activeIndex = this._currentVisualViewIndex();
      views.forEach((view, index) => {
        const isActive = index === activeIndex;
        if (isActive) view.removeAttribute("aria-hidden");
        else view.setAttribute("aria-hidden", "true");
        view.toggleAttribute("inert", !isActive);
      });
    }

    _getTrackTranslatePct(track) {
      // Reads the track's current CSS transform position (needed when a swipe starts mid-animation).
      const fallback = -(this._activeView || 0) * this._viewWidthPct();
      if (!track) return fallback;

      try {
        const transform = computedStyleOf(track).transform;
        if (!transform || transform === "none") return fallback;
        const matrix = new DOMMatrixReadOnly(transform);
        const width = track.getBoundingClientRect().width || 1;
        return this._clamp((matrix.m41 / width) * 100, this._maxTrackOffsetPct(), 0);
      } catch (_err) {
        return fallback;
      }
    }

    _pauseTrackAtCurrentPosition(track) {
      // Freezes the auto animation at its current position so a manual swipe doesn't jump.
      const currentTranslate = this._getTrackTranslatePct(track);
      track.classList.add("rtc-manual");
      track.style.animation = "none";
      track.style.transition = "none";
      track.style.transform = `translate3d(${currentTranslate}%,0,0)`;
      return currentTranslate;
    }

    _setTrackTranslate(translate) {
      // Moves the track while dragging.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      if (!track) return;
      track.classList.add("rtc-manual");
      track.style.animation = "none";
      track.style.transform = `translate3d(${this._clamp(translate, this._maxTrackOffsetPct(), 0)}%,0,0)`;
    }

    _setTrackTransition(enable) {
      // Toggles the eased settle transition after a swipe.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      if (!track) return;
      track.classList.add("rtc-manual");
      track.style.animation = "none";
      track.style.transition = enable ? `transform 420ms ${SLIDE_EASING_CSS}` : "none";
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

    _focusFallbackTarget() {
      return focusFallbackTarget(this.shadowRoot);
    }

    _applyFocusFallback() {
      applyFocusFallback(this.shadowRoot);
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
      // Not shadow-root-scoped (visibilitychange only fires on document) —
      // resyncs A11Y-01's accessibility timer when the tab becomes visible
      // again after _scheduleAccessibilitySync() paused it while hidden.
      document.addEventListener("visibilitychange", this._boundVisibilityChange);
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
      document.removeEventListener("visibilitychange", this._boundVisibilityChange);
      this._eventsBound = false;
    }

    _handleVisibilityChange() {
      if (document.hidden || !this._rendered) return;
      this._scheduleAccessibilitySync();
    }

    _findInPath(event, selector) {
      // Finds the closest element matching selector along the event's composed path (shadow-DOM-safe).
      const path = event.composedPath ? event.composedPath() : [];
      return path.find((node) => node?.matches?.(selector)) || null;
    }

    _handleClick(event) {
      // Plain click; a short lock prevents this from double-firing right after pointerup already handled it.
      if (Date.now() < this._suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const entityTarget = this._findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
      event.stopPropagation();
      this._fireHassAction(entityTarget, "tap");
    }

    _handleKeydown(event) {
      // Enter/Space activate a focused button, same as more-info tap.
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      const entityTarget = this._findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
      event.stopPropagation();
      this._fireHassAction(entityTarget, "tap");
    }

    _handlePointerDown(event) {
      // Starts a pointer interaction; deliberately doesn't pause the
      // auto-slide animation yet — a pointerdown in the rotator may just be
      // the start of vertical dashboard scrolling, and pausing here would
      // cause a visible jump on pointercancel. See _handlePointerMove().
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false) return;
      const rotator = this._findInPath(event, ".rtc-rotator");
      const entityTarget = this._findInPath(event, "[data-entity]");
      // AP-C1: swipe:false disables horizontal drag gestures, independent
      // of auto_slide. Every downstream pointer handler already gates on
      // this._pointer.rotator (_handlePointerMove()'s early return,
      // _handlePointerUp()'s confirmed-swipe branch) — folding swipe:false
      // into it here makes a disabled swipe behave exactly like a
      // pointerdown that started outside the rotator (an existing, already-
      // correct code path: no threshold-swipe tracking, no
      // preventDefault()), without touching any of that logic. Tap/hold
      // actions (entityTarget-based) are unaffected, since they don't
      // depend on .rotator at all.
      this._pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
        rotator: Boolean(rotator) && this._config?.swipe !== false,
        entityTarget,
        startTranslate: -(this._activeView || 0) * this._viewWidthPct(),
        dragging: false,
        width: rotator?.getBoundingClientRect().width || 1,
      };
    }

    _handlePointerMove(event) {
      // Horizontal movement in the rotator is treated as a swipe; vertical
      // scrolling stays possible because the animation only pauses once a
      // horizontal swipe is confirmed.
      if (!this._pointer || this._pointer.id !== event.pointerId || !this._pointer.rotator) return;
      const dx = event.clientX - this._pointer.x;
      const dy = event.clientY - this._pointer.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (!this._pointer.dragging) {
        if (absX < 10 || absX <= absY * 1.25) return;
        // A real swipe just started: freeze the synced animation at its
        // current position so the handoff to manual dragging doesn't jump.
        this._pointer.dragging = true;
        this._isDragging = true;
        const track = this.shadowRoot?.querySelector(".rtc-track");
        this._pointer.startTranslate = track
          ? this._pauseTrackAtCurrentPosition(track)
          : -(this._activeView || 0) * this._viewWidthPct();
        if (this._resumeAutoTimer) {
          window.clearTimeout(this._resumeAutoTimer);
          this._resumeAutoTimer = null;
        }
      }
      event.preventDefault();
      event.stopPropagation();
      const viewWidthPct = this._viewWidthPct();
      const offsetPct = this._clamp((dx / this._pointer.width) * viewWidthPct, -viewWidthPct, viewWidthPct);
      this._setTrackTranslate(this._pointer.startTranslate + offsetPct);
    }

    _handlePointerUp(event) {
      // Ends a pointer interaction: either completes a swipe or fires tap/hold.
      if (!this._pointer || this._pointer.id !== event.pointerId) return;

      const dx = event.clientX - this._pointer.x;
      const dy = event.clientY - this._pointer.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const elapsedSeconds = (Date.now() - this._pointer.time) / 1000;
      const entityTarget = this._findInPath(event, "[data-entity]") || this._pointer.entityTarget;

      if (this._pointer.rotator && this._pointer.dragging) {
        event.preventDefault();
        event.stopPropagation();
        const threshold = this._pointer.width * 0.18;
        const viewWidthPct = this._viewWidthPct();
        const maxIndex = (this._views?.length || 1) - 1;
        const projectedTranslate = this._clamp(
          this._pointer.startTranslate + (dx / this._pointer.width) * viewWidthPct,
          this._maxTrackOffsetPct(),
          0
        );
        // A swipe always moves exactly one view; below the threshold, the
        // nearest rounded position wins instead. Both branches derive their
        // starting point from _pointer.startTranslate — the position the
        // track was actually frozen at when the swipe began (see
        // _pauseTrackAtCurrentPosition()) — rather than this._activeView,
        // which only tracks completed swipes/structural resets and can be
        // stale relative to the synced auto-slide animation's current
        // visual position; using it here could skip a view.
        const startView = this._clamp(Math.round(-this._pointer.startTranslate / viewWidthPct), 0, maxIndex);
        let targetView;
        if (dx <= -threshold) targetView = startView + 1;
        else if (dx >= threshold) targetView = startView - 1;
        else targetView = Math.round(-projectedTranslate / viewWidthPct);
        targetView = this._clamp(targetView, 0, maxIndex);
        const changed = targetView !== this._activeView;
        this._activeView = targetView;
        this._isDragging = false;
        this._setTrackTransition(true);
        this._updateTrackTransform(true);
        this._scheduleAccessibilitySync();
        this._resumeSynchronizedSlideWhenAligned(this._activeView, 10000);
        if (changed || this._renderPending) {
          this._renderPending = false;
          this._render(false);
        }
        this._suppressNextClick();
        this._pointer = null;
        return;
      }

      if ((absX > 12 || absY > 12) && entityTarget) {
        this._suppressNextClick();
        this._pointer = null;
        return;
      }

      if (entityTarget) {
        event.preventDefault();
        event.stopPropagation();
        const action = elapsedSeconds >= this._config.hold_seconds ? "hold" : "tap";
        this._fireHassAction(entityTarget, action);
        this._suppressNextClick();
      }

      // Only a real completed swipe (handled above, returns early) or an
      // earlier one still waiting out its resume window ever detaches the
      // track from the synced animation (see _pauseTrackAtCurrentPosition()/
      // .rtc-manual); a plain tap never does, so it must not unconditionally
      // schedule a resume — that would arm a "was paused" state that never
      // actually applied.
      if (this._pointer.rotator) {
        const track = this.shadowRoot?.querySelector(".rtc-track");
        if (track?.classList.contains("rtc-manual")) {
          this._resumeSynchronizedSlide(0);
        }
      }

      this._pointer = null;
    }

    _handlePointerCancel(event) {
      // Browser/dashboard aborted the gesture (e.g. vertical scroll took
      // over); returns the card to a consistent slider state. Also used
      // for pointerleave (see _bindEvents()) — both carry a pointerId, so
      // this only reacts to the pointer it's actually tracking (matches
      // the existing guard in _handlePointerUp()).
      if (!this._pointer || this._pointer.id !== event.pointerId) return;
      const pointer = this._pointer;
      const wasRotator = Boolean(pointer.rotator);
      this._pointer = null;
      if (this._isDragging) {
        // _updateTrackTransform() below snaps to this._activeView, which —
        // unlike after a completed swipe in _handlePointerUp() — was never
        // updated during the drag itself. Derive it here from the position
        // the track was actually frozen at (_pointer.startTranslate, see
        // _pauseTrackAtCurrentPosition()), or the snap-back jumps to
        // wherever _activeView happened to be before this gesture started
        // instead of the visually correct nearby view.
        const viewWidthPct = this._viewWidthPct();
        const maxIndex = Math.max(0, (this._views?.length || 1) - 1);
        this._activeView = this._clamp(Math.round(-pointer.startTranslate / viewWidthPct), 0, maxIndex);
        this._isDragging = false;
        this._updateTrackTransform(true);
        this._scheduleAccessibilitySync();
        this._resumeSynchronizedSlide(1200);
        if (this._renderPending) {
          this._renderPending = false;
          this._render(false);
        }
        return;
      }
      if (!wasRotator) return;
      // No completed swipe, but the track may still be manually frozen from
      // an earlier swipe waiting on its resume window — rejoin phase-aware
      // instead of forcing the animation and causing a visible jump.
      const track = this.shadowRoot?.querySelector(".rtc-track");
      if (track?.classList.contains("rtc-manual")) {
        this._resumeSynchronizedSlide(0);
      }
    }

    _handleContextMenu(event) {
      // Suppresses the browser context menu on long-press, since hold is already a card action.
      const entityTarget = this._findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
    }

    _suppressNextClick() {
      // Prevents a click right after pointerup from firing the same action again.
      this._suppressClickUntil = Date.now() + 450;
    }

    _fireHassAction(target, action) {
      // Hands the user action off to Home Assistant (more-info, navigate, assist, ...).
      if (!target?.dataset?.entity) return;
      const entityId = target.dataset.entity;
      const eventAction = action === "hold" ? "hold" : "tap";
      const actionConfig = this._buildActionConfig(target, entityId);
      const selectedAction = actionConfig[`${eventAction}_action`];

      if (!selectedAction || selectedAction.action === "none") return;

      const event = new Event("hass-action", { bubbles: true, composed: true });
      event.detail = {
        config: actionConfig,
        action: eventAction,
      };
      this.dispatchEvent(event);
    }

    _buildActionConfig(target, entityId) {
      // Builds the action config for exactly the clicked element.
      const roomIndex = target?.dataset?.roomIndex;
      const room = roomIndex !== undefined ? this._config.rooms[Number(roomIndex)] : null;
      const tapAction = this._cloneAction(room?.tap_action || this._config.tap_action, entityId);
      const holdAction = this._cloneAction(room?.hold_action || this._config.hold_action, entityId);

      return {
        entity: entityId,
        tap_action: tapAction,
        hold_action: holdAction,
      };
    }

    _cloneAction(action, entityId) {
      // Clones an action object, filling in the entity for more-info.
      const cloned = { ...(action || { action: "more-info" }) };
      if (cloned.action === "more-info" && !cloned.entity) {
        cloned.entity = entityId;
      }
      return cloned;
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

  // ==== Registration ====
  // Registers the card as a custom element and with Home Assistant's card picker.
  if (!customElements.get(CARD_TYPE)) {
    customElements.define(CARD_TYPE, RoomClimateCard);
  }

  window.customCards = window.customCards || [];
  const existingCard = window.customCards.find((card) => card.type === CARD_TYPE);
  const cardMetadata = {
    type: CARD_TYPE,
    name: CARD_NAME,
    preview: false,
    description: "Standalone climate card (temperature, humidity, CO2, or PM2.5) with an average value, comfort range, optional room extremes/chips, and HA actions.",
    documentationURL: "https://github.com/hyperfelixations/room-climate-card",
  };

  if (existingCard) {
    Object.assign(existingCard, cardMetadata);
  } else {
    window.customCards.push(cardMetadata);
  }

  window.roomClimateCardVersion = CARD_VERSION;
