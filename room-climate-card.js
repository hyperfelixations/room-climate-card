(() => {
  "use strict";

  // Custom card for Home Assistant room climate data (temperature, humidity,
  // CO2, PM2.5). Public usage documentation lives in this repository's
  // README. Private architecture and audit documentation is maintained
  // separately from the public project.
  //
  // One card-wide classification policy resolves complete HA attributes,
  // built-in profiles, or a validated custom YAML profile. A profile owns
  // tiers, score/zone metadata, bands, scale policy, and profile icons together.

  // ==== Constants: card metadata, metric mode, language ====
  const CARD_TYPE = "room-climate-card";
  const CARD_NAME = "Room Climate Card";
  const CARD_VERSION = "2.35.0-english-zones-fridge-profile";

  // Matches a room-chip label that is exactly two Unicode uppercase letters
  // (e.g. "WZ", "KÜ") — the only case where a room's short code is
  // guaranteed to never shrink/ellipsize (see validRooms/shortGuaranteed in
  // _computeData() and .rtc-room-short[data-short-guaranteed] below).
  const TWO_UPPER_LETTER_RE = /^\p{Lu}\p{Lu}$/u;

  // Card defaults. Mode-dependent title/unit/icon/decimals are not here —
  // presentation metadata lives in METRIC_META, while every semantic
  // classification/scale decision lives in CLASSIFICATION_PROFILE_REGISTRY.
  // No default entities: entity is the only required config field, rooms
  // is optional (minimal mode), see _normalizeConfig().
  const DEFAULT_CONFIG = {
    rotation_seconds: 14, // hold time per view
    slide_seconds: 1, // transition time between views
    hold_seconds: 0.5,
    tap_action: { action: "more-info" },
    hold_action: { action: "more-info" },
    auto_slide: true, // AP-C1: automatic rotation between views
    swipe: true, // AP-C1: manual horizontal drag gesture, independent of auto_slide
  };

  // HA state values that never represent a usable measurement.
  const INVALID_STATES = new Set(["", "unknown", "unavailable", "none", "null", "undefined"]);

  // Accepted shape for the value_color HA attribute; anything else is
  // rejected in _getEntityClassification() before it can reach a CSS/HTML
  // context (a public card must not trust arbitrary integration attributes).
  const HEX_COLOR_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

  // Known Home Assistant action types accepted for tap_action/hold_action.
  // Config comes from the dashboard owner (same trust model as any other
  // card's tap_action), but the action name is still checked against this
  // list in _normalizeAction() since it ends up in a dispatched
  // hass-action event — an unknown/missing value falls back safely instead
  // of being passed through raw.
  const ACTION_ALLOWLIST = new Set(["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"]);

  // Unit strings arrive from integrations and template sensors, so
  // semantically identical spellings can differ at the Unicode/text level
  // (notably PM2.5: micro sign `µ` vs. Greek mu `μ`, superscript `³` vs.
  // plain `3`, and optional `^`/whitespace). Normalize only representation;
  // the resulting token must still match an explicitly registered profile.
  // This preserves the strict "unknown unit is unusable" safety boundary.
  function normalizeUnitToken(unit) {
    if (typeof unit !== "string") return "";
    return unit
      .trim()
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[µμ]/g, "u")
      .replace(/\^3\b/g, "3");
  }

  // Maps an entity's device_class to a card mode. Primary source for
  // _metricTypeForEntity(); values match Home Assistant's SensorDeviceClass enum.
  const METRIC_TYPE_BY_DEVICE_CLASS = {
    temperature: "temperature",
    humidity: "humidity",
    carbon_dioxide: "co2",
    pm25: "pm25",
  };

  // Fallback source for _metricType() when device_class is missing/unknown.
  // Review fix (post-AP-01..03): this used to be a separate, hand-maintained
  // literal here — now derived atomically from METRIC_DEFINITIONS further
  // below (declared right after METRIC_DEFINITIONS, since it depends on it)
  // so there is exactly one place that says "which unit strings belong to
  // which metric kind". See the derivation site for the full rationale.

  // Display metadata per detected card mode: title key (see TRANSLATIONS),
  // icon (normal/empty state), unit fallback (only used when the entity has
  // no unit_of_measurement), default decimal places for _fmt(), the
  // translation keys for the coldest/warmest-equivalent room labels and the
  // above/below-comfort subtitle adjective (see _extremeRoomLabel()), and
  // autoRoomColumns (the metric-specific max chips per row used by
  // _roomGridRows() in fully automatic mode — see _autoRoomColumnsFor()).
  // This registry intentionally contains presentation metadata only. Comfort,
  // optimal and base-scale bands belong to CLASSIFICATION_PROFILE_REGISTRY
  // and are selected atomically by _resolveClassificationProfile().
  const METRIC_META = {
    temperature: {
      titleKey: "title.temperature",
      icon: "mdi:thermometer",
      emptyIcon: "mdi:thermometer-off",
      unitFallback: "°C",
      decimals: 1,
      lowRoomKey: "card.coldestRoom",
      highRoomKey: "card.warmestRoom",
      aboveAdjectiveKey: "adjective.warm",
      belowAdjectiveKey: "adjective.cool",
      autoRoomColumns: 7,
    },
    humidity: {
      titleKey: "title.humidity",
      icon: "mdi:water-percent",
      emptyIcon: "mdi:water-off",
      unitFallback: "%",
      decimals: 1,
      lowRoomKey: "card.driestRoom",
      highRoomKey: "card.mostHumidRoom",
      aboveAdjectiveKey: "adjective.humid",
      belowAdjectiveKey: "adjective.dry",
      autoRoomColumns: 7,
    },
    co2: {
      titleKey: "title.co2",
      icon: "mdi:molecule-co2",
      emptyIcon: "mdi:molecule-co2",
      unitFallback: "ppm",
      decimals: 0,
      lowRoomKey: "card.lowestRoom",
      highRoomKey: "card.highestRoom",
      aboveAdjectiveKey: "adjective.elevated",
      belowAdjectiveKey: "adjective.low",
      autoRoomColumns: 5,
    },
    pm25: {
      titleKey: "title.pm25",
      icon: "mdi:molecule",
      emptyIcon: "mdi:molecule",
      unitFallback: "µg/m³",
      decimals: 1,
      lowRoomKey: "card.lowestRoom",
      highRoomKey: "card.highestRoom",
      aboveAdjectiveKey: "adjective.elevated",
      belowAdjectiveKey: "adjective.low",
      autoRoomColumns: 5,
    },
  };

  // Trend direction is a semantic classification of a RATE, independent
  // from its display unit. Policies therefore live in each metric's
  // canonical unit (°C/h, percentage points/h, ppm/h, µg/m³/h). Keeping
  // lower and upper limits separate deliberately permits future asymmetric
  // YAML or entity-attribute overrides without changing the classifier or
  // renderer. Values exactly on either boundary remain stable.
  const TREND_POLICY_REGISTRY = Object.freeze({
    temperature: Object.freeze({ fallingBelow: -0.1, risingAbove: 0.1 }),
    humidity: Object.freeze({ fallingBelow: -0.5, risingAbove: 0.5 }),
    co2: Object.freeze({ fallingBelow: -25, risingAbove: 25 }),
    pm25: Object.freeze({ fallingBelow: -0.5, risingAbove: 0.5 }),
  });

  const TREND_DIRECTION_META = Object.freeze({
    rising: Object.freeze({ translationKey: "trend.direction.rising" }),
    stable: Object.freeze({ translationKey: "trend.direction.stable" }),
    falling: Object.freeze({ translationKey: "trend.direction.falling" }),
  });

  function classifyTrendRate(canonicalValue, policy) {
    if (!Number.isFinite(canonicalValue) || !policy) return null;
    // Unit conversion can turn an exact boundary into an adjacent floating-
    // point representation (0.18°F/h -> 0.1°C/h). Absorb only machine-scale
    // noise; a materially outside value must still change direction.
    const epsilon = Number.EPSILON * Math.max(1, Math.abs(canonicalValue), Math.abs(policy.fallingBelow), Math.abs(policy.risingAbove)) * 8;
    if (canonicalValue < policy.fallingBelow - epsilon) return "falling";
    if (canonicalValue > policy.risingAbove + epsilon) return "rising";
    return "stable";
  }

  // The closed set of tier/invalid-classification zone values. Single
  // source of truth for both the built-in profiles below and custom-profile
  // validation (_normalizeCustomClassification()) — anything that needs to
  // know "which zone values exist" reads this instead of repeating the list.
  const CLASSIFICATION_ZONES = Object.freeze(["optimal", "comfort", "outside", "invalid"]);

  // One classification profile owns every semantic decision that must stay
  // coherent: tiers, score/zone metadata, comfort/optimal bands, scale policy,
  // physical validity, and profile icon thresholds. Unit conversion is
  // deliberately separate in METRIC_DEFINITIONS (UnitProfile).
  const CLASSIFICATION_PROFILE_REGISTRY = {
    temperature: {
      defaultProfile: "indoor",
      profiles: {
        indoor: {
          id: "indoor",
          metricKind: "temperature",
          comparison: ">=",
          tiers: [
            { min: 28, score: 11, levelKey: "level.veryHot", color: "#B85F67", zone: "outside" },
            { min: 26, score: 10, levelKey: "level.hot", color: "#C67277", zone: "outside" },
            { min: 25, score: 9, levelKey: "level.veryWarm", color: "#C98A67", zone: "outside" },
            { min: 24, score: 8, levelKey: "level.warm", color: "#C0A752", zone: "outside" },
            { min: 23, score: 7, levelKey: "level.slightlyWarm", color: "#9DA85A", zone: "comfort" },
            { min: 21, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
            { min: 20, score: 5, levelKey: "level.slightlyCool", color: "#69A78B", zone: "comfort" },
            { min: 19, score: 4, levelKey: "level.fresh", color: "#67A7AE", zone: "outside" },
            { min: 18, score: 3, levelKey: "level.cool", color: "#76A0C0", zone: "outside" },
            { min: 16, score: 2, levelKey: "level.cold", color: "#8192C8", zone: "outside" },
            { min: -Infinity, score: 1, levelKey: "level.veryCold", color: "#8A88C9", zone: "outside" },
          ],
          comfort: { min: 20, max: 24 },
          optimal: { min: 21, max: 23 },
          scale: { min: 19, max: 25 },
          step: 1,
          iconThresholds: { fire: 28, high: 26, normal: 20, low: 18 },
        },
        outdoor: {
          id: "outdoor",
          metricKind: "temperature",
          comparison: ">=",
          tiers: [
            { min: 35, score: 11, levelKey: "level.veryHot", color: "#B85F67", zone: "outside" },
            { min: 30, score: 10, levelKey: "level.hot", color: "#C67277", zone: "outside" },
            { min: 28, score: 9, levelKey: "level.veryWarm", color: "#C98A67", zone: "outside" },
            { min: 26, score: 8, levelKey: "level.warm", color: "#C0A752", zone: "outside" },
            { min: 22, score: 7, levelKey: "level.slightlyWarm", color: "#9DA85A", zone: "comfort" },
            { min: 18, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
            { min: 14, score: 5, levelKey: "level.slightlyCool", color: "#69A78B", zone: "comfort" },
            { min: 10, score: 4, levelKey: "level.fresh", color: "#67A7AE", zone: "outside" },
            { min: 5, score: 3, levelKey: "level.cool", color: "#76A0C0", zone: "outside" },
            { min: 0, score: 2, levelKey: "level.cold", color: "#8192C8", zone: "outside" },
            { min: -Infinity, score: 1, levelKey: "level.veryCold", color: "#8A88C9", zone: "outside" },
          ],
          comfort: { min: 14, max: 26 },
          optimal: { min: 18, max: 22 },
          scale: { min: 10, max: 30 },
          step: 1,
          // Outdoor readings are seasonal. Keep the reference scale as
          // classification metadata, but do not force it into the rendered
          // axis: _dynamicScale() derives both edges from the live values
          // plus its normal one-step headroom.
          anchorScale: false,
          iconThresholds: { fire: 35, high: 30, normal: 14, low: 5 },
        },
        // Appliance profile, not a room: target band follows common food-
        // safety guidance (e.g. FDA/EU "at or below 5 C", ideal ~3-4 C) —
        // the internationally cited "danger zone" for holding food starts
        // at 8 C, so the tiers widen that headroom on the warm side, the
        // direction that actually risks spoilage. anchorScale stays at its
        // default (true, unlike outdoor): a fridge's normal operating band
        // is narrow and well-defined by the compressor's own cycling, so a
        // fixed reference axis is more useful here than one that floats
        // with every door-open spike.
        fridge: {
          id: "fridge",
          metricKind: "temperature",
          comparison: ">=",
          tiers: [
            { min: 12, score: 11, levelKey: "level.veryHot", color: "#B85F67", zone: "outside" },
            { min: 10, score: 10, levelKey: "level.hot", color: "#C67277", zone: "outside" },
            { min: 8, score: 9, levelKey: "level.veryWarm", color: "#C98A67", zone: "outside" },
            { min: 6, score: 8, levelKey: "level.warm", color: "#C0A752", zone: "outside" },
            { min: 5, score: 7, levelKey: "level.slightlyWarm", color: "#9DA85A", zone: "comfort" },
            { min: 3, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
            { min: 1, score: 5, levelKey: "level.slightlyCool", color: "#69A78B", zone: "comfort" },
            { min: 0, score: 4, levelKey: "level.fresh", color: "#67A7AE", zone: "outside" },
            { min: -2, score: 3, levelKey: "level.cool", color: "#76A0C0", zone: "outside" },
            { min: -4, score: 2, levelKey: "level.cold", color: "#8192C8", zone: "outside" },
            { min: -Infinity, score: 1, levelKey: "level.veryCold", color: "#8A88C9", zone: "outside" },
          ],
          comfort: { min: 1, max: 6 },
          optimal: { min: 3, max: 5 },
          scale: { min: 0, max: 8 },
          step: 1,
          iconThresholds: { fire: 12, high: 10, normal: 1, low: -2 },
        },
      },
    },
    humidity: {
      defaultProfile: "indoor",
      profiles: {
        indoor: {
          id: "indoor",
          metricKind: "humidity",
          comparison: ">=",
          invalidWhen: (value) => value < 0 || value > 100,
          invalidClassification: { score: 1, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
          tiers: [
            { min: 75, score: 11, levelKey: "level.criticallyHumid", color: "#B85F67", zone: "outside" },
            { min: 70, score: 10, levelKey: "level.tooHumid", color: "#C67277", zone: "outside" },
            { min: 65, score: 9, levelKey: "level.veryHumid", color: "#C98A67", zone: "outside" },
            { min: 60, score: 8, levelKey: "level.humid", color: "#C0A752", zone: "outside" },
            { min: 58, score: 7, levelKey: "level.slightlyHumid", color: "#9DA85A", zone: "comfort" },
            { min: 42, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
            { min: 40, score: 5, levelKey: "level.slightlyDry", color: "#69A78B", zone: "comfort" },
            { min: 35, score: 4, levelKey: "level.dry", color: "#67A7AE", zone: "outside" },
            { min: 30, score: 3, levelKey: "level.veryDry", color: "#76A0C0", zone: "outside" },
            { min: 25, score: 2, levelKey: "level.tooDry", color: "#8192C8", zone: "outside" },
            { min: -Infinity, score: 1, levelKey: "level.criticallyDry", color: "#8A88C9", zone: "outside" },
          ],
          comfort: { min: 40, max: 60 },
          optimal: { min: 42, max: 58 },
          scale: { min: 35, max: 65 },
          step: 5,
          iconTiers: [
            { min: 75, icon: "mdi:water-percent-alert" },
            { min: 60, icon: "mdi:water-plus" },
            { min: 40, icon: "mdi:water-percent" },
            { min: -Infinity, icon: "mdi:water-minus" },
          ],
        },
      },
    },
    co2: {
      defaultProfile: "indoor",
      profiles: {
        indoor: {
          id: "indoor",
          metricKind: "co2",
          comparison: ">=",
          invalidWhen: (value) => value <= 0,
          invalidClassification: { score: 1, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
          tiers: [
            { min: 2000, score: 11, levelKey: "level.critical", color: "#B85F67", zone: "outside" },
            { min: 1600, score: 10, levelKey: "level.veryHigh", color: "#C67277", zone: "outside" },
            { min: 1200, score: 9, levelKey: "level.high", color: "#C98A67", zone: "outside" },
            { min: 1000, score: 8, levelKey: "level.elevated", color: "#C0A752", zone: "outside" },
            { min: 800, score: 7, levelKey: "level.slightlyElevated", color: "#9DA85A", zone: "comfort" },
            { min: -Infinity, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
          ],
          comfort: { min: 0, max: 1000 },
          optimal: { min: 0, max: 800 },
          scale: { min: 0, max: 1200 },
          step: 200,
          oneSided: true,
          headroom: 100,
          iconTiers: [
            { min: 2000, icon: "mdi:alert-circle-outline" },
            { min: -Infinity, icon: "mdi:molecule-co2" },
          ],
        },
      },
    },
    pm25: {
      defaultProfile: "indoor",
      profiles: {
        indoor: {
          id: "indoor",
          metricKind: "pm25",
          comparison: ">",
          invalidWhen: (value) => value < 0,
          invalidClassification: { score: 1, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
          tiers: [
            { min: 50, score: 11, levelKey: "level.critical", color: "#B85F67", zone: "outside" },
            { min: 35, score: 10, levelKey: "level.veryHigh", color: "#C67277", zone: "outside" },
            { min: 25, score: 9, levelKey: "level.high", color: "#C98A67", zone: "outside" },
            { min: 15, score: 8, levelKey: "level.elevated", color: "#C0A752", zone: "outside" },
            { min: 5, score: 7, levelKey: "level.slightlyElevated", color: "#9DA85A", zone: "comfort" },
            { min: -Infinity, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
          ],
          comfort: { min: 0, max: 15 },
          optimal: { min: 0, max: 5 },
          scale: { min: 0, max: 20 },
          step: 5,
          oneSided: true,
          iconTiers: [
            { min: 50, icon: "mdi:alert-circle-outline" },
            { min: 25, icon: "mdi:weather-dust" },
            { min: 5, icon: "mdi:weather-hazy" },
            { min: -Infinity, icon: "mdi:molecule" },
          ],
        },
      },
    },
  };

  // ==== MetricDefinition / UnitProfile / QuantityKind registry (AP-01) ====
  // AP-01 began this generic, extensible foundation for measurement kinds.
  // It is now live for all four supported metrics: temperature provides
  // Celsius/Fahrenheit/Kelvin profiles, while humidity/co2/pm25 each use an
  // identity UnitProfile so unit validation and conversion follow the same
  // atomic path everywhere. _resolveMetricContext() canonicalizes values;
  // classification profiles are projected back into the resolved display
  // profile before classification, scale, or icon decisions.
  //
  // A "quantityKind" distinguishes three fundamentally different numeric
  // semantics that must never share a conversion path:
  //   absolute — an actual reading (e.g. today's temperature): converts via
  //              toCanonical()/fromCanonical(), which DOES apply the
  //              Fahrenheit offset (0 °C = 32 °F).
  //   delta    — a difference between two readings (e.g. daily spread,
  //              room-to-room spread): converts via deltaToCanonical()/
  //              deltaFromCanonical(), which must NEVER apply an offset
  //              (a 0 °C difference is a 0 °F difference, not 32 °F).
  //   rate     — a delta per unit time (e.g. a trend in °C/h): uses the
  //              exact same value-conversion factor as delta — only the
  //              time unit differs, and this module does not touch time
  //              units at all, so "rate" and "delta" share one code path.
  //
  // Celsius stays the canonical temperature unit. The indoor profile's
  // tiers and bands are referenced directly below from
  // CLASSIFICATION_PROFILE_REGISTRY rather than copied into a second table.
  const METRIC_DEFINITIONS = {
    temperature: {
      metricKind: "temperature",
      canonicalUnit: METRIC_META.temperature.unitFallback, // "°C"
      // Which unitProfiles key IS the canonical unit — lets AP-02's
      // measurement pipeline look this up generically instead of
      // hard-coding the string "celsius" at every call site.
      canonicalProfileKey: "celsius",
      canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.tiers,
      canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.comfort,
      canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.optimal,
      canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.scale,
      unitProfiles: {
        celsius: {
          key: "celsius",
          units: ["°c", "c", "celsius"],
          displayUnit: "°C",
          toCanonical: (v) => v,
          fromCanonical: (v) => v,
          deltaToCanonical: (v) => v,
          deltaFromCanonical: (v) => v,
          baseDisplayStep: 1,
          // No thresholdRounding: derivation is a pure identity for the
          // canonical unit itself (verified in tests).
        },
        fahrenheit: {
          key: "fahrenheit",
          units: ["°f", "f", "fahrenheit"],
          displayUnit: "°F",
          toCanonical: (v) => ((v - 32) * 5) / 9,
          fromCanonical: (v) => (v * 9) / 5 + 32,
          deltaToCanonical: (v) => (v * 5) / 9,
          deltaFromCanonical: (v) => (v * 9) / 5,
          baseDisplayStep: 2,
          // Product rule (audit 9.3): Fahrenheit classification/comfort/
          // optimal/base-scale boundaries are always whole numbers, so a
          // displayed boundary and the boundary actually used for
          // classification never disagree.
          thresholdRounding: (v) => Math.round(v),
          // AP-03 (audit 9.6): the dynamic scale's rounding step depends on
          // how wide the actually-displayed span is — a narrow span rounds
          // to a fine 2°F step, a wide one to a coarse 10°F step, so the
          // axis never ends up with an absurdly fine or coarse grid.
          // Celsius/Kelvin omit this field entirely and keep the fixed
          // baseDisplayStep (1) — "Für Celsius und Kelvin bleibt der
          // Basisschritt 1" (audit 9.6).
          dynamicDisplaySteps: [
            { maxSpan: 20, step: 2 },
            { maxSpan: 40, step: 5 },
            { maxSpan: Infinity, step: 10 },
          ],
        },
        kelvin: {
          key: "kelvin",
          units: ["k", "kelvin"],
          displayUnit: "K",
          toCanonical: (v) => v - 273.15,
          fromCanonical: (v) => v + 273.15,
          // Kelvin and Celsius differ by a pure offset (no scale factor),
          // so a delta/rate is numerically identical in both units.
          deltaToCanonical: (v) => v,
          deltaFromCanonical: (v) => v,
          baseDisplayStep: 1,
        },
      },
    },
    // Review fix (post-AP-01..03): humidity/co2/pm25 each get a trivial,
    // single-entry "identity" UnitProfile instead of having no
    // MetricDefinition at all. Reason: _buildEntityModel() previously had no
    // way to tell "this reading's unit doesn't even match its own kind" for
    // these three modes (no registry to check against), only for
    // temperature — so a stray unit on e.g. a co2 entity was NEVER caught.
    // Giving every kind exactly one MetricDefinition entry (celsius-style
    // "one profile, canonicalProfileKey points to it") lets
    // _buildEntityModel()/_resolveUnitProfileKey() apply the exact same
    // atomic "resolve metric kind and UnitProfile from the SAME registry, no
    // canonical fallback for an unresolvable unit" policy uniformly to all
    // four kinds. Since each has only one profile whose key always equals
    // canonicalProfileKey, every existing "does the resolved profile differ
    // from canonical?" short-circuit (_scaleConfigFor(), etc.) still always
    // takes the "no" branch for these three — zero behavior change to
    // classification/scale/display, purely additive validation.
    humidity: {
      metricKind: "humidity",
      canonicalUnit: METRIC_META.humidity.unitFallback, // "%"
      canonicalProfileKey: "percent",
      canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.tiers,
      canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.comfort,
      canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.optimal,
      canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.scale,
      unitProfiles: {
        percent: {
          key: "percent",
          units: ["%"],
          displayUnit: "%",
          toCanonical: (v) => v,
          fromCanonical: (v) => v,
          deltaToCanonical: (v) => v,
          deltaFromCanonical: (v) => v,
          baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.step,
        },
      },
    },
    co2: {
      metricKind: "co2",
      canonicalUnit: METRIC_META.co2.unitFallback, // "ppm"
      canonicalProfileKey: "ppm",
      canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.tiers,
      canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.comfort,
      canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.optimal,
      canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.scale,
      unitProfiles: {
        ppm: {
          key: "ppm",
          units: ["ppm"],
          displayUnit: "ppm",
          toCanonical: (v) => v,
          fromCanonical: (v) => v,
          deltaToCanonical: (v) => v,
          deltaFromCanonical: (v) => v,
          baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.step,
        },
      },
    },
    pm25: {
      metricKind: "pm25",
      canonicalUnit: METRIC_META.pm25.unitFallback, // "µg/m³"
      canonicalProfileKey: "microgram_per_m3",
      canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.tiers,
      canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.comfort,
      canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.optimal,
      canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.scale,
      unitProfiles: {
        microgram_per_m3: {
          key: "microgram_per_m3",
          units: ["µg/m³"],
          displayUnit: "µg/m³",
          toCanonical: (v) => v,
          fromCanonical: (v) => v,
          deltaToCanonical: (v) => v,
          deltaFromCanonical: (v) => v,
          baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.step,
        },
      },
    },
    // Extension point (audit section 10.1): a future kind is added here as
    // its own key, e.g.:
    //   absolute_humidity: {
    //     metricKind: "absolute_humidity",
    //     canonicalUnit: "g/m³",
    //     canonicalClassificationTiers: [...],       // once defined
    //     canonicalComfortBand: {...}, canonicalOptimalBand: {...}, canonicalBaseScaleBand: {...},
    //     unitProfiles: { gram_per_m3: {...}, milligram_per_m3: {...} },
    //   }
    // The conversion/derivation functions below never branch on a specific
    // metricKind — see metric-definitions.test.js's "extension point" case,
    // which exercises them against a synthetic profile that is never
    // registered here at all.
  };

  // Review fix (post-AP-01..03): atomically DERIVED from METRIC_DEFINITIONS
  // instead of a separately hand-maintained table — the two had drifted
  // (word/bare-letter aliases like "c"/"celsius"/"f"/"fahrenheit" were
  // registered in unitProfiles.units but missing here, so an entity with
  // one of those units and no device_class could not be recognized as
  // temperature at all). One registered unit string can only ever belong to
  // one metric kind, so a plain last-write-wins merge is safe.
  const METRIC_TYPE_BY_UNIT = Object.fromEntries(
    Object.values(METRIC_DEFINITIONS).flatMap((definition) =>
      Object.values(definition.unitProfiles).flatMap((profile) =>
        profile.units.map((unit) => [normalizeUnitToken(unit), definition.metricKind])
      )
    )
  );

  function convertUnitValue(value, quantityKind, fromProfile, toProfile) {
    if (quantityKind === "absolute") {
      return toProfile.fromCanonical(fromProfile.toCanonical(value));
    }
    if (quantityKind === "delta" || quantityKind === "rate") {
      return toProfile.deltaFromCanonical(fromProfile.deltaToCanonical(value));
    }
    throw new Error(`convertUnitValue: unknown quantityKind "${quantityKind}"`);
  }

  function deriveThresholdsForProfile(canonicalTiers, profile) {
    // Re-expresses a canonical-unit tier list (levelKey/color unchanged) in
    // profile's display unit; -Infinity/+Infinity survive unchanged (both
    // Math.round(±Infinity) and a linear fromCanonical() naturally return
    // ±Infinity, no special-casing needed).
    const round = profile.thresholdRounding || ((v) => v);
    return canonicalTiers.map((tier) => ({
      ...tier,
      min: Number.isFinite(tier.min) ? round(profile.fromCanonical(tier.min)) : tier.min,
    }));
  }

  function deriveBandForProfile(band, profile) {
    const round = profile.thresholdRounding || ((v) => v);
    return { min: round(profile.fromCanonical(band.min)), max: round(profile.fromCanonical(band.max)) };
  }

  // Language: base language code (e.g. "de" from "de-AT") -> translations.
  // Values are either a string or a function (vars) => string, for
  // pluralization/conditionals without a full ICU parser. See _t()/_language().
  // English is the canonical/primary language (card default, HACS audience,
  // and the fallback _t() uses for any key missing in another language, see
  // _t()); German, Dutch, French, Italian, Spanish, Russian, Polish,
  // Korean, Japanese, and Chinese are fully supported additional languages.
  //
  // Adding a new language (including community contributions):
  //   1. Add its base code to NUMBER_LOCALE_BY_LANGUAGE below, mapped to an
  //      Intl-compatible locale (used for number/time formatting).
  //   2. Copy the full "en" block under TRANSLATIONS, rename the key to the
  //      new base code, and translate every value — including the function
  //      values (they interpolate variables and handle simple
  //      singular/plural branching; keep the same variable names). For
  //      languages with more than two plural categories, use
  //      getPluralCategory()/selectPlural() rather than hand-written
  //      one-vs-other rules.
  //   3. Reload the card once — a module-load-time self-check
  //      (see below TRANSLATIONS) logs a console.warn() listing any key
  //      that's missing or extra compared to "en", so incomplete
  //      translations are caught immediately instead of silently falling
  //      back at runtime.
  // No other code changes are needed: _language() and _t() already read
  // TRANSLATIONS generically by key.
  const DEFAULT_LANGUAGE = "en";
  const NUMBER_LOCALE_BY_LANGUAGE = {
    de: "de-DE",
    en: "en-US",
    nl: "nl-NL",
    fr: "fr-FR",
    it: "it-IT",
    es: "es",
    ru: "ru",
    pl: "pl",
    ko: "ko",
    ja: "ja",
    zh: "zh",
  };

  // Escape map for _esc(); hoisted so the replace() callback doesn't
  // allocate a fresh object per matched character.
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  // Number.prototype.toLocaleString()/Date.prototype.toLocaleTimeString()
  // each construct a fresh Intl.NumberFormat/Intl.DateTimeFormat internally
  // on every call; a card with several rooms formats a dozen-plus numbers
  // per render, so _fmt()/_formatTime() instead reuse one cached formatter
  // per locale/digits combination (built once, formats many times).
  const NUMBER_FORMAT_CACHE = new Map();
  const TIME_FORMAT_CACHE = new Map();
  const PLURAL_RULES_CACHE = new Map();

  function getNumberFormat(locale, digits) {
    const key = `${locale}|${digits}`;
    let fmt = NUMBER_FORMAT_CACHE.get(key);
    if (!fmt) {
      fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
      NUMBER_FORMAT_CACHE.set(key, fmt);
    }
    return fmt;
  }

  function getTimeFormat(locale) {
    let fmt = TIME_FORMAT_CACHE.get(locale);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
      TIME_FORMAT_CACHE.set(locale, fmt);
    }
    return fmt;
  }

  function getPluralCategory(language, count) {
    let rules = PLURAL_RULES_CACHE.get(language);
    if (!rules) {
      rules = new Intl.PluralRules(NUMBER_LOCALE_BY_LANGUAGE[language] || language);
      PLURAL_RULES_CACHE.set(language, rules);
    }
    return rules.select(Number(count));
  }

  function selectPlural(language, count, forms) {
    return forms[getPluralCategory(language, count)] ?? forms.other;
  }

  const TRANSLATIONS = {
    en: {
      "title.temperature": "Temperature",
      "title.humidity": "Humidity",
      "title.co2": "CO₂",
      "title.pm25": "PM2.5",

      "level.veryHot": "Very hot",
      "level.hot": "Hot",
      "level.veryWarm": "Very warm",
      "level.warm": "Warm",
      "level.slightlyWarm": "Slightly warm",
      "level.optimal": "Optimal",
      "level.slightlyCool": "Slightly cool",
      "level.fresh": "Fresh",
      "level.cool": "Cool",
      "level.cold": "Cold",
      "level.veryCold": "Very cold",

      "level.criticallyHumid": "Critically humid",
      "level.tooHumid": "Too humid",
      "level.veryHumid": "Very humid",
      "level.humid": "Humid",
      "level.slightlyHumid": "Slightly humid",
      "level.slightlyDry": "Slightly dry",
      "level.dry": "Dry",
      "level.veryDry": "Very dry",
      "level.tooDry": "Too dry",
      "level.criticallyDry": "Critically dry",

      "level.critical": "Critical",
      "level.veryHigh": "Very high",
      "level.high": "High",
      "level.elevated": "Elevated",
      "level.slightlyElevated": "Slightly elevated",
      "level.invalidReading": "Invalid",

      "adjective.warm": "warm",
      "adjective.cool": "cool",
      "adjective.humid": "humid",
      "adjective.dry": "dry",
      "adjective.elevated": "elevated",
      "adjective.low": "low",

      "avg.label": "Home avg.",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculated from room values`,
      "avg.ariaOpen": "Open average",

      "subtitle.aboveComfort": (v) => `Avg. ${v.diff} above comfort · ${v.count}/${v.total} ${v.total === 1 ? "room" : "rooms"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Avg. ${v.diff} above comfort.`,
      "subtitle.belowComfort": (v) => `Avg. ${v.diff} below comfort · ${v.count}/${v.total} ${v.total === 1 ? "room" : "rooms"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Avg. ${v.diff} below comfort.`,
      "subtitle.inComfortIssue": (v) => `Avg. in comfort · ${v.name} stands out most.`,
      "subtitle.inComfortAllGood": "Avg. in comfort · all rooms are within target range.",
      "subtitle.inComfort": "Avg. in comfort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "room" : "rooms"} without data.`,

      "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Spread ${v.value}`,
      "footer.trend": (v) => `Trend ${v.value}`,
      "trend.direction.rising": "rising",
      "trend.direction.stable": "stable",
      "trend.direction.falling": "falling",
      "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} comfort`,
      "scale.comfortLabelShort": (v) => `${v.range} comfort`,
      "scale.optimalLabel": (v) => `${v.range} optimal`,
      "scale.optimalLabelShort": (v) => `${v.range} optimal`,

      "rangeScale.currentLabel": "now",
      "rangeScale.currentLabelShort": "now",
      "rangeScale.minLabel": "min",
      "rangeScale.maxLabel": "max",
      "rangeScale.footer": (v) => `Today's span ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Today's span ${v.span} · Min ${v.min} · Max ${v.max}`,

      "card.coldestRoom": "Coldest room",
      "card.warmestRoom": "Warmest room",
      "card.driestRoom": "Driest room",
      "card.mostHumidRoom": "Most humid room",
      "card.lowestRoom": "Lowest room",
      "card.highestRoom": "Highest room",
      "card.dailyMinimum": "Daily minimum",
      "card.dailyMaximum": "Daily maximum",
      "card.ariaOpen": (v) => `Open ${v.label}: ${v.name}`,

      "room.ariaOpen": (v) => `Open ${v.name}`,

      "rotator.hint": "Swipe to switch between views",

      "views.none": "No view available.",

      "empty.title": "No data available.",
      "empty.hintNoRooms": "The configured average entity is not reporting a number.",
      "empty.hintMissingRooms": (v) => `${v.count} configured ${v.count === 1 ? "entity is" : "entities are"} missing or not reporting a number.`,
      "empty.hintNoRoomData": "No configured room entity is reporting a number.",
    },
    de: {
      "title.temperature": "Temperatur",
      "title.humidity": "Luftfeuchtigkeit",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Sehr heiß",
      "level.hot": "Heiß",
      "level.veryWarm": "Sehr warm",
      "level.warm": "Warm",
      "level.slightlyWarm": "Leicht warm",
      "level.optimal": "Optimal",
      "level.slightlyCool": "Leicht kühl",
      "level.fresh": "Frisch",
      "level.cool": "Kühl",
      "level.cold": "Kalt",
      "level.veryCold": "Sehr kalt",

      "level.criticallyHumid": "Kritisch feucht",
      "level.tooHumid": "Zu feucht",
      "level.veryHumid": "Sehr feucht",
      "level.humid": "Feucht",
      "level.slightlyHumid": "Leicht feucht",
      "level.slightlyDry": "Leicht trocken",
      "level.dry": "Trocken",
      "level.veryDry": "Sehr trocken",
      "level.tooDry": "Zu trocken",
      "level.criticallyDry": "Kritisch trocken",

      "level.critical": "Kritisch",
      "level.veryHigh": "Sehr hoch",
      "level.high": "Hoch",
      "level.elevated": "Erhöht",
      "level.slightlyElevated": "Leicht erhöht",
      "level.invalidReading": "Ungültig",

      "adjective.warm": "warm",
      "adjective.cool": "kühl",
      "adjective.humid": "feucht",
      "adjective.dry": "trocken",
      "adjective.elevated": "erhöht",
      "adjective.low": "niedrig",

      "avg.label": "Ø Wohnung",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · aus Raumwerten berechnet`,
      "avg.ariaOpen": "Durchschnitt öffnen",

      "subtitle.aboveComfort": (v) => `Ø ${v.diff} über Komfort · ${v.count}/${v.total} ${v.total === 1 ? "Raum" : "Räume"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} über Komfort.`,
      "subtitle.belowComfort": (v) => `Ø ${v.diff} unter Komfort · ${v.count}/${v.total} ${v.total === 1 ? "Raum" : "Räume"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} unter Komfort.`,
      "subtitle.inComfortIssue": (v) => `Ø im Komfort · ${v.name} fällt am stärksten auf.`,
      "subtitle.inComfortAllGood": "Ø im Komfort · alle Räume liegen im Zielkorridor.",
      "subtitle.inComfort": "Ø im Komfort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "Raum" : "Räume"} ohne Daten.`,

      "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Spanne ${v.value}`,
      "footer.trend": (v) => `Trend ${v.value}`,
      "trend.direction.rising": "steigend",
      "trend.direction.stable": "stabil",
      "trend.direction.falling": "fallend",
      "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} Komfort`,
      "scale.comfortLabelShort": (v) => `${v.range} Komfort`,
      "scale.optimalLabel": (v) => `${v.range} Optimal`,
      "scale.optimalLabelShort": (v) => `${v.range} Optimal`,

      "rangeScale.currentLabel": "jetzt",
      "rangeScale.currentLabelShort": "jetzt",
      "rangeScale.minLabel": "min",
      "rangeScale.maxLabel": "max",
      "rangeScale.footer": (v) => `Tagesspanne ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Tagesspanne ${v.span} · Min ${v.min} · Max ${v.max}`,

      "card.coldestRoom": "Kältester Raum",
      "card.warmestRoom": "Wärmster Raum",
      "card.driestRoom": "Trockenster Raum",
      "card.mostHumidRoom": "Feuchtester Raum",
      "card.lowestRoom": "Niedrigster Raum",
      "card.highestRoom": "Höchster Raum",
      "card.dailyMinimum": "Tagesminimum",
      "card.dailyMaximum": "Tagesmaximum",
      "card.ariaOpen": (v) => `${v.label}: ${v.name} öffnen`,

      "room.ariaOpen": (v) => `${v.name} öffnen`,

      "rotator.hint": "Wischen, um zwischen den Ansichten zu wechseln",

      "views.none": "Keine Ansicht verfügbar.",

      "empty.title": "Keine Daten verfügbar.",
      "empty.hintNoRooms": "Die konfigurierte Durchschnitts-Entität liefert keine Zahl.",
      "empty.hintMissingRooms": (v) => `${v.count} konfigurierte Entität${v.count === 1 ? "" : "en"} fehlen oder liefern keine Zahl.`,
      "empty.hintNoRoomData": "Keine konfigurierte Raum-Entität liefert eine Zahl.",
    },
    nl: {
      "title.temperature": "Temperatuur",
      "title.humidity": "Luchtvochtigheid",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Zeer heet",
      "level.hot": "Heet",
      "level.veryWarm": "Erg warm",
      "level.warm": "Warm",
      "level.slightlyWarm": "Licht warm",
      "level.optimal": "Optimaal",
      "level.slightlyCool": "Licht koel",
      "level.fresh": "Fris",
      "level.cool": "Koel",
      "level.cold": "Koud",
      "level.veryCold": "Zeer koud",

      "level.criticallyHumid": "Extreem vochtig",
      "level.tooHumid": "Te vochtig",
      "level.veryHumid": "Zeer vochtig",
      "level.humid": "Vochtig",
      "level.slightlyHumid": "Licht vochtig",
      "level.slightlyDry": "Licht droog",
      "level.dry": "Droog",
      "level.veryDry": "Zeer droog",
      "level.tooDry": "Te droog",
      "level.criticallyDry": "Extreem droog",

      "level.critical": "Kritiek",
      "level.veryHigh": "Zeer hoog",
      "level.high": "Hoog",
      "level.elevated": "Matig verhoogd",
      "level.slightlyElevated": "Licht verhoogd",
      "level.invalidReading": "Ongeldig",

      // Predicative fragment ("2/4 kamers warm"); Dutch adjectives here stay
      // invariant regardless of count, unlike the FR/IT feminine-plural
      // forms below (see the note there).
      "adjective.warm": "warm",
      "adjective.cool": "koel",
      "adjective.humid": "vochtig",
      "adjective.dry": "droog",
      "adjective.elevated": "verhoogd",
      "adjective.low": "laag",

      "avg.label": "Ø Woning",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · berekend uit kamerwaarden`,
      "avg.ariaOpen": "Gemiddelde openen",

      "subtitle.aboveComfort": (v) => `Ø ${v.diff} boven comfort · ${v.count}/${v.total} ${v.total === 1 ? "kamer" : "kamers"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} boven comfort.`,
      "subtitle.belowComfort": (v) => `Ø ${v.diff} onder comfort · ${v.count}/${v.total} ${v.total === 1 ? "kamer" : "kamers"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} onder comfort.`,
      "subtitle.inComfortIssue": (v) => `Ø in comfort · ${v.name} valt het meest op.`,
      "subtitle.inComfortAllGood": "Ø in comfort · alle kamers liggen binnen het streefbereik.",
      "subtitle.inComfort": "Ø in comfort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "kamer" : "kamers"} zonder data.`,

      "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Spreiding ${v.value}`,
      "footer.trend": (v) => `Trend ${v.value}`,
      "trend.direction.rising": "stijgend",
      "trend.direction.stable": "stabiel",
      "trend.direction.falling": "dalend",
      "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} comfort`,
      "scale.comfortLabelShort": (v) => `${v.range} comfort`,
      "scale.optimalLabel": (v) => `${v.range} optimaal`,
      "scale.optimalLabelShort": (v) => `${v.range} optimaal`,

      "rangeScale.currentLabel": "nu",
      "rangeScale.currentLabelShort": "nu",
      "rangeScale.minLabel": "min",
      "rangeScale.maxLabel": "max",
      "rangeScale.footer": (v) => `Dagbereik ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Dagbereik ${v.span} · Min ${v.min} · Max ${v.max}`,

      "card.coldestRoom": "Koudste kamer",
      "card.warmestRoom": "Warmste kamer",
      "card.driestRoom": "Droogste kamer",
      "card.mostHumidRoom": "Vochtigste kamer",
      "card.lowestRoom": "Laagste kamer",
      "card.highestRoom": "Hoogste kamer",
      "card.dailyMinimum": "Dagminimum",
      "card.dailyMaximum": "Dagmaximum",
      "card.ariaOpen": (v) => `${v.label} openen: ${v.name}`,

      "room.ariaOpen": (v) => `${v.name} openen`,

      "rotator.hint": "Swipe om tussen weergaven te wisselen",

      "views.none": "Geen weergave beschikbaar.",

      "empty.title": "Geen gegevens beschikbaar.",
      "empty.hintNoRooms": "De geconfigureerde gemiddelde-entiteit levert geen getal.",
      "empty.hintMissingRooms": (v) => `${v.count} geconfigureerde ${v.count === 1 ? "entiteit ontbreekt of levert" : "entiteiten ontbreken of leveren"} geen getal.`,
      "empty.hintNoRoomData": "Geen geconfigureerde kamer-entiteit levert een getal.",
    },
    fr: {
      "title.temperature": "Température",
      "title.humidity": "Humidité",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Très chaud",
      "level.hot": "Chaud",
      "level.veryWarm": "Assez chaud",
      "level.warm": "Tiède",
      "level.slightlyWarm": "Légèrement tiède",
      "level.optimal": "Optimal",
      "level.slightlyCool": "Légèrement frais",
      "level.fresh": "Frais",
      "level.cool": "Frisquet",
      "level.cold": "Froid",
      "level.veryCold": "Très froid",

      "level.criticallyHumid": "Extrêmement humide",
      "level.tooHumid": "Trop humide",
      "level.veryHumid": "Très humide",
      "level.humid": "Humide",
      "level.slightlyHumid": "Légèrement humide",
      "level.slightlyDry": "Légèrement sec",
      "level.dry": "Sec",
      "level.veryDry": "Très sec",
      "level.tooDry": "Trop sec",
      "level.criticallyDry": "Extrêmement sec",

      "level.critical": "Critique",
      "level.veryHigh": "Très élevé",
      "level.high": "Élevé",
      "level.elevated": "Modérément élevé",
      "level.slightlyElevated": "Légèrement élevé",
      "level.invalidReading": "Invalide",

      // Predicative fragment ("2/4 pièces chaudes"); "pièce"/"pièces" is
      // feminine, so these are feminine-plural forms — the only form this
      // key is actually used with (subtitle.*Comfort's rooms branch is only
      // reachable once hasRoomsView requires >= 2 rooms, see _computeData()).
      "adjective.warm": "chaudes",
      "adjective.cool": "fraîches",
      "adjective.humid": "humides",
      "adjective.dry": "sèches",
      "adjective.elevated": "élevées",
      "adjective.low": "basses",

      "avg.label": "Moy. maison",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculé à partir des valeurs des pièces`,
      "avg.ariaOpen": "Ouvrir la moyenne",

      "subtitle.aboveComfort": (v) => `Moy. ${v.diff} au-dessus du confort · ${v.count}/${v.total} ${v.total === 1 ? "pièce" : "pièces"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Moy. ${v.diff} au-dessus du confort.`,
      "subtitle.belowComfort": (v) => `Moy. ${v.diff} en dessous du confort · ${v.count}/${v.total} ${v.total === 1 ? "pièce" : "pièces"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Moy. ${v.diff} en dessous du confort.`,
      "subtitle.inComfortIssue": (v) => `Moy. dans le confort · ${v.name} se démarque le plus.`,
      "subtitle.inComfortAllGood": "Moy. dans le confort · toutes les pièces sont dans la plage cible.",
      "subtitle.inComfort": "Moy. dans le confort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "pièce" : "pièces"} sans données.`,

      "footer.comfort": (v) => `Confort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Écart ${v.value}`,
      "footer.trend": (v) => `Tendance ${v.value}`,
      "trend.direction.rising": "en hausse",
      "trend.direction.stable": "stable",
      "trend.direction.falling": "en baisse",
      "trend.aria": (v) => `Tendance ${v.direction} : ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} confort`,
      "scale.comfortLabelShort": (v) => `${v.range} confort`,
      "scale.optimalLabel": (v) => `${v.range} optimal`,
      "scale.optimalLabelShort": (v) => `${v.range} optimal`,

      // Review fix (post-2.27.0): "act." used to be the PRIMARY value here,
      // permanently truncating "maintenant" for every card width. Restored
      // to the full word; "act." now only serves as the *Short fallback
      // the label-short-form resolver substitutes in when the long form
      // genuinely doesn't fit (see _resolveRangeScaleLabels()).
      "rangeScale.currentLabel": "maintenant",
      "rangeScale.currentLabelShort": "act.",
      "rangeScale.minLabel": "min",
      "rangeScale.maxLabel": "max",
      "rangeScale.footer": (v) => `Écart du jour ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Écart du jour ${v.span} · Min ${v.min} · Max ${v.max}`,

      "card.coldestRoom": "Pièce la plus froide",
      "card.warmestRoom": "Pièce la plus chaude",
      "card.driestRoom": "Pièce la plus sèche",
      "card.mostHumidRoom": "Pièce la plus humide",
      "card.lowestRoom": "Pièce la plus basse",
      "card.highestRoom": "Pièce la plus haute",
      "card.dailyMinimum": "Minimum journalier",
      "card.dailyMaximum": "Maximum journalier",
      "card.ariaOpen": (v) => `Ouvrir ${v.label} : ${v.name}`,

      "room.ariaOpen": (v) => `Ouvrir ${v.name}`,

      "rotator.hint": "Balayez pour changer de vue",

      "views.none": "Aucune vue disponible.",

      "empty.title": "Aucune donnée disponible.",
      "empty.hintNoRooms": "L'entité de moyenne configurée ne renvoie aucun nombre.",
      "empty.hintMissingRooms": (v) => `${v.count} ${v.count === 1 ? "entité configurée est manquante ou ne renvoie" : "entités configurées sont manquantes ou ne renvoient"} aucun nombre.`,
      "empty.hintNoRoomData": "Aucune entité de pièce configurée ne renvoie de nombre.",
    },
    it: {
      "title.temperature": "Temperatura",
      "title.humidity": "Umidità",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Molto caldo",
      "level.hot": "Caldo",
      "level.veryWarm": "Piuttosto caldo",
      "level.warm": "Tiepido",
      "level.slightlyWarm": "Leggermente tiepido",
      "level.optimal": "Ottimale",
      "level.slightlyCool": "Leggermente fresco",
      "level.fresh": "Fresco",
      "level.cool": "Piuttosto fresco",
      "level.cold": "Freddo",
      "level.veryCold": "Molto freddo",

      "level.criticallyHumid": "Estremamente umido",
      "level.tooHumid": "Troppo umido",
      "level.veryHumid": "Molto umido",
      "level.humid": "Umido",
      "level.slightlyHumid": "Leggermente umido",
      "level.slightlyDry": "Leggermente secco",
      "level.dry": "Secco",
      "level.veryDry": "Molto secco",
      "level.tooDry": "Troppo secco",
      "level.criticallyDry": "Estremamente secco",

      "level.critical": "Critico",
      "level.veryHigh": "Molto alto",
      "level.high": "Alto",
      "level.elevated": "Moderatamente alto",
      "level.slightlyElevated": "Leggermente alto",
      "level.invalidReading": "Non valido",

      // Predicative fragment ("2/4 stanze calde"); "stanza"/"stanze" is
      // feminine, so these are feminine-plural forms — the only form this
      // key is actually used with (subtitle.*Comfort's rooms branch is only
      // reachable once hasRoomsView requires >= 2 rooms, see _computeData()).
      "adjective.warm": "calde",
      "adjective.cool": "fresche",
      "adjective.humid": "umide",
      "adjective.dry": "secche",
      "adjective.elevated": "alte",
      "adjective.low": "basse",

      "avg.label": "Media casa",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · calcolato dai valori delle stanze`,
      "avg.ariaOpen": "Apri la media",

      "subtitle.aboveComfort": (v) => `Media ${v.diff} sopra il comfort · ${v.count}/${v.total} ${v.total === 1 ? "stanza" : "stanze"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Media ${v.diff} sopra il comfort.`,
      "subtitle.belowComfort": (v) => `Media ${v.diff} sotto il comfort · ${v.count}/${v.total} ${v.total === 1 ? "stanza" : "stanze"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Media ${v.diff} sotto il comfort.`,
      "subtitle.inComfortIssue": (v) => `Media nel comfort · ${v.name} spicca maggiormente.`,
      "subtitle.inComfortAllGood": "Media nel comfort · tutte le stanze rientrano nell'intervallo obiettivo.",
      "subtitle.inComfort": "Media nel comfort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "stanza" : "stanze"} senza dati.`,

      "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Scarto ${v.value}`,
      "footer.trend": (v) => `Tendenza ${v.value}`,
      "trend.direction.rising": "in aumento",
      "trend.direction.stable": "stabile",
      "trend.direction.falling": "in calo",
      "trend.aria": (v) => `Tendenza ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} comfort`,
      "scale.comfortLabelShort": (v) => `${v.range} comfort`,
      "scale.optimalLabel": (v) => `${v.range} ottimale`,
      "scale.optimalLabelShort": (v) => `${v.range} ottimale`,

      "rangeScale.currentLabel": "ora",
      "rangeScale.currentLabelShort": "ora",
      "rangeScale.minLabel": "min",
      "rangeScale.maxLabel": "max",
      "rangeScale.footer": (v) => `Intervallo di oggi ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Intervallo di oggi ${v.span} · Min ${v.min} · Max ${v.max}`,

      "card.coldestRoom": "Stanza più fredda",
      "card.warmestRoom": "Stanza più calda",
      "card.driestRoom": "Stanza più secca",
      "card.mostHumidRoom": "Stanza più umida",
      "card.lowestRoom": "Stanza più bassa",
      "card.highestRoom": "Stanza più alta",
      "card.dailyMinimum": "Minimo giornaliero",
      "card.dailyMaximum": "Massimo giornaliero",
      "card.ariaOpen": (v) => `Apri ${v.label}: ${v.name}`,

      "room.ariaOpen": (v) => `Apri ${v.name}`,

      "rotator.hint": "Scorri per cambiare vista",

      "views.none": "Nessuna vista disponibile.",

      "empty.title": "Nessun dato disponibile.",
      "empty.hintNoRooms": "L'entità della media configurata non restituisce un numero.",
      "empty.hintMissingRooms": (v) => `${v.count} ${v.count === 1 ? "entità configurata risulta mancante o non restituisce" : "entità configurate risultano mancanti o non restituiscono"} un numero.`,
      "empty.hintNoRoomData": "Nessuna entità stanza configurata restituisce un numero.",
    },
    es: {
      "title.temperature": "Temperatura",
      "title.humidity": "Humedad",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Muy caluroso",
      "level.hot": "Caluroso",
      "level.veryWarm": "Muy cálido",
      "level.warm": "Cálido",
      "level.slightlyWarm": "Ligeramente cálido",
      "level.optimal": "Óptimo",
      "level.slightlyCool": "Ligeramente fresco",
      "level.fresh": "Fresco",
      "level.cool": "Frío moderado",
      "level.cold": "Frío",
      "level.veryCold": "Muy frío",

      "level.criticallyHumid": "Humedad crítica",
      "level.tooHumid": "Demasiado húmedo",
      "level.veryHumid": "Muy húmedo",
      "level.humid": "Húmedo",
      "level.slightlyHumid": "Ligeramente húmedo",
      "level.slightlyDry": "Ligeramente seco",
      "level.dry": "Seco",
      "level.veryDry": "Muy seco",
      "level.tooDry": "Demasiado seco",
      "level.criticallyDry": "Sequedad crítica",

      "level.critical": "Crítico",
      "level.veryHigh": "Muy alto",
      "level.high": "Alto",
      "level.elevated": "Elevado",
      "level.slightlyElevated": "Ligeramente elevado",
      "level.invalidReading": "No válido",

      // Predicative fragments agree with feminine plural "habitaciones";
      // elevated/low use a semantic value phrase rather than describing
      // the rooms themselves as physically high or low.
      "adjective.warm": "cálidas",
      "adjective.cool": "frescas",
      "adjective.humid": "húmedas",
      "adjective.dry": "secas",
      "adjective.elevated": "con valores elevados",
      "adjective.low": "con valores bajos",

      "avg.label": "Media del hogar",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculada a partir de los valores de las habitaciones`,
      "avg.ariaOpen": "Abrir la media",

      "subtitle.aboveComfort": (v) => `Media ${v.diff} por encima del confort · ${v.count}/${v.total} ${v.total === 1 ? "habitación" : "habitaciones"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Media ${v.diff} por encima del confort.`,
      "subtitle.belowComfort": (v) => `Media ${v.diff} por debajo del confort · ${v.count}/${v.total} ${v.total === 1 ? "habitación" : "habitaciones"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Media ${v.diff} por debajo del confort.`,
      "subtitle.inComfortIssue": (v) => `Media dentro del intervalo de confort · ${v.name} es la habitación que más se desvía.`,
      "subtitle.inComfortAllGood": "Media dentro del intervalo de confort · todas las habitaciones están dentro del intervalo objetivo.",
      "subtitle.inComfort": "Media dentro del intervalo de confort.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "habitación" : "habitaciones"} sin datos.`,

      "footer.comfort": (v) => `Confort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Diferencia ${v.value}`,
      "footer.trend": (v) => `Tendencia ${v.value}`,
      "trend.direction.rising": "ascendente",
      "trend.direction.stable": "estable",
      "trend.direction.falling": "descendente",
      "trend.aria": (v) => `Tendencia ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} confort`,
      "scale.comfortLabelShort": (v) => `${v.range} confort`,
      "scale.optimalLabel": (v) => `${v.range} óptimo`,
      "scale.optimalLabelShort": (v) => `${v.range} óptimo`,

      "rangeScale.currentLabel": "ahora",
      "rangeScale.currentLabelShort": "ahora",
      "rangeScale.minLabel": "mín.",
      "rangeScale.maxLabel": "máx.",
      "rangeScale.footer": (v) => `Intervalo de hoy ${v.span} · Mín. ${v.min} (${v.minTime}) · Máx. ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Intervalo de hoy ${v.span} · Mín. ${v.min} · Máx. ${v.max}`,

      "card.coldestRoom": "Habitación más fría",
      "card.warmestRoom": "Habitación más cálida",
      "card.driestRoom": "Habitación más seca",
      "card.mostHumidRoom": "Habitación más húmeda",
      "card.lowestRoom": "Habitación con el valor más bajo",
      "card.highestRoom": "Habitación con el valor más alto",
      "card.dailyMinimum": "Mínimo diario",
      "card.dailyMaximum": "Máximo diario",
      "card.ariaOpen": (v) => `Abrir ${v.label}: ${v.name}`,

      "room.ariaOpen": (v) => `Abrir ${v.name}`,

      "rotator.hint": "Desliza para cambiar de vista",

      "views.none": "No hay ninguna vista disponible.",

      "empty.title": "No hay datos disponibles.",
      "empty.hintNoRooms": "La entidad de media configurada no devuelve un número.",
      "empty.hintMissingRooms": (v) => `${v.count} ${v.count === 1 ? "entidad configurada no está disponible o no devuelve" : "entidades configuradas no están disponibles o no devuelven"} un número.`,
      "empty.hintNoRoomData": "Ninguna entidad de habitación configurada devuelve un número.",
    },
    ru: {
      "title.temperature": "Температура",
      "title.humidity": "Влажность",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Очень жарко",
      "level.hot": "Жарко",
      "level.veryWarm": "Очень тепло",
      "level.warm": "Тепло",
      "level.slightlyWarm": "Слегка тепло",
      "level.optimal": "Оптимально",
      "level.slightlyCool": "Слегка прохладно",
      "level.fresh": "Свежо",
      "level.cool": "Прохладно",
      "level.cold": "Холодно",
      "level.veryCold": "Очень холодно",

      "level.criticallyHumid": "Критически влажно",
      "level.tooHumid": "Слишком влажно",
      "level.veryHumid": "Очень влажно",
      "level.humid": "Влажно",
      "level.slightlyHumid": "Слегка влажно",
      "level.slightlyDry": "Слегка сухо",
      "level.dry": "Сухо",
      "level.veryDry": "Очень сухо",
      "level.tooDry": "Слишком сухо",
      "level.criticallyDry": "Критически сухо",

      "level.critical": "Критично",
      "level.veryHigh": "Очень высокий уровень",
      "level.high": "Высокий уровень",
      "level.elevated": "Повышенный уровень",
      "level.slightlyElevated": "Слегка повышенный уровень",
      "level.invalidReading": "Недопустимое значение",

      // Adverbial/predicative fragments avoid forcing an adjective to
      // agree with Russian numeral-governed room noun forms.
      "adjective.warm": "тепло",
      "adjective.cool": "прохладно",
      "adjective.humid": "влажно",
      "adjective.dry": "сухо",
      "adjective.elevated": "уровень повышен",
      "adjective.low": "уровень низкий",

      "avg.label": "Среднее по дому",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · рассчитано по значениям комнат`,
      "avg.ariaOpen": "Открыть среднее значение",

      "subtitle.aboveComfort": (v) => `Среднее на ${v.diff} выше комфортного диапазона · в ${v.count} ${selectPlural("ru", v.count, { one: "комнате", few: "комнатах", many: "комнатах", other: "комнатах" })} из ${v.total} ${selectPlural("ru", v.total, { one: "комнаты", few: "комнат", many: "комнат", other: "комнат" })} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Среднее на ${v.diff} выше комфортного диапазона.`,
      "subtitle.belowComfort": (v) => `Среднее на ${v.diff} ниже комфортного диапазона · в ${v.count} ${selectPlural("ru", v.count, { one: "комнате", few: "комнатах", many: "комнатах", other: "комнатах" })} из ${v.total} ${selectPlural("ru", v.total, { one: "комнаты", few: "комнат", many: "комнат", other: "комнат" })} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Среднее на ${v.diff} ниже комфортного диапазона.`,
      "subtitle.inComfortIssue": (v) => `Среднее в комфортном диапазоне · сильнее всего выделяется ${v.name}.`,
      "subtitle.inComfortAllGood": "Среднее в комфортном диапазоне · все комнаты находятся в целевом диапазоне.",
      "subtitle.inComfort": "Среднее в комфортном диапазоне.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${selectPlural("ru", v.count, { one: "комната", few: "комнаты", many: "комнат", other: "комнаты" })} без данных.`,

      "footer.comfort": (v) => `Комфорт ${v.count}/${v.total}`,
      "footer.spread": (v) => `Разброс ${v.value}`,
      "footer.trend": (v) => `Тренд ${v.value}`,
      "trend.direction.rising": "растёт",
      "trend.direction.stable": "стабильно",
      "trend.direction.falling": "снижается",
      "trend.aria": (v) => `Тренд ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} комфорт`,
      "scale.comfortLabelShort": (v) => `${v.range} комфорт`,
      "scale.optimalLabel": (v) => `${v.range} оптимум`,
      "scale.optimalLabelShort": (v) => `${v.range} оптимум`,

      "rangeScale.currentLabel": "сейчас",
      "rangeScale.currentLabelShort": "сейчас",
      "rangeScale.minLabel": "мин.",
      "rangeScale.maxLabel": "макс.",
      "rangeScale.footer": (v) => `Диапазон за сегодня ${v.span} · Мин. ${v.min} (${v.minTime}) · Макс. ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Диапазон за сегодня ${v.span} · Мин. ${v.min} · Макс. ${v.max}`,

      "card.coldestRoom": "Самая холодная комната",
      "card.warmestRoom": "Самая тёплая комната",
      "card.driestRoom": "Самая сухая комната",
      "card.mostHumidRoom": "Самая влажная комната",
      "card.lowestRoom": "Комната с самым низким значением",
      "card.highestRoom": "Комната с самым высоким значением",
      "card.dailyMinimum": "Минимум за день",
      "card.dailyMaximum": "Максимум за день",
      "card.ariaOpen": (v) => `Открыть «${v.label}»: ${v.name}`,

      "room.ariaOpen": (v) => `Открыть ${v.name}`,

      "rotator.hint": "Проведите по экрану, чтобы сменить вид",

      "views.none": "Нет доступных представлений.",

      "empty.title": "Нет доступных данных.",
      "empty.hintNoRooms": "Настроенная сущность среднего значения не передаёт числовое значение.",
      "empty.hintMissingRooms": (v) => {
        const category = getPluralCategory("ru", v.count);
        if (category === "one") return `${v.count} настроенная сущность отсутствует или не передаёт числовое значение.`;
        if (category === "few") return `${v.count} настроенные сущности отсутствуют или не передают числовое значение.`;
        return `${v.count} настроенных сущностей отсутствуют или не передают числовое значение.`;
      },
      "empty.hintNoRoomData": "Ни одна настроенная сущность комнаты не передаёт числовое значение.",
    },
    pl: {
      "title.temperature": "Temperatura",
      "title.humidity": "Wilgotność",
      "title.co2": "CO₂",
      "title.pm25": "PM2,5",

      "level.veryHot": "Bardzo gorąco",
      "level.hot": "Gorąco",
      "level.veryWarm": "Bardzo ciepło",
      "level.warm": "Ciepło",
      "level.slightlyWarm": "Lekko ciepło",
      "level.optimal": "Optymalnie",
      "level.slightlyCool": "Lekko chłodno",
      "level.fresh": "Rześko",
      "level.cool": "Chłodno",
      "level.cold": "Zimno",
      "level.veryCold": "Bardzo zimno",

      "level.criticallyHumid": "Krytycznie wilgotno",
      "level.tooHumid": "Zbyt wilgotno",
      "level.veryHumid": "Bardzo wilgotno",
      "level.humid": "Wilgotno",
      "level.slightlyHumid": "Lekko wilgotno",
      "level.slightlyDry": "Lekko sucho",
      "level.dry": "Sucho",
      "level.veryDry": "Bardzo sucho",
      "level.tooDry": "Zbyt sucho",
      "level.criticallyDry": "Krytycznie sucho",

      "level.critical": "Krytycznie",
      "level.veryHigh": "Bardzo wysoki poziom",
      "level.high": "Wysoki poziom",
      "level.elevated": "Podwyższony poziom",
      "level.slightlyElevated": "Lekko podwyższony poziom",
      "level.invalidReading": "Nieprawidłowa wartość",

      // Predicative/adverbial fragments remain valid after Polish
      // numeral-governed noun forms in the surrounding sentence.
      "adjective.warm": "jest ciepło",
      "adjective.cool": "jest chłodno",
      "adjective.humid": "jest wilgotno",
      "adjective.dry": "jest sucho",
      "adjective.elevated": "wartości są podwyższone",
      "adjective.low": "wartości są niskie",

      "avg.label": "Średnia dla domu",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · obliczona na podstawie wartości z pomieszczeń`,
      "avg.ariaOpen": "Otwórz wartość średnią",

      "subtitle.aboveComfort": (v) => `Średnia o ${v.diff} powyżej zakresu komfortu · w ${v.count} z ${v.total} ${v.total === 1 ? "pomieszczenia" : "pomieszczeń"} ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `Średnia o ${v.diff} powyżej zakresu komfortu.`,
      "subtitle.belowComfort": (v) => `Średnia o ${v.diff} poniżej zakresu komfortu · w ${v.count} z ${v.total} ${v.total === 1 ? "pomieszczenia" : "pomieszczeń"} ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `Średnia o ${v.diff} poniżej zakresu komfortu.`,
      "subtitle.inComfortIssue": (v) => `Średnia w zakresie komfortu · najbardziej wyróżnia się ${v.name}.`,
      "subtitle.inComfortAllGood": "Średnia w zakresie komfortu · wszystkie pomieszczenia są w zakresie docelowym.",
      "subtitle.inComfort": "Średnia w zakresie komfortu.",
      "subtitle.missingRooms": (v) => ` ${v.count} ${selectPlural("pl", v.count, { one: "pokój", few: "pokoje", many: "pokoi", other: "pokoju" })} bez danych.`,

      "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
      "footer.spread": (v) => `Rozrzut ${v.value}`,
      "footer.trend": (v) => `Trend ${v.value}`,
      "trend.direction.rising": "rosnący",
      "trend.direction.stable": "stabilny",
      "trend.direction.falling": "spadający",
      "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} komfort`,
      "scale.comfortLabelShort": (v) => `${v.range} komfort`,
      // Review fix (post-2.27.0): "opt." used to be the PRIMARY value here
      // (a permanent truncation added to fix a real 320px Chromium overlap
      // on the "optimal" band label). Restored to the full adjective,
      // consistent with the "${range} <descriptor>" pattern every other
      // language uses (e.g. de "Optimal", ru "оптимум") and with the
      // existing level.optimal ("Optymalnie") translation; "opt." now only
      // serves as the *Short fallback the label-short-form resolver
      // substitutes in when the long form genuinely doesn't fit (see
      // _resolveOptimalLabelPosition()) -- the exact narrow-width case this
      // abbreviation was originally introduced for.
      "scale.optimalLabel": (v) => `${v.range} optymalny`,
      "scale.optimalLabelShort": (v) => `${v.range} opt.`,

      "rangeScale.currentLabel": "teraz",
      "rangeScale.currentLabelShort": "teraz",
      "rangeScale.minLabel": "min.",
      "rangeScale.maxLabel": "maks.",
      "rangeScale.footer": (v) => `Dzisiejszy zakres ${v.span} · Min. ${v.min} (${v.minTime}) · Maks. ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `Dzisiejszy zakres ${v.span} · Min. ${v.min} · Maks. ${v.max}`,

      "card.coldestRoom": "Najchłodniejszy pokój",
      "card.warmestRoom": "Najcieplejszy pokój",
      "card.driestRoom": "Najbardziej suche pomieszczenie",
      "card.mostHumidRoom": "Najbardziej wilgotne pomieszczenie",
      "card.lowestRoom": "Pomieszczenie z najniższą wartością",
      "card.highestRoom": "Pomieszczenie z najwyższą wartością",
      "card.dailyMinimum": "Minimum dzienne",
      "card.dailyMaximum": "Maksimum dzienne",
      "card.ariaOpen": (v) => `Otwórz ${v.label}: ${v.name}`,

      "room.ariaOpen": (v) => `Otwórz ${v.name}`,

      "rotator.hint": "Przesuń, aby zmienić widok",

      "views.none": "Brak dostępnego widoku.",

      "empty.title": "Brak dostępnych danych.",
      "empty.hintNoRooms": "Skonfigurowana encja wartości średniej nie zwraca liczby.",
      "empty.hintMissingRooms": (v) => {
        const category = getPluralCategory("pl", v.count);
        if (category === "one") return `${v.count} skonfigurowana encja jest niedostępna lub nie zwraca liczby.`;
        if (category === "few") return `${v.count} skonfigurowane encje są niedostępne lub nie zwracają liczby.`;
        return `${v.count} skonfigurowanych encji jest niedostępnych lub nie zwraca liczby.`;
      },
      "empty.hintNoRoomData": "Żadna skonfigurowana encja pomieszczenia nie zwraca liczby.",
    },
    ko: {
      "title.temperature": "온도",
      "title.humidity": "습도",
      "title.co2": "CO₂",
      "title.pm25": "PM2.5",

      "level.veryHot": "매우 더움",
      "level.hot": "더움",
      "level.veryWarm": "매우 따뜻함",
      "level.warm": "따뜻함",
      "level.slightlyWarm": "약간 따뜻함",
      "level.optimal": "최적",
      "level.slightlyCool": "약간 선선함",
      "level.fresh": "상쾌함",
      "level.cool": "선선함",
      "level.cold": "추움",
      "level.veryCold": "매우 추움",

      "level.criticallyHumid": "습도가 위험하게 높음",
      "level.tooHumid": "지나치게 습함",
      "level.veryHumid": "매우 습함",
      "level.humid": "습함",
      "level.slightlyHumid": "약간 습함",
      "level.slightlyDry": "약간 건조함",
      "level.dry": "건조함",
      "level.veryDry": "매우 건조함",
      "level.tooDry": "지나치게 건조함",
      "level.criticallyDry": "위험하게 건조함",

      "level.critical": "위험",
      "level.veryHigh": "매우 높음",
      "level.high": "높음",
      "level.elevated": "높은 편",
      "level.slightlyElevated": "약간 높음",
      "level.invalidReading": "유효하지 않음",

      "adjective.warm": "따뜻함",
      "adjective.cool": "선선함",
      "adjective.humid": "습함",
      "adjective.dry": "건조함",
      "adjective.elevated": "수치가 높음",
      "adjective.low": "수치가 낮음",

      "avg.label": "집 전체 평균",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · 방별 값으로 계산`,
      "avg.ariaOpen": "평균값 열기",

      "subtitle.aboveComfort": (v) => `평균이 쾌적 범위보다 ${v.diff} 높음 · ${v.total}개 방 중 ${v.count}개 방: ${v.adjective}.`,
      "subtitle.aboveComfortNoRooms": (v) => `평균이 쾌적 범위보다 ${v.diff} 높음.`,
      "subtitle.belowComfort": (v) => `평균이 쾌적 범위보다 ${v.diff} 낮음 · ${v.total}개 방 중 ${v.count}개 방: ${v.adjective}.`,
      "subtitle.belowComfortNoRooms": (v) => `평균이 쾌적 범위보다 ${v.diff} 낮음.`,
      "subtitle.inComfortIssue": (v) => `평균은 쾌적 범위 · ${v.name}의 편차가 가장 큼.`,
      "subtitle.inComfortAllGood": "평균은 쾌적 범위 · 모든 방이 목표 범위 안에 있음.",
      "subtitle.inComfort": "평균은 쾌적 범위.",
      "subtitle.missingRooms": (v) => ` ${v.count}개 방은 데이터 없음.`,

      "footer.comfort": (v) => `쾌적 ${v.count}/${v.total}`,
      "footer.spread": (v) => `편차 ${v.value}`,
      "footer.trend": (v) => `추세 ${v.value}`,
      "trend.direction.rising": "상승",
      "trend.direction.stable": "안정",
      "trend.direction.falling": "하락",
      "trend.aria": (v) => `추세 ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} 쾌적 범위`,
      "scale.comfortLabelShort": (v) => `${v.range} 쾌적 범위`,
      "scale.optimalLabel": (v) => `${v.range} 최적 범위`,
      "scale.optimalLabelShort": (v) => `${v.range} 최적 범위`,

      "rangeScale.currentLabel": "현재",
      "rangeScale.currentLabelShort": "현재",
      "rangeScale.minLabel": "최저",
      "rangeScale.maxLabel": "최고",
      "rangeScale.footer": (v) => `오늘의 범위 ${v.span} · 최저 ${v.min} (${v.minTime}) · 최고 ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `오늘의 범위 ${v.span} · 최저 ${v.min} · 최고 ${v.max}`,

      "card.coldestRoom": "가장 추운 방",
      "card.warmestRoom": "가장 따뜻한 방",
      "card.driestRoom": "가장 건조한 방",
      "card.mostHumidRoom": "가장 습한 방",
      "card.lowestRoom": "수치가 가장 낮은 방",
      "card.highestRoom": "수치가 가장 높은 방",
      "card.dailyMinimum": "일일 최저",
      "card.dailyMaximum": "일일 최고",
      "card.ariaOpen": (v) => `${v.label} 열기: ${v.name}`,

      "room.ariaOpen": (v) => `${v.name} 열기`,

      "rotator.hint": "밀어서 보기 전환",

      "views.none": "사용 가능한 보기가 없습니다.",

      "empty.title": "사용 가능한 데이터가 없습니다.",
      "empty.hintNoRooms": "설정된 평균 엔터티가 숫자 값을 보고하지 않습니다.",
      "empty.hintMissingRooms": (v) => `설정된 엔터티 ${v.count}개가 없거나 숫자 값을 보고하지 않습니다.`,
      "empty.hintNoRoomData": "설정된 방 엔터티 중 숫자 값을 보고하는 항목이 없습니다.",
    },
    ja: {
      "title.temperature": "温度",
      "title.humidity": "湿度",
      "title.co2": "CO₂",
      "title.pm25": "PM2.5",

      "level.veryHot": "非常に暑い",
      "level.hot": "暑い",
      "level.veryWarm": "かなり暖かい",
      "level.warm": "暖かい",
      "level.slightlyWarm": "やや暖かい",
      "level.optimal": "最適",
      "level.slightlyCool": "やや涼しい",
      "level.fresh": "さわやか",
      "level.cool": "涼しい",
      "level.cold": "寒い",
      "level.veryCold": "非常に寒い",

      "level.criticallyHumid": "湿度が危険域",
      "level.tooHumid": "湿度が高すぎる",
      "level.veryHumid": "湿度が非常に高い",
      "level.humid": "湿度が高い",
      "level.slightlyHumid": "湿度がやや高い",
      "level.slightlyDry": "やや乾燥",
      "level.dry": "乾燥",
      "level.veryDry": "非常に乾燥",
      "level.tooDry": "乾燥しすぎ",
      "level.criticallyDry": "乾燥が危険域",

      "level.critical": "危険",
      "level.veryHigh": "非常に高い",
      "level.high": "高い",
      "level.elevated": "高め",
      "level.slightlyElevated": "やや高め",
      "level.invalidReading": "無効な値",

      "adjective.warm": "暖かめ",
      "adjective.cool": "涼しめ",
      "adjective.humid": "湿度が高め",
      "adjective.dry": "乾燥気味",
      "adjective.elevated": "数値が高め",
      "adjective.low": "数値が低め",

      "avg.label": "住宅平均",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · 各部屋の値から算出`,
      "avg.ariaOpen": "平均値を開く",

      "subtitle.aboveComfort": (v) => `平均は快適範囲を ${v.diff} 上回っています · ${v.total}室中${v.count}室は${v.adjective}です。`,
      "subtitle.aboveComfortNoRooms": (v) => `平均は快適範囲を ${v.diff} 上回っています。`,
      "subtitle.belowComfort": (v) => `平均は快適範囲を ${v.diff} 下回っています · ${v.total}室中${v.count}室は${v.adjective}です。`,
      "subtitle.belowComfortNoRooms": (v) => `平均は快適範囲を ${v.diff} 下回っています。`,
      "subtitle.inComfortIssue": (v) => `平均は快適範囲内 · ${v.name}が最も外れています。`,
      "subtitle.inComfortAllGood": "平均は快適範囲内 · すべての部屋が目標範囲内です。",
      "subtitle.inComfort": "平均は快適範囲内です。",
      "subtitle.missingRooms": (v) => ` ${v.count}室はデータなし。`,

      "footer.comfort": (v) => `快適 ${v.count}/${v.total}`,
      "footer.spread": (v) => `ばらつき ${v.value}`,
      "footer.trend": (v) => `トレンド ${v.value}`,
      "trend.direction.rising": "上昇",
      "trend.direction.stable": "安定",
      "trend.direction.falling": "下降",
      "trend.aria": (v) => `傾向 ${v.direction}: ${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} 快適`,
      "scale.comfortLabelShort": (v) => `${v.range} 快適`,
      "scale.optimalLabel": (v) => `${v.range} 最適`,
      "scale.optimalLabelShort": (v) => `${v.range} 最適`,

      "rangeScale.currentLabel": "現在",
      "rangeScale.currentLabelShort": "現在",
      "rangeScale.minLabel": "最小",
      "rangeScale.maxLabel": "最大",
      "rangeScale.footer": (v) => `今日の範囲 ${v.span} · 最小 ${v.min} (${v.minTime}) · 最大 ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `今日の範囲 ${v.span} · 最小 ${v.min} · 最大 ${v.max}`,

      "card.coldestRoom": "最も寒い部屋",
      "card.warmestRoom": "最も暖かい部屋",
      "card.driestRoom": "最も乾燥した部屋",
      "card.mostHumidRoom": "最も湿度が高い部屋",
      "card.lowestRoom": "値が最も低い部屋",
      "card.highestRoom": "値が最も高い部屋",
      "card.dailyMinimum": "日最低",
      "card.dailyMaximum": "日最高",
      "card.ariaOpen": (v) => `${v.label}を開く: ${v.name}`,

      "room.ariaOpen": (v) => `${v.name}を開く`,

      "rotator.hint": "スワイプして表示を切り替え",

      "views.none": "利用可能な表示がありません。",

      "empty.title": "利用可能なデータがありません。",
      "empty.hintNoRooms": "設定された平均エンティティが数値を返していません。",
      "empty.hintMissingRooms": (v) => `設定されたエンティティ${v.count}件が見つからないか、数値を返していません。`,
      "empty.hintNoRoomData": "設定された部屋エンティティのいずれも数値を返していません。",
    },
    zh: {
      "title.temperature": "温度",
      "title.humidity": "湿度",
      "title.co2": "CO₂",
      "title.pm25": "PM2.5",

      "level.veryHot": "非常炎热",
      "level.hot": "炎热",
      "level.veryWarm": "很暖",
      "level.warm": "温暖",
      "level.slightlyWarm": "略暖",
      "level.optimal": "最佳",
      "level.slightlyCool": "略凉",
      "level.fresh": "清爽",
      "level.cool": "凉",
      "level.cold": "冷",
      "level.veryCold": "非常寒冷",

      "level.criticallyHumid": "湿度严重过高",
      "level.tooHumid": "过于潮湿",
      "level.veryHumid": "非常潮湿",
      "level.humid": "潮湿",
      "level.slightlyHumid": "略潮湿",
      "level.slightlyDry": "略干燥",
      "level.dry": "干燥",
      "level.veryDry": "非常干燥",
      "level.tooDry": "过于干燥",
      "level.criticallyDry": "严重干燥",

      "level.critical": "严重",
      "level.veryHigh": "非常高",
      "level.high": "高",
      "level.elevated": "偏高",
      "level.slightlyElevated": "略高",
      "level.invalidReading": "无效值",

      "adjective.warm": "偏暖",
      "adjective.cool": "偏凉",
      "adjective.humid": "偏湿",
      "adjective.dry": "偏干",
      "adjective.elevated": "数值偏高",
      "adjective.low": "数值偏低",

      "avg.label": "全屋平均",
      "avg.tooltip": (v) => `${v.label}: ${v.value}`,
      "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · 根据各房间数值计算`,
      "avg.ariaOpen": "打开平均值",

      "subtitle.aboveComfort": (v) => `平均值高于舒适范围 ${v.diff} · ${v.total}个房间中有${v.count}个${v.adjective}。`,
      "subtitle.aboveComfortNoRooms": (v) => `平均值高于舒适范围 ${v.diff}。`,
      "subtitle.belowComfort": (v) => `平均值低于舒适范围 ${v.diff} · ${v.total}个房间中有${v.count}个${v.adjective}。`,
      "subtitle.belowComfortNoRooms": (v) => `平均值低于舒适范围 ${v.diff}。`,
      "subtitle.inComfortIssue": (v) => `平均值处于舒适范围 · ${v.name}的偏差最大。`,
      "subtitle.inComfortAllGood": "平均值处于舒适范围 · 所有房间均在目标范围内。",
      "subtitle.inComfort": "平均值处于舒适范围。",
      "subtitle.missingRooms": (v) => ` ${v.count}个房间无数据。`,

      "footer.comfort": (v) => `舒适 ${v.count}/${v.total}`,
      "footer.spread": (v) => `极差 ${v.value}`,
      "footer.trend": (v) => `趋势 ${v.value}`,
      "trend.direction.rising": "上升",
      "trend.direction.stable": "稳定",
      "trend.direction.falling": "下降",
      "trend.aria": (v) => `趋势${v.direction}：${v.value}`,

      "scale.comfortLabel": (v) => `${v.range} 舒适`,
      "scale.comfortLabelShort": (v) => `${v.range} 舒适`,
      "scale.optimalLabel": (v) => `${v.range} 最佳`,
      "scale.optimalLabelShort": (v) => `${v.range} 最佳`,

      "rangeScale.currentLabel": "当前",
      "rangeScale.currentLabelShort": "当前",
      "rangeScale.minLabel": "最低",
      "rangeScale.maxLabel": "最高",
      "rangeScale.footer": (v) => `今日范围 ${v.span} · 最低 ${v.min} (${v.minTime}) · 最高 ${v.max} (${v.maxTime})`,
      "rangeScale.footerCompact": (v) => `今日范围 ${v.span} · 最低 ${v.min} · 最高 ${v.max}`,

      "card.coldestRoom": "最冷房间",
      "card.warmestRoom": "最暖房间",
      "card.driestRoom": "最干燥房间",
      "card.mostHumidRoom": "最潮湿房间",
      "card.lowestRoom": "数值最低的房间",
      "card.highestRoom": "数值最高的房间",
      "card.dailyMinimum": "当日最低",
      "card.dailyMaximum": "当日最高",
      "card.ariaOpen": (v) => `打开${v.label}: ${v.name}`,

      "room.ariaOpen": (v) => `打开${v.name}`,

      "rotator.hint": "滑动以切换视图",

      "views.none": "暂无可用视图。",

      "empty.title": "暂无可用数据。",
      "empty.hintNoRooms": "配置的平均值实体未返回数值。",
      "empty.hintMissingRooms": (v) => `${v.count}个已配置实体缺失或未返回数值。`,
      "empty.hintNoRoomData": "配置的房间实体均未返回数值。",
    },
  };

  // Self-check (module load time only): warns if a language's key set
  // differs from "en" (the reference), so a missing/extra key in a new or
  // edited translation block is caught immediately instead of silently
  // falling back to "en" at runtime (see _t()). Cheap and runs once.
  {
    const referenceKeys = new Set(Object.keys(TRANSLATIONS[DEFAULT_LANGUAGE]));
    for (const lang of Object.keys(TRANSLATIONS)) {
      if (lang === DEFAULT_LANGUAGE) continue;
      const keys = new Set(Object.keys(TRANSLATIONS[lang]));
      const missing = [...referenceKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !referenceKeys.has(k));
      if (missing.length || extra.length) {
        console.warn(
          `Room Climate Card: TRANSLATIONS["${lang}"] is out of sync with "${DEFAULT_LANGUAGE}"` +
            (missing.length ? ` — missing: ${missing.join(", ")}` : "") +
            (extra.length ? ` — extra: ${extra.join(", ")}` : "")
        );
      }
    }
  }

  // Describes each possible carousel view: when it's shown (condition), how
  // to render its initial HTML, and how to patch it on a data-only update.
  // Registry declaration order is the only thing that determines on-screen
  // left-to-right order — _computeData() builds data.views by filtering
  // this table in order, and the DOM/track/auto-slide navigation (see
  // _holdSequence()) all consume that same ordered list as their single
  // position source. There's no "anchor"/"slot" concept: adding a new view
  // anywhere in this list only needs a new entry here plus its render/
  // update functions, in the position where it should appear on screen —
  // nothing else needs to change.
  // View-customizer "Baukasten" foundation (Teil 2, building on AP-04's
  // optionsSchema whitelist, audit 14.4): a schema descriptor value used to
  // be a bare presence-marker (any truthy placeholder) -- boolOption()
  // upgrades that to a small {default, validate} descriptor so a raw
  // views:[i].options value can be both defaulted AND type-checked, not
  // just whitelisted by key. Kept as a small factory (not inlined at each
  // call site) so every boolean view option shares identical validation
  // semantics for free.
  function boolOption(defaultValue) {
    return { default: defaultValue, validate: (value) => typeof value === "boolean" };
  }

  function enumOption(defaultValue, allowedValues) {
    // AP-C3 (audit 23.2): same Baukasten as boolOption() above, for a
    // view option with a closed set of non-boolean values (e.g.
    // scale.markers: "average"|"extremes"|"all"). An invalid value is diagnosed and
    // dropped by _normalizeViewOptions() exactly like an invalid boolean
    // option, then resolveViewOptions() fills in defaultValue.
    return { default: defaultValue, validate: (value) => allowedValues.includes(value) };
  }

  const VIEW_REGISTRY = [
    {
      key: "range",
      condition: (data) => data.hasRange,
      // AP-04 (audit 11.2): "auto" resolution (used when views: is omitted,
      // or when a listed object explicitly says enabled:auto) mirrors
      // condition() (available -> shown) for
      // every view except range_scale, whose own default is off (see there).
      defaultEnabled: (data) => data.hasRange,
      // Review fix (P1, post-2.21.1, audit 14.4): whitelist of views:[i].options
      // keys this view actually implements — see _normalizeViewOptions().
      // AP-C3 (audit 23.2): show_time toggles whether the daily min/max
      // cards show their timestamp (_renderRangeCards()'s `name` slot,
      // reused from the extremes-card room-name field — see there); the
      // value itself is unaffected either way.
      optionsSchema: { show_time: boolOption(true) },
      render: (card, data) => card._renderRangeView(data),
      // AP-09 (audit 18): keyed patch-in-place instead of innerHTML
      // replacement -- see _updateRangeCards().
      update: (card, root, data) => card._updateRangeCards(root.querySelector(".rtc-range-view"), data),
    },
    {
      // AP-04: YAML type "range_scale" (snake_case, renamed from the
      // pre-AP-04 "rangeScale" key/range_scale_view flag — the ONLY thing
      // renamed; internal method/CSS/data-field names below
      // (_renderRangeScaleView/_updateRangeScaleView, hasRangeScale,
      // .rtc-range-scale-view) are an implementation detail, not a public
      // YAML surface, and stay as-is). condition() is now pure availability
      // (rangeScaleAvailable, see _computeData()) — the old
      // config.range_scale_view gate is gone; "auto" leaves it OFF by
      // default (audit 11.2) — it appears when views: explicitly lists it
      // (string or object form, both normalize to enabled:true).
      key: "range_scale",
      condition: (data) => data.rangeScaleAvailable,
      defaultEnabled: () => false,
      // Teil 2 (view-customizer Baukasten): purely visual band toggles —
      // each suppresses both the colored band and its descriptive label
      // (range_scale only has an optimal label; its top row is reserved
      // for current/min/max). See the identical pair on "scale" below for
      // the full rationale. Independent per view: range_scale and scale
      // can show different bands.
      // AP-C3 (audit 23.2): footer has three states — "detailed" (default,
      // today's unchanged text incl. min/max timestamps), "compact" (same
      // template minus the timestamps, see _rangeScaleFooterText()), or
      // false (no footer at all for THIS view, independent of but ANDed
      // with the global hide_footer).
      optionsSchema: {
        show_comfort_band: boolOption(true),
        show_optimal_band: boolOption(true),
        footer: enumOption("detailed", ["compact", "detailed", false]),
      },
      render: (card, data) => card._renderRangeScaleView(data),
      update: (card, root, data) => card._updateRangeScaleView(root, data),
    },
    {
      key: "scale",
      condition: () => true,
      // AP-04: "mandatory" is gone entirely — a views: config that omits
      // "scale" now genuinely omits it (views: is fully authoritative when
      // present, see resolveActiveViews()). Its own defaultEnabled is
      // unconditionally true only because condition() itself always is;
      // there's no longer any special protection against disabling it.
      defaultEnabled: () => true,
      // Teil 2 (view-customizer Baukasten, user request): show_comfort_band/
      // show_optimal_band toggle whether the two background <div>s
      // (.rtc-comfort-band/.rtc-optimal-band) and their matching
      // descriptive labels render — see _renderScaleBar()/
      // _renderScaleView(). Purely visual: comfortMin/Max, optimalMin/Max,
      // classification/tone, footer text, and marker colors are computed
      // completely independently of these and never read them.
      // AP-C3 (audit 23.2): footer:false suppresses the comfort-count
      // footer text (ANDed with the global hide_footer, same convention as
      // range_scale's footer option). markers:"extremes" (default) is the
      // established coldest+warmest+avg behavior; "average" leaves only the
      // avg marker; "all" renders every valid configured room plus avg.
      optionsSchema: {
        show_comfort_band: boolOption(true),
        show_optimal_band: boolOption(true),
        footer: boolOption(true),
        markers: enumOption("extremes", ["average", "extremes", "all"]),
      },
      render: (card, data) => card._renderScaleView(data),
      update: (card, root, data) => card._updateScaleView(root, data),
    },
    {
      key: "extremes",
      condition: (data) => data.hasRoomsView,
      defaultEnabled: (data) => data.hasRoomsView,
      // AP-C3 (audit 23.2): show_value toggles the numeric value on the
      // coldest/warmest cards (_renderMetricCard()'s shared showValue
      // param, see there) — label/room name/color stay regardless.
      optionsSchema: { show_value: boolOption(true) },
      render: (card, data) => card._renderExtremesView(data),
      // AP-09 (audit 18): keyed patch-in-place instead of innerHTML
      // replacement -- see _updateExtremeCards().
      update: (card, root, data) => card._updateExtremeCards(root.querySelector(".rtc-extremes-view"), data),
    },
  ];

  function resolveActiveViews(registry, model, config) {
    // Pure function (no `this`, directly unit-testable): resolves the
    // final ordered list of active view keys from the caller's views:
    // config (AP-04, audit sections 11, 12, 14.3-14.5) — a list of
    // {type, enabled, options} requests (both string shorthand and an object
    // without enabled normalize to enabled:true) — layered on VIEW_REGISTRY's
    // condition()/defaultEnabled(). Without views: configured (config.views
    // is null, the _normalizeConfig() sentinel for "not set"), requests
    // defaults to one "auto" entry per registry key in registry order —
    // today's exact 1:1 behavior, unchanged.
    //
    // views: IS the single public view-configuration surface, and is fully
    // AUTHORITATIVE the moment it's present (even as an explicit empty
    // list): only listed types can ever appear, in exactly the listed
    // order — a type the list doesn't mention is simply never shown, no
    // "always append what's missing" fallback (a real behavior change from
    // the old view_order, deliberate per the audit). Each request is kept
    // separate along all three axes the audit requires: `requested` (did
    // the user's own enabled:true/false/"auto"-resolved-via-defaultEnabled()
    // ask for it), `available` (does condition() say it COULD show), and
    // `active` (both) — entries (not just the flat key list) are returned
    // for any future consumer that needs the fuller picture; every current
    // consumer (data.views itself, _holdSequence(), the carousel/solo
    // dispatch) still only needs the flat, ordered `views` key array.
    const requests = Array.isArray(config?.views)
      ? config.views
      : registry.map((v) => ({ type: v.key, enabled: "auto", options: {} }));
    const diagnostics = [];
    const seen = new Set();
    const entries = [];
    for (const request of requests) {
      const descriptor = registry.find((v) => v.key === request.type);
      if (!descriptor) {
        diagnostics.push(`views: unknown view type "${request.type}"`);
        continue;
      }
      if (seen.has(request.type)) {
        diagnostics.push(`views: duplicate view type "${request.type}"`);
        continue;
      }
      seen.add(request.type);
      const available = descriptor.condition(model);
      const requested = request.enabled === "auto" ? descriptor.defaultEnabled(model) : request.enabled === true;
      entries.push({ type: request.type, requested, available, active: requested && available, options: request.options });
    }

    return { views: entries.filter((e) => e.active).map((e) => e.type), entries, diagnostics };
  }

  function resolveViewOptions(descriptor, providedOptions) {
    // View-customizer "Baukasten" foundation (Teil 2): fully resolves ONE
    // view's customization surface -- every optionsSchema key gets either
    // its caller-provided (already whitelisted/validated by
    // _normalizeViewOptions()) value or its schema default. Callers never
    // need to know which keys exist or handle "what if it's missing" --
    // any FUTURE optionsSchema key on ANY view (audit 23.2's own examples:
    // a footer toggle on "range", markers on "scale", ...) flows through
    // here automatically, with zero changes to this function. Pure (no
    // `this`), like resolveActiveViews() above.
    const schema = descriptor?.optionsSchema || {};
    const resolved = {};
    for (const key of Object.keys(schema)) {
      const provided = providedOptions ? providedOptions[key] : undefined;
      resolved[key] = provided === undefined ? schema[key].default : provided;
    }
    return resolved;
  }

  function resolveRoomDisplayOrder(list, sortMode, language) {
    // AP-C2 (audit 23.1): room_sort's four modes for the RENDERED chip
    // order only -- _computeData() keeps its own, always value-sorted
    // `allRooms` for every calculation (extrema/comfort-count/spread), so
    // this function is never on that path; it only reorders the possibly
    // grid-capped subset that actually becomes chips. Pure (no `this`),
    // like resolveActiveViews()/resolveViewOptions() above -- language is
    // passed in explicitly rather than read from `this._language()` so it
    // stays independently unit-testable.
    const sorted = [...list];
    if (sortMode === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name, language));
    if (sortMode === "value_desc") return sorted.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, language));
    if (sortMode === "configured") return sorted.sort((a, b) => a.index - b.index);
    return sorted.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, language)); // value_asc (default)
  }

  // ==== Auto-slide easing: single shared definition (AP-08, audit 17) ====
  // CSS and JS used to each hardcode "cubic-bezier(.45,0,.16,1)" separately
  // (_slideKeyframes()'s keyframe animation, _updateTrackTransform()'s
  // manual-settle transition, _setTrackTransition()'s swipe-settle
  // transition) while the accessibility flip calculation
  // (_accessibleViewIndexAt()/_msUntilNextAccessibilityFlip()) used a
  // completely unrelated number (the raw temporal midpoint, slideMs/2) —
  // audit 17's A11Y-01: a cubic-bezier easing's TIME axis and its
  // EASED/spatial-progress axis are different curves, so "50% of the time"
  // and "50% of the visual motion" land at different moments. The
  // accessible view must follow whichever view is spatially dominant, not
  // raw time, so the flip must happen where the EASED progress crosses 50%
  // — which requires inverting the same curve CSS renders with.
  const SLIDE_EASING = Object.freeze({ x1: 0.45, y1: 0, x2: 0.16, y2: 1 });

  function cubicBezierPoint(easing, u) {
    // Standard cubic-bezier evaluation with implicit P0=(0,0)/P3=(1,1) (the
    // two endpoints every CSS cubic-bezier() curve is anchored to).
    const mu = 1 - u;
    return {
      x: 3 * mu * mu * u * easing.x1 + 3 * mu * u * u * easing.x2 + u * u * u,
      y: 3 * mu * mu * u * easing.y1 + 3 * mu * u * u * easing.y2 + u * u * u,
    };
  }

  function timeFractionForEasedProgress(easing, targetY) {
    // Inverts a cubic-bezier curve: given the desired EASED/spatial
    // progress (targetY), finds the TIME fraction at which the curve
    // produces it. Bisection on the curve parameter u (Y(u) is monotonic
    // for any valid CSS easing curve) rather than a closed-form cubic
    // solve — general-purpose, numerically robust, and precise enough
    // after 50 iterations that the result is exact to well beyond double
    // precision's useful range.
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (cubicBezierPoint(easing, mid).y < targetY) lo = mid; else hi = mid;
    }
    return cubicBezierPoint(easing, (lo + hi) / 2).x;
  }

  // The single, shared CSS string — every place that renders the slide
  // easing (keyframe animation, manual settle transitions) uses this exact
  // string, so they can never drift out of sync with each other or with
  // the flip-fraction calculation below.
  const SLIDE_EASING_CSS = `cubic-bezier(${SLIDE_EASING.x1},${SLIDE_EASING.y1},${SLIDE_EASING.x2},${SLIDE_EASING.y2})`;

  // Where the slide's SPATIAL midpoint (eased progress = 0.5) falls on the
  // TIME axis — ~0.35375 for cubic-bezier(.45,0,.16,1) (vs. 0.5 for the
  // old, wrong temporal-midpoint assumption). Computed once at module load.
  const A11Y_FLIP_TIME_FRACTION = timeFractionForEasedProgress(SLIDE_EASING, 0.5);

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
      // Current view list (keys from VIEW_REGISTRY, e.g. "range"/"scale"/
      // "extremes"); populated from data.views in _renderAll(), empty
      // before the first render so _hasAutoSlide()/_slideTiming() default
      // safely to "no rotator".
      this._views = [];
      // P1 fix (post-2.22.1): sibling to this._views, since data.views
      // alone can't distinguish a deliberately empty/collapsed view area
      // from one that's requested-but-unavailable — both resolve to views:
      // [] (see data.viewAreaCollapsed at _computeData()). Set alongside
      // this._views in _renderAll(), compared alongside it in _render().
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
      // Most recent view model, kept so the resize observer below can
      // re-resolve the optimal-label position without needing a fresh hass
      // update (see _resolveOptimalLabelPosition()).
      this._lastRenderData = null;
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
      // editor placeholders only — the card never falls back to default
      // entities at runtime (see _normalizeConfig()).
      return {
        entity: "sensor.wohnungstemperatur",
        rooms: [
          { name: "Küche", short: "KÜ", entity: "sensor.ku_temperatur" },
          { name: "Bad", short: "BA", entity: "sensor.ba_temperatur" },
          { name: "Schlafzimmer", short: "SZ", entity: "sensor.sz_temperatur" },
          { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_temperatur" },
          { name: "Wohnzimmer", short: "WZ", entity: "sensor.wz_temperatur" },
          { name: "Flur", short: "FL", entity: "sensor.fl_temperatur" },
          { name: "Gäste-WC", short: "WC", entity: "sensor.wc_temperatur" },
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
      // Validates views: against VIEW_REGISTRY once per setConfig() call
      // (i.e. once per actual config change) rather than inside
      // _computeData(), which runs on every hass update — logging there
      // would flood the console for a persistently misconfigured YAML
      // value. model is "everything available" here on purpose: only the
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
        VIEW_REGISTRY,
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
          this._resolveAllScaleLabelPositions(this._lastRenderData);
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
      // _computeData()). Extra chip rows (see _roomGridRows()) add to the
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
    // Validates and fills in the user configuration.
    _normalizeConfig(config) {
      const userConfig = config ?? {};
      if (!this._isPlainObject(userConfig)) {
        throw new Error("Invalid configuration: card configuration must be an object.");
      }

      // entity (average value) is the only required config field.
      const entity = this._requiredEntity(userConfig.entity, "entity");

      // rooms is optional; below two valid room values the card stays in
      // minimal mode (see _computeData()).
      const roomsInput = userConfig.rooms === undefined ? [] : userConfig.rooms;
      if (!Array.isArray(roomsInput)) {
        throw new Error("Invalid configuration: rooms must be an array.");
      }
      const rooms = roomsInput.map((room, index) => this._normalizeRoom(room, index));

      // Reviewer fix (P2, post-2.27.0): rooms[].entity is never checked for
      // uniqueness elsewhere, but _updateRoomGrid()'s keyed patching (AP-09)
      // maps chips by entity — a duplicate would silently overwrite one
      // node in that Map, leaving one room unpatched or two models fighting
      // over one chip. Rejected outright here, the same way a structurally
      // invalid room already is in _normalizeRoom(), rather than inventing
      // an occurrence-suffixed secondary key that _updateRoomGrid() would
      // have to special-case.
      const seenRoomEntities = new Set();
      for (const room of rooms) {
        if (seenRoomEntities.has(room.entity)) {
          throw new Error(`Invalid configuration: duplicate rooms[].entity "${room.entity}" — each room must reference a unique entity.`);
        }
        seenRoomEntities.add(room.entity);
      }

      // Optional daily-range/trend entities, e.g. from klima_metriken.yaml.
      const rangeEntity = this._optionalEntity(userConfig.range_entity, null, "range_entity");
      const trendEntity = this._optionalEntity(userConfig.trend_entity, null, "trend_entity");

      // Review fix (P1, post-2.21.1): _normalizeViewsConfig() now returns
      // its diagnostics alongside the normalized views array — see there
      // and _warnAboutViewConfigOnce().
      const { views, diagnostics: viewsDiagnostics } = this._normalizeViewsConfig(userConfig.views);
      const classification = this._normalizeClassificationConfig(userConfig.classification);

      return {
        entity,
        // Cosmetic/optional overrides (avg_label/title/icon/decimals/
        // hide_footer/rotation_seconds/slide_seconds/tap_action/hold_action):
        // a malformed value falls back to the previous default rather than
        // throwing, so a typo in an optional field can't break the whole
        // card the way a bad entity id would.
        avg_label: this._optionalString(userConfig.avg_label),
        title: this._optionalString(userConfig.title),
        icon: this._optionalString(userConfig.icon),
        decimals: this._normalizeDecimalsOverride(userConfig.decimals),
        // Optional manual override of the auto-detected HA language, e.g.
        // for translation debugging or when hass.language isn't the
        // desired one in a specific installation; "auto" (default) keeps
        // the existing automatic detection untouched (see _language()).
        language: this._normalizeLanguage(userConfig.language),
        hide_footer: userConfig.hide_footer === true,
        rotation_seconds: this._normalizePositiveSeconds(userConfig.rotation_seconds, DEFAULT_CONFIG.rotation_seconds, 1, 3600),
        slide_seconds: this._normalizePositiveSeconds(userConfig.slide_seconds, DEFAULT_CONFIG.slide_seconds, 0.1, 10),
        hold_seconds: DEFAULT_CONFIG.hold_seconds,
        // AP-C1 (audit 23.1): independent of each other -- auto_slide only
        // gates the automatic rotation timer (_hasAutoSlide()), swipe only
        // gates the manual horizontal drag gesture (_handlePointerDown()).
        // Both default true (today's behavior); either can be turned off
        // without affecting the other.
        auto_slide: userConfig.auto_slide !== false,
        swipe: userConfig.swipe !== false,
        tap_action: this._normalizeAction(userConfig.tap_action, DEFAULT_CONFIG.tap_action),
        hold_action: this._normalizeAction(userConfig.hold_action, DEFAULT_CONFIG.hold_action),
        // Optional room-chip grid override; null means "let _roomGridRows()
        // decide automatically" (see there).
        room_columns: this._normalizePositiveInteger(userConfig.room_columns),
        room_rows: this._normalizePositiveInteger(userConfig.room_rows),
        // AP-C2 (audit 23.1): room_sort is purely a presentation decision —
        // it only reorders the rendered chips (_computeData()'s `rooms`),
        // never the value-sorted `allRooms` that avg/extrema/comfort-count/
        // scale actually use. room_label picks between the existing
        // room.short/room.name pair per chip; "auto" is today's unchanged
        // behavior (always room.short). show_rooms:false hides the chip
        // grid only — rooms stay full data sources (data.hasRoomsView/
        // allRooms untouched, see data.showRoomChips in _computeData()).
        room_sort: this._normalizeEnum(userConfig.room_sort, ["configured", "name", "value_asc", "value_desc"], "value_asc"),
        room_label: this._normalizeEnum(userConfig.room_label, ["auto", "short", "name"], "auto"),
        show_rooms: userConfig.show_rooms !== false,
        // AP-04: views: is the single public view-composition surface,
        // resolved together with VIEW_REGISTRY's condition()/
        // defaultEnabled() by resolveActiveViews() (see there). null is the
        // "not configured at all" sentinel — resolveActiveViews() treats
        // that as "one auto entry per registry key, in registry order"
        // (today's default 1:1 behavior); a present-but-possibly-empty
        // array (after invalid entries are filtered, see
        // _normalizeViewsConfig()) is authoritative even when empty.
        // Unknown/duplicate view types (detected later, by
        // resolveActiveViews() itself) plus every diagnostic collected
        // here are all warned about together, once per setConfig() call
        // (see _warnAboutViewConfigOnce()), not thrown here, so a YAML
        // typo degrades to "ignored" rather than breaking the card.
        views,
        // Internal-only field (underscore prefix signals "not a YAML key")
        // carrying _normalizeViewsConfig()'s diagnostics forward to
        // _warnAboutViewConfigOnce(), which is the single place they're
        // actually surfaced (once per setConfig() call, not on every hass
        // update).
        _viewsDiagnostics: viewsDiagnostics,
        start_view: this._optionalString(userConfig.start_view),
        classification,
        rooms,
        range_entity: rangeEntity,
        trend_entity: trendEntity,
      };
    }

    _normalizeRoom(room, index) {
      // Converts one config room entry into an internal room object.
      if (!this._isPlainObject(room)) {
        throw new Error(`Invalid configuration: rooms[${index}] must be an object.`);
      }

      const entity = this._requiredEntity(room.entity, `rooms[${index}].entity`);
      const name = this._stringOrDefault(room.name, room.short || entity);
      const short = this._stringOrDefault(room.short, name || entity);

      return {
        name,
        short,
        entity,
        // Per-room action overrides; null means "inherit the card-level
        // tap_action/hold_action" (see _buildActionConfig()).
        tap_action: this._normalizeAction(room.tap_action, null),
        hold_action: this._normalizeAction(room.hold_action, null),
      };
    }

    _requiredEntity(value, name) {
      // Required entity id (e.g. rooms[i].entity or the average entity).
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid configuration: ${name} must be a non-empty entity id.`);
      }
      return value.trim();
    }

    _optionalEntity(value, fallback, name) {
      // Optional entity id with a fixed fallback (range_entity/trend_entity use null).
      if (value === undefined || value === null || value === "") {
        return fallback;
      }
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid configuration: ${name} must be an entity id string.`);
      }
      return value.trim();
    }

    _optionalString(value) {
      // Optional free-text override (avg_label/title/icon); a non-string or
      // empty value means "use the built-in default" rather than throwing.
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    _classificationConfigError(path, message) {
      throw new Error(`Invalid configuration: ${path} ${message}.`);
    }

    _assertClassificationKeys(value, allowed, path) {
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) this._classificationConfigError(`${path}.${key}`, "is not a supported option");
      }
    }

    _classificationNumber(value, path) {
      const parsed = this._parseConfigNumber(value);
      if (parsed === null) this._classificationConfigError(path, "must be a finite number");
      return parsed;
    }

    _normalizeClassificationBand(value, path, extraKeys = []) {
      if (!this._isPlainObject(value)) this._classificationConfigError(path, "must be an object");
      this._assertClassificationKeys(value, new Set(["min", "max", ...extraKeys]), path);
      const min = this._classificationNumber(value.min, `${path}.min`);
      const max = this._classificationNumber(value.max, `${path}.max`);
      if (min >= max) this._classificationConfigError(path, "must have min < max");
      return { min, max };
    }

    _normalizeCustomClassification(value) {
      const allowed = new Set(["source", "unit", "comparison", "bands", "scale", "tiers", "valid_range", "icons"]);
      this._assertClassificationKeys(value, allowed, "classification");

      if (typeof value.unit !== "string" || !value.unit.trim()) {
        this._classificationConfigError("classification.unit", "must be a recognized unit string");
      }
      const unitToken = normalizeUnitToken(value.unit);
      const metricKind = METRIC_TYPE_BY_UNIT[unitToken];
      if (!metricKind) this._classificationConfigError("classification.unit", `"${value.unit}" is not recognized`);
      const definition = METRIC_DEFINITIONS[metricKind];
      const sourceProfileKey = Object.keys(definition.unitProfiles).find((key) =>
        definition.unitProfiles[key].units.some((unit) => normalizeUnitToken(unit) === unitToken)
      );
      if (!sourceProfileKey) this._classificationConfigError("classification.unit", `"${value.unit}" has no registered UnitProfile`);
      const sourceUnitProfile = definition.unitProfiles[sourceProfileKey];

      const comparison = value.comparison ?? ">=";
      if (comparison !== ">=" && comparison !== ">") {
        this._classificationConfigError("classification.comparison", 'must be ">=" or ">"');
      }

      if (!this._isPlainObject(value.bands)) this._classificationConfigError("classification.bands", "must be an object");
      this._assertClassificationKeys(value.bands, new Set(["comfort", "optimal"]), "classification.bands");
      const sourceComfort = this._normalizeClassificationBand(value.bands.comfort, "classification.bands.comfort");
      const sourceOptimal = this._normalizeClassificationBand(value.bands.optimal, "classification.bands.optimal");
      if (sourceOptimal.min < sourceComfort.min || sourceOptimal.max > sourceComfort.max) {
        this._classificationConfigError("classification.bands.optimal", "must be fully contained in classification.bands.comfort");
      }

      if (!this._isPlainObject(value.scale)) this._classificationConfigError("classification.scale", "must be an object");
      this._assertClassificationKeys(value.scale, new Set(["min", "max", "step", "headroom", "one_sided"]), "classification.scale");
      const sourceScale = this._normalizeClassificationBand(value.scale, "classification.scale", ["step", "headroom", "one_sided"]);
      const sourceStep = this._classificationNumber(value.scale.step, "classification.scale.step");
      if (sourceStep <= 0) this._classificationConfigError("classification.scale.step", "must be greater than zero");
      if (sourceScale.min > sourceComfort.min || sourceScale.max < sourceComfort.max) {
        this._classificationConfigError("classification.scale", "must fully contain the comfort and optimal bands");
      }
      const sourceHeadroom = value.scale.headroom === undefined
        ? null
        : this._classificationNumber(value.scale.headroom, "classification.scale.headroom");
      if (sourceHeadroom !== null && sourceHeadroom < 0) {
        this._classificationConfigError("classification.scale.headroom", "must be zero or greater");
      }
      if (value.scale.one_sided !== undefined && typeof value.scale.one_sided !== "boolean") {
        this._classificationConfigError("classification.scale.one_sided", "must be a boolean");
      }

      if (!Array.isArray(value.tiers) || value.tiers.length === 0) {
        this._classificationConfigError("classification.tiers", "must be a non-empty array");
      }
      const zones = new Set(CLASSIFICATION_ZONES);
      let defaultCount = 0;
      let previousMin = Infinity;
      const sourceTiers = value.tiers.map((tier, index) => {
        const path = `classification.tiers[${index}]`;
        if (!this._isPlainObject(tier)) this._classificationConfigError(path, "must be an object");
        this._assertClassificationKeys(tier, new Set(["min", "default", "score", "level", "color", "zone"]), path);
        const isDefault = tier.default === true;
        if (tier.default !== undefined && tier.default !== true) {
          this._classificationConfigError(`${path}.default`, "must be true when present");
        }
        if (isDefault) {
          defaultCount += 1;
          if (index !== value.tiers.length - 1) this._classificationConfigError(path, "default tier must be the final tier");
          if (tier.min !== undefined) this._classificationConfigError(`${path}.min`, "must be omitted on the default tier");
        } else if (tier.min === undefined) {
          this._classificationConfigError(`${path}.min`, "is required for every non-default tier");
        }

        const min = isDefault ? -Infinity : this._classificationNumber(tier.min, `${path}.min`);
        if (!isDefault && min >= previousMin) {
          this._classificationConfigError("classification.tiers", "must use unique min values in strictly descending order");
        }
        previousMin = min;
        const score = this._classificationNumber(tier.score, `${path}.score`);
        if (typeof tier.level !== "string" || !tier.level.trim()) {
          this._classificationConfigError(`${path}.level`, "must be a non-empty string");
        }
        if (typeof tier.color !== "string" || !HEX_COLOR_PATTERN.test(tier.color.trim())) {
          this._classificationConfigError(`${path}.color`, "must be a 3/4/6/8-digit hex color");
        }
        if (!zones.has(tier.zone)) {
          const quoted = CLASSIFICATION_ZONES.map((zone) => `"${zone}"`);
          const list = `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
          this._classificationConfigError(`${path}.zone`, `must be one of ${list}`);
        }
        return {
          min,
          score,
          level: tier.level.trim(),
          color: tier.color.trim(),
          zone: tier.zone,
        };
      });
      if (defaultCount !== 1) this._classificationConfigError("classification.tiers", "must contain exactly one final default tier");

      let sourceValidRange = null;
      if (value.valid_range !== undefined) {
        if (!this._isPlainObject(value.valid_range)) this._classificationConfigError("classification.valid_range", "must be an object");
        this._assertClassificationKeys(value.valid_range, new Set(["min", "max", "min_inclusive", "max_inclusive"]), "classification.valid_range");
        if (value.valid_range.min === undefined && value.valid_range.max === undefined) {
          this._classificationConfigError("classification.valid_range", "must define min and/or max");
        }
        for (const key of ["min_inclusive", "max_inclusive"]) {
          if (value.valid_range[key] !== undefined && typeof value.valid_range[key] !== "boolean") {
            this._classificationConfigError(`classification.valid_range.${key}`, "must be a boolean");
          }
        }
        sourceValidRange = {
          min: value.valid_range.min === undefined ? null : this._classificationNumber(value.valid_range.min, "classification.valid_range.min"),
          max: value.valid_range.max === undefined ? null : this._classificationNumber(value.valid_range.max, "classification.valid_range.max"),
          minInclusive: value.valid_range.min_inclusive !== false,
          maxInclusive: value.valid_range.max_inclusive !== false,
        };
        if (sourceValidRange.min !== null && sourceValidRange.max !== null && sourceValidRange.min >= sourceValidRange.max) {
          this._classificationConfigError("classification.valid_range", "must have min < max");
        }
      }

      let sourceIcons = null;
      if (value.icons !== undefined) {
        if (metricKind !== "temperature") {
          this._classificationConfigError("classification.icons", "is supported only for temperature profiles");
        }
        if (!this._isPlainObject(value.icons)) this._classificationConfigError("classification.icons", "must be an object");
        this._assertClassificationKeys(value.icons, new Set(["fire", "high", "normal", "low"]), "classification.icons");
        sourceIcons = {};
        let previous = Infinity;
        for (const key of ["fire", "high", "normal", "low"]) {
          const threshold = this._classificationNumber(value.icons[key], `classification.icons.${key}`);
          if (threshold >= previous) this._classificationConfigError("classification.icons", "must descend from fire to low");
          previous = threshold;
          sourceIcons[key] = threshold;
        }
      } else if (metricKind === "temperature") {
        sourceIcons = {
          fire: sourceScale.max,
          high: sourceComfort.max,
          normal: sourceComfort.min,
          low: sourceScale.min,
        };
      }

      const toCanonical = sourceUnitProfile.toCanonical;
      const deltaToCanonical = sourceUnitProfile.deltaToCanonical;
      const convertBand = (band) => ({ min: toCanonical(band.min), max: toCanonical(band.max) });
      const canonicalValidRange = sourceValidRange && {
        min: sourceValidRange.min === null ? null : toCanonical(sourceValidRange.min),
        max: sourceValidRange.max === null ? null : toCanonical(sourceValidRange.max),
        minInclusive: sourceValidRange.minInclusive,
        maxInclusive: sourceValidRange.maxInclusive,
      };
      const invalidWhen = canonicalValidRange
        ? (reading) =>
            (canonicalValidRange.min !== null && (canonicalValidRange.minInclusive ? reading < canonicalValidRange.min : reading <= canonicalValidRange.min)) ||
            (canonicalValidRange.max !== null && (canonicalValidRange.maxInclusive ? reading > canonicalValidRange.max : reading >= canonicalValidRange.max))
        : null;

      return {
        id: "custom",
        metricKind,
        comparison,
        tiers: sourceTiers.map((tier) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min) : tier.min })),
        comfort: convertBand(sourceComfort),
        optimal: convertBand(sourceOptimal),
        scale: convertBand(sourceScale),
        step: deltaToCanonical(sourceStep),
        headroom: sourceHeadroom === null ? undefined : deltaToCanonical(sourceHeadroom),
        oneSided: value.scale.one_sided === true,
        invalidWhen,
        validRange: canonicalValidRange,
        invalidClassification: { score: null, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
        iconThresholds: sourceIcons && Object.fromEntries(
          Object.entries(sourceIcons).map(([key, threshold]) => [key, toCanonical(threshold)])
        ),
      };
    }

    _normalizeClassificationConfig(value) {
      if (value === undefined || value === null || value === "") {
        return { source: "auto", profile: null, custom: null };
      }
      if (typeof value === "string") {
        const shorthand = value.trim().toLowerCase();
        if (!shorthand) return { source: "auto", profile: null, custom: null };
        if (shorthand === "auto" || shorthand === "entity") {
          return { source: shorthand, profile: null, custom: null };
        }
        if (shorthand === "profile" || shorthand === "custom") {
          this._classificationConfigError("classification", `"${shorthand}" requires the object form`);
        }
        return { source: "auto", profile: shorthand, custom: null };
      }
      if (!this._isPlainObject(value)) this._classificationConfigError("classification", "must be a string or object");

      const inferredSource = value.source ?? (value.tiers !== undefined ? "custom" : "auto");
      if (!["auto", "entity", "profile", "custom"].includes(inferredSource)) {
        this._classificationConfigError("classification.source", 'must be "auto", "entity", "profile", or "custom"');
      }
      if (inferredSource === "custom") {
        return { source: "custom", profile: null, custom: this._normalizeCustomClassification(value) };
      }

      this._assertClassificationKeys(value, new Set(["source", "profile"]), "classification");
      if (inferredSource === "entity" && value.profile !== undefined) {
        this._classificationConfigError("classification.profile", "cannot be combined with source entity");
      }
      const profile = value.profile === undefined ? null : this._optionalString(value.profile);
      if (value.profile !== undefined && !profile) {
        this._classificationConfigError("classification.profile", "must be a non-empty string");
      }
      return { source: inferredSource, profile: profile?.toLowerCase() ?? null, custom: null };
    }

    _normalizeViewsConfig(value) {
      // Review fix (P1, post-2.21.1, audit 14.3-14.5): a non-array value,
      // an unparseable list entry, or an invalid enabled: value used to
      // fall back to a default silently, with no trace left behind for the
      // user to discover the typo. Every such case is now collected into a
      // `diagnostics` array alongside the normalized `views`, so
      // _warnAboutViewConfigOnce() (see there) can surface it exactly once
      // per setConfig() call — without changing the non-destructive
      // fallback behavior itself (a malformed views: config still degrades
      // to "ignored"/"auto", it just no longer does so invisibly).
      //
      // `undefined`/`null` (views: genuinely omitted from the YAML) is NOT
      // diagnosed — that's the normal "not configured" case, resolved by
      // resolveActiveViews() as "one auto entry per registry key". Any
      // OTHER non-array value (a string, number, plain object, ...) is a
      // real misconfiguration and IS diagnosed, then normalizes to the same
      // null sentinel.
      if (!Array.isArray(value)) {
        if (value === undefined || value === null) return { views: null, diagnostics: [] };
        return { views: null, diagnostics: [`views: expected an array, got ${JSON.stringify(value)}`] };
      }
      const views = [];
      const diagnostics = [];
      value.forEach((entry, index) => {
        const { request, diagnostics: entryDiagnostics } = this._normalizeViewRequest(entry, index);
        diagnostics.push(...entryDiagnostics);
        if (request) views.push(request);
      });
      return { views, diagnostics };
    }

    _normalizeViewRequest(entry, index) {
      // One views: list entry: a bare non-empty string is shorthand for
      // {type, enabled:true} (audit 11.1's "String- und Objektform"); an
      // object needs at least a non-empty `type`. An entry with no
      // resolvable type at all (neither a non-empty string nor an object
      // with one) is dropped — `request: null` — WITH a diagnostic, unlike
      // the previous silent drop.
      //
      // `enabled`: listing a view is itself an explicit request, regardless
      // of whether the user chose string or object syntax. Therefore an
      // omitted field normalizes to true; only an explicitly written
      // "auto" delegates to the view's own defaultEnabled(). Any OTHER value
      // (a typo like "yes", a stray 1,
      // explicit null, ...) is diagnosed but — deliberately, per the
      // reviewer's explicit non-destructive requirement — still falls back
      // to "auto" rather than dropping the whole entry: a typo in enabled:
      // must not make a view disappear as completely as an unknown type
      // would.
      //
      // `options`: normalized through _normalizeViewOptions()'s registry
      // whitelist (audit 14.4) instead of only being structurally checked —
      // see there.
      if (typeof entry === "string") {
        const type = entry.trim();
        if (!type) return { request: null, diagnostics: [`views[${index}]: expected a non-empty string or an object`] };
        return { request: { type, enabled: true, options: {} }, diagnostics: [] };
      }
      if (!this._isPlainObject(entry)) {
        return { request: null, diagnostics: [`views[${index}]: expected a string or an object, got ${JSON.stringify(entry)}`] };
      }
      const type = this._optionalString(entry.type);
      if (!type) {
        return { request: null, diagnostics: [`views[${index}]: missing or invalid "type"`] };
      }
      const diagnostics = [];
      let enabled;
      if (entry.enabled === true || entry.enabled === false) {
        enabled = entry.enabled;
      } else if (entry.enabled === undefined) {
        enabled = true;
      } else if (entry.enabled === "auto") {
        enabled = "auto";
      } else {
        enabled = "auto";
        diagnostics.push(`views[${index}] ("${type}"): invalid "enabled" value ${JSON.stringify(entry.enabled)}, falling back to "auto"`);
      }
      const { options, diagnostics: optionsDiagnostics } = this._normalizeViewOptions(type, entry.options, index);
      diagnostics.push(...optionsDiagnostics);
      return { request: { type, enabled, options }, diagnostics };
    }

    _normalizeViewOptions(type, rawOptions, index) {
      // Review fix (P1, post-2.21.1, audit 14.4): views:[i].options used to
      // pass through with only a structural (plain-object) check — never
      // filtered against anything, so a view's renderer/styles could end up
      // trusting arbitrary user-supplied keys. Every VIEW_REGISTRY entry
      // declares an optionsSchema (see there for each view's actual
      // options) — only keys present in that whitelist survive; everything
      // else is stripped, exactly like an unknown YAML key elsewhere in
      // this card.
      //
      // P1 follow-up fix (post-2.22.1): stripping used to be silent — no
      // trace left behind, unlike every other malformed views: field in
      // this file (invalid "enabled", unparseable entries, ...). Unknown
      // keys and a genuinely invalid (non-object, non-omitted) options:
      // value are now diagnosed too, non-destructively (the filtered
      // options themselves are unchanged). undefined/null (options: simply
      // not provided) is deliberately NOT diagnosed — the same "not
      // configured is normal" convention _normalizeViewsConfig() already
      // applies to views: itself being omitted.
      //
      // Teil 2 (view-customizer Baukasten): a known key's VALUE is now also
      // validated when its schema entry declares a validate() (boolOption()
      // and friends) — a schema value used to be a bare presence-marker, so
      // no view had value validation before this round; a key with no
      // validate() (still possible for a future non-boolean option) simply
      // isn't checked, same as before. An invalid value is diagnosed and
      // dropped from the result — resolveViewOptions() then fills in the
      // schema default for it, the same non-destructive fallback already
      // established for an invalid "enabled".
      const descriptor = VIEW_REGISTRY.find((v) => v.key === type);
      const schema = descriptor?.optionsSchema || {};
      if (rawOptions === undefined || rawOptions === null) return { options: {}, diagnostics: [] };
      if (!this._isPlainObject(rawOptions)) {
        return { options: {}, diagnostics: [`views[${index}] ("${type}"): invalid "options" value ${JSON.stringify(rawOptions)}, expected an object`] };
      }
      const result = {};
      const unknownKeys = [];
      const diagnostics = [];
      for (const key of Object.keys(rawOptions)) {
        if (!Object.prototype.hasOwnProperty.call(schema, key)) {
          unknownKeys.push(key);
          continue;
        }
        const value = rawOptions[key];
        const validate = schema[key].validate;
        if (typeof validate === "function" && !validate(value)) {
          diagnostics.push(`views[${index}] ("${type}"): invalid "${key}" value ${JSON.stringify(value)}, falling back to default`);
          continue;
        }
        result[key] = value;
      }
      if (unknownKeys.length) {
        diagnostics.push(`views[${index}] ("${type}"): ignoring unknown "options" key(s) ${unknownKeys.map((k) => JSON.stringify(k)).join(", ")}`);
      }
      return { options: result, diagnostics };
    }

    _normalizeEnum(value, allowedValues, defaultValue) {
      // Generic closed-set config value: an unrecognized value silently
      // falls back to defaultValue, the same non-warning convention every
      // other optional top-level field already uses (decimals,
      // room_columns, ... — only views:[] diagnostics ever console.warn,
      // see _warnAboutViewConfigOnce()) — a typo degrades to "use the
      // default" rather than breaking the card.
      return allowedValues.includes(value) ? value : defaultValue;
    }

    _normalizeLanguage(value) {
      // Optional language override; "auto" (the default for anything
      // invalid/missing) means "keep using hass's automatic detection" —
      // see _language(). Only accepts one of the languages TRANSLATIONS
      // actually has a block for, so an override can never silently
      // select a language that would just fall back to English anyway.
      if (typeof value !== "string") return "auto";
      const normalized = value.trim().toLowerCase();
      if (normalized === "" || normalized === "auto") return "auto";
      return Object.prototype.hasOwnProperty.call(TRANSLATIONS, normalized) ? normalized : "auto";
    }

    _parseConfigNumber(value) {
      // Strict shared numeric parser for optional cosmetic/layout config
      // fields: only an actual `number` or a numeric-looking string is
      // accepted. Number(value) alone would silently coerce booleans
      // (Number(true) === 1) and other unintended types through, letting a
      // typo'd YAML value like `room_columns: true` or `decimals: true`
      // pass as a valid 1 instead of being rejected. Returns null for
      // anything else (including non-finite results); callers apply their
      // own range checks on top.
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value !== "string") return null;
      const text = value.trim();
      if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
      const num = Number(text);
      return Number.isFinite(num) ? num : null;
    }

    _normalizeDecimalsOverride(value) {
      // Optional decimals override (0-2); anything else means "use the
      // mode's default from METRIC_META" (see _fmt()).
      if (value === undefined || value === null || value === "") return null;
      const num = this._parseConfigNumber(value);
      return num !== null && Number.isInteger(num) && num >= 0 && num <= 2 ? num : null;
    }

    _normalizePositiveInteger(value) {
      // Optional room_columns/room_rows override; anything invalid — not a
      // positive integer, or an unreasonably large value that couldn't
      // possibly be a deliberate layout choice — means "let
      // _roomGridRows() decide automatically" rather than throwing or
      // building an absurdly large grid.
      if (value === undefined || value === null || value === "") return null;
      const num = this._parseConfigNumber(value);
      return num !== null && Number.isInteger(num) && num >= 1 && num <= 20 ? num : null;
    }

    _normalizePositiveSeconds(value, fallback, min, max) {
      // rotation_seconds/slide_seconds: an invalid, missing, or out-of-
      // range value falls back to the previous hardcoded default (14/1)
      // instead of throwing — this only affects cosmetic timing, not
      // correctness. min/max are practical per-field bounds (see call
      // sites) — without an upper bound, an extreme value could overflow
      // the animation-duration/setTimeout millisecond math it feeds into.
      const num = this._parseConfigNumber(value);
      return num !== null && num >= min && num <= max ? num : fallback;
    }

    _normalizeAction(value, fallback) {
      // Validates a tap_action/hold_action object against ACTION_ALLOWLIST;
      // an invalid/missing value falls back to `fallback` (a card-level
      // default, or null for a per-room override that should inherit the
      // card-level action) instead of being passed through raw.
      if (this._isPlainObject(value) && typeof value.action === "string" && ACTION_ALLOWLIST.has(value.action)) {
        return { ...value };
      }
      return fallback ? { ...fallback } : null;
    }

    _stringOrDefault(value, fallback) {
      // String helper for optional display names.
      if (value === undefined || value === null || value === "") {
        return String(fallback ?? "");
      }
      return String(value);
    }

    _isPlainObject(value) {
      // Strict object check: arrays don't count as a config object.
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    // ==== Classification, colors, icons ====
    _resolveClassificationProfile(metricType, { lenient = false } = {}) {
      // lenient (P1 review fix, post-2.30.0): _buildEntityModel() must probe
      // every room's OWN metric kind before AP-02's kind-based filtering has
      // run, so at that point a card-wide classification.profile/custom
      // scoped to a DIFFERENT kind (e.g. classification: outdoor on a
      // temperature card, probed here for an incidental humidity room) is
      // not yet known to be irrelevant. Falling back to this kind's own
      // default profile instead of throwing lets that later kind filter
      // (excluded_foreign_metric_kind) do its job. The strict throw below
      // stays intact for every other caller (always invoked with the
      // card's actually-resolved metric kind), so a genuine mismatch
      // between the primary entity's own kind and the configured profile
      // still surfaces as the documented config error.
      const registry = CLASSIFICATION_PROFILE_REGISTRY[metricType];
      if (!registry) throw new Error(`No classification profiles registered for metric kind "${metricType}"`);
      const policy = this._config?.classification || { source: "auto", profile: null, custom: null };
      if (policy.source === "custom") {
        if (policy.custom.metricKind !== metricType) {
          if (lenient) return registry.profiles[registry.defaultProfile];
          throw new Error(
            `Invalid configuration: custom classification unit belongs to "${policy.custom.metricKind}", not detected metric kind "${metricType}".`
          );
        }
        return policy.custom;
      }
      const profileId = policy.profile || registry.defaultProfile;
      const profile = registry.profiles[profileId];
      if (!profile) {
        if (lenient) return registry.profiles[registry.defaultProfile];
        throw new Error(`Invalid configuration: classification profile "${profileId}" is not available for metric kind "${metricType}".`);
      }
      return profile;
    }

    _classificationProfileForDisplay(metricType, unitProfile) {
      const canonical = this._resolveClassificationProfile(metricType);
      const definition = METRIC_DEFINITIONS[metricType];
      const displayProfile = unitProfile || definition.unitProfiles[definition.canonicalProfileKey];
      if (displayProfile.key === definition.canonicalProfileKey) return canonical;

      const projectAbsolute = (value) => {
        const converted = displayProfile.fromCanonical(value);
        return (displayProfile.thresholdRounding || ((v) => v))(converted);
      };
      const projectBand = (band) => ({ min: projectAbsolute(band.min), max: projectAbsolute(band.max) });
      const projectedValidRange = canonical.validRange && {
        min: canonical.validRange.min === null ? null : projectAbsolute(canonical.validRange.min),
        max: canonical.validRange.max === null ? null : projectAbsolute(canonical.validRange.max),
        minInclusive: canonical.validRange.minInclusive,
        maxInclusive: canonical.validRange.maxInclusive,
      };
      const invalidWhen = projectedValidRange
        ? (reading) =>
            (projectedValidRange.min !== null && (projectedValidRange.minInclusive ? reading < projectedValidRange.min : reading <= projectedValidRange.min)) ||
            (projectedValidRange.max !== null && (projectedValidRange.maxInclusive ? reading > projectedValidRange.max : reading >= projectedValidRange.max))
        : canonical.invalidWhen;

      const projected = {
        ...canonical,
        tiers: canonical.tiers.map((tier) => ({
          ...tier,
          min: Number.isFinite(tier.min) ? projectAbsolute(tier.min) : tier.min,
        })),
        comfort: projectBand(canonical.comfort),
        optimal: projectBand(canonical.optimal),
        scale: projectBand(canonical.scale),
        step: displayProfile.deltaFromCanonical(canonical.step),
        headroom: canonical.headroom === undefined ? undefined : displayProfile.deltaFromCanonical(canonical.headroom),
        invalidWhen,
        validRange: projectedValidRange,
        iconThresholds: canonical.iconThresholds && Object.fromEntries(
          Object.entries(canonical.iconThresholds).map(([key, threshold]) => [key, projectAbsolute(threshold)])
        ),
        iconTiers: canonical.iconTiers?.map((tier) => ({
          ...tier,
          min: Number.isFinite(tier.min) ? projectAbsolute(tier.min) : tier.min,
        })),
      };
      this._assertProjectedClassificationGeometry(canonical, projected, metricType, displayProfile);
      return projected;
    }

    _assertProjectedClassificationGeometry(canonical, projected, metricType, displayProfile) {
      // P2 review fix (post-2.30.0): projectAbsolute() above rounds each
      // boundary independently (thresholdRounding, e.g. Math.round for
      // Fahrenheit). Rounding is order-preserving but not injective — two
      // canonical values that are still distinct in Celsius can round to
      // the SAME display value, collapsing a band to zero width or making
      // a tier permanently unreachable (_classifyNumericValue() compares
      // against these exact projected/rounded numbers, so a collapse is a
      // real classification bug, not just a cosmetic one). Every property
      // checked here is GUARANTEED in the canonical profile already (see
      // _normalizeCustomClassification() for custom profiles, the
      // hand-authored CLASSIFICATION_PROFILE_REGISTRY entries for built-in
      // ones) — this only catches a collapse that ROUNDING introduced, it
      // never rejects something the canonical profile itself already
      // allowed. Built-in profiles never trigger this in practice (their
      // gaps are always >=1 °C, well above the ~0.56 °C needed to survive
      // integer Fahrenheit rounding); it exists for custom profiles with
      // narrow, freely-configured gaps.
      const unitLabel = displayProfile.displayUnit || displayProfile.key;
      const fail = (detail) => {
        throw new Error(
          `Invalid configuration: classification profile for "${metricType}" becomes degenerate when rounded to ${unitLabel} (${detail}) — configure wider gaps, or set classification.unit to "${unitLabel}" directly to avoid rounding.`
        );
      };
      if (!(projected.comfort.min < projected.comfort.max)) fail("comfort band collapses");
      if (!(projected.optimal.min < projected.optimal.max)) fail("optimal band collapses");
      if (!(projected.scale.min < projected.scale.max)) fail("scale collapses");
      for (let i = 1; i < canonical.tiers.length; i++) {
        const wasDescending = Number.isFinite(canonical.tiers[i - 1].min) && Number.isFinite(canonical.tiers[i].min)
          && canonical.tiers[i].min < canonical.tiers[i - 1].min;
        if (!wasDescending) continue;
        if (!(projected.tiers[i].min < projected.tiers[i - 1].min)) {
          fail(`tier thresholds collapse near ${projected.tiers[i].min}${unitLabel}`);
        }
      }
      if (projected.iconThresholds) {
        const order = ["fire", "high", "normal", "low"];
        for (let i = 1; i < order.length; i++) {
          const prevKey = order[i - 1];
          const curKey = order[i];
          if (!(canonical.iconThresholds[curKey] < canonical.iconThresholds[prevKey])) continue;
          if (!(projected.iconThresholds[curKey] < projected.iconThresholds[prevKey])) {
            fail(`icon thresholds collapse near ${projected.iconThresholds[curKey]}${unitLabel}`);
          }
        }
      }
    }

    _getEntityClassification(entityId, { allowPartial = false } = {}) {
      // Reads value_color/value_level/value_score/value_zone from HA entity
      // attributes (see raumklima_classification.jinja). Automatic mode
      // accepts the source only as a complete, valid color+level pair; the
      // deliberately forced entity mode may request its partial metadata.
      if (!entityId || !this._hass?.states?.[entityId]) return null;
      const attrs = this._hass.states[entityId].attributes;
      // value_color must match HEX_COLOR_PATTERN — it ends up in CSS/style
      // attributes further down the render pipeline, so anything else is
      // treated as absent rather than trusted verbatim.
      const color = typeof attrs.value_color === "string" && HEX_COLOR_PATTERN.test(attrs.value_color.trim())
        ? attrs.value_color.trim()
        : null;
      const level = typeof attrs.value_level === "string" && attrs.value_level.trim()
        ? attrs.value_level.trim()
        : null;
      const numericScore = Number(attrs.value_score);
      const score = attrs.value_score !== undefined && attrs.value_score !== null && attrs.value_score !== "" && Number.isFinite(numericScore)
        ? numericScore
        : null;
      const zone = typeof attrs.value_zone === "string" && attrs.value_zone.trim() ? attrs.value_zone.trim() : null;
      if (allowPartial ? (!color && !level && score === null && !zone) : (!color || !level)) return null;
      return {
        color,
        level,
        score,
        zone,
        source: "entity",
        profileId: null,
      };
    }

    _resolveValueClassification(value, entityId, metricType, unitProfile) {
      const policy = this._config?.classification || { source: "auto", profile: null, custom: null };
      if (policy.source === "entity") {
        const entity = this._getEntityClassification(entityId, { allowPartial: true });
        return {
          color: entity?.color || "#B4B2A9",
          level: entity?.level || "—",
          score: entity?.score ?? null,
          zone: entity?.zone ?? null,
          source: "entity",
          profileId: null,
        };
      }
      if (policy.source === "auto") {
        const entity = this._getEntityClassification(entityId);
        if (entity) return entity;
      }
      const numeric = this._classifyNumericValue(value, metricType, unitProfile);
      const profile = this._resolveClassificationProfile(metricType);
      return {
        ...numeric,
        source: profile.id === "custom" ? "custom" : "builtin",
        profileId: profile.id,
      };
    }

    _temperatureIconForProfile(temp, unitProfile) {
      const thresholds = this._classificationProfileForDisplay("temperature", unitProfile).iconThresholds;
      if (temp >= thresholds.fire) return "mdi:fire-alert";
      if (temp >= thresholds.high) return "mdi:thermometer-high";
      if (temp >= thresholds.normal) return "mdi:thermometer";
      if (temp >= thresholds.low) return "mdi:thermometer-low";
      return "mdi:snowflake";
    }

    _profileIconForValue(value, metricType, unitProfile) {
      // Header icons are part of the active classification profile, just
      // like colors and labels. Temperature retains its public/custom
      // fire/high/normal/low threshold contract; the other metric kinds use
      // generic descending icon tiers. A metric without icon tiers keeps its
      // stable METRIC_META icon, so adding another kind never requires a
      // forced or semantically dubious icon family.
      if (metricType === "temperature") return this._temperatureIconForProfile(value, unitProfile);
      const profile = this._classificationProfileForDisplay(metricType, unitProfile);
      const tier = profile.iconTiers?.find((candidate) =>
        profile.comparison === ">" ? value > candidate.min : value >= candidate.min
      );
      return tier?.icon || this._metricMetaFor(metricType).icon;
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
      // ping-pong straight through data.views/this._views in their actual
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

    // ==== Formatting, numeric/attribute helpers, i18n ====
    _hasEntity(entityId) {
      // Whether the entity exists in the current hass.states object.
      return Boolean(entityId && this._hass?.states?.[entityId]);
    }

    _parseNum(raw) {
      // Shared numeric parser for _getNum()/_getAttrNum(): accepts comma
      // decimals, treats HA's non-numeric states as invalid, and handles
      // attributes HA already delivers as a real number instead of a string.
      // Validates the full (normalized) string against a strict numeric
      // format before parsing, rather than handing it straight to
      // parseFloat() — parseFloat() happily extracts a numeric prefix from
      // garbage like "25 °C" or "12abc", which would silently legitimize a
      // malformed/corrupted sensor value instead of treating it as invalid.
      if (raw === undefined || raw === null) return null;
      const rawString = String(raw).trim().toLowerCase();
      if (INVALID_STATES.has(rawString)) return null;
      const normalized = rawString.replace(",", ".");
      if (!/^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/.test(normalized)) return null;
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    }

    _getNum(entityId) {
      // Reads a numeric sensor value from the entity's state.
      if (!entityId) return null;
      return this._parseNum(this._hass?.states?.[entityId]?.state);
    }

    _getAttrNum(entityId, attrName) {
      // Reads a numeric value from an entity attribute (e.g. spread, minimum, maximum).
      if (!entityId || !attrName) return null;
      return this._parseNum(this._hass?.states?.[entityId]?.attributes?.[attrName]);
    }

    _language() {
      // Base language code (e.g. "de" from "de-AT"), checked against
      // TRANSLATIONS. An explicit config.language override (see
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
      let value;
      if (configLanguage && configLanguage !== "auto") {
        value = configLanguage;
      } else {
        const raw = this._hass?.locale?.language || this._hass?.language || this._hass?.selectedLanguage || DEFAULT_LANGUAGE;
        const base = String(raw).toLowerCase().split("-")[0];
        value = TRANSLATIONS[base] ? base : DEFAULT_LANGUAGE;
      }
      this._languageCacheHass = this._hass;
      this._languageCacheConfigLanguage = configLanguage;
      this._languageCacheValue = value;
      return value;
    }

    _t(key, vars) {
      // Translates key in the current language, falling back to
      // DEFAULT_LANGUAGE and finally the key itself; values may be
      // functions (pluralization/conditionals) or plain strings.
      const entry = TRANSLATIONS[this._language()]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE]?.[key] ?? key;
      return typeof entry === "function" ? entry(vars || {}) : entry;
    }

    _metricMetaFor(metricType) {
      // Shared fallback: unknown/missing metric types resolve to temperature.
      return METRIC_META[metricType] || METRIC_META.temperature;
    }

    _resolveTrendPolicy(metricType) {
      // Single policy-resolution seam. Today it resolves registry defaults;
      // a later release can layer validated YAML or trend-entity attributes
      // here without coupling configuration concerns into classification,
      // data conversion, or rendering.
      return TREND_POLICY_REGISTRY[metricType] || null;
    }

    _buildTrendModel(metricType, canonicalValue, displayValue, displayUnit) {
      const policy = this._resolveTrendPolicy(metricType);
      const direction = classifyTrendRate(canonicalValue, policy);
      const directionMeta = direction ? TREND_DIRECTION_META[direction] : null;
      if (!directionMeta || !Number.isFinite(displayValue) || !displayUnit) return null;
      return {
        canonicalValue,
        value: displayValue,
        unit: displayUnit,
        direction,
        directionTranslationKey: directionMeta.translationKey,
        policy,
      };
    }

    _trendDisplayText(trend) {
      if (!trend) return "";
      const value = Object.is(trend.value, -0) ? 0 : trend.value;
      const sign = value > 0 ? "+" : "";
      return `${sign}${this._fmt(value)} ${trend.unit}`;
    }

    _trendAriaLabel(trend) {
      if (!trend) return "";
      return this._t("trend.aria", {
        direction: this._t(trend.directionTranslationKey),
        value: this._trendDisplayText(trend),
      });
    }

    _averageTooltip(data) {
      const tooltipKey = data.avgSource === "sensor" ? "avg.tooltip" : "avg.tooltipCalculated";
      return this._t(tooltipKey, { value: this._fmtWithUnit(data.avg), label: data.avgLabel });
    }

    _averageAriaLabel(data, tooltip = this._averageTooltip(data)) {
      const base = data.avgEntity ? this._t("avg.ariaOpen") : tooltip;
      return data.trend ? `${base}. ${this._trendAriaLabel(data.trend)}` : base;
    }

    _autoRoomColumnsFor(metricType) {
      // Max chips per row in fully automatic room-grid mode (no room_columns/
      // room_rows override) — see _roomGridRows(). Kept conservative enough
      // that a chip's number+unit never needs to shrink to fit.
      return this._metricMetaFor(metricType).autoRoomColumns || 7;
    }

    _extremeRoomLabel(type, metricType) {
      // Translated label for the coldest/warmest-equivalent room (extreme
      // cards, scale marker tooltips): "type" is "cold" or "warm", but the
      // wording itself is mode-dependent (e.g. "driest room" for humidity).
      const meta = this._metricMetaFor(metricType);
      return this._t(type === "cold" ? meta.lowRoomKey : meta.highRoomKey);
    }

    _metricMeta() {
      return this._metricMetaFor(this._metricType());
    }

    _scaleConfigFor(metricType, unitProfile) {
      const profile = this._classificationProfileForDisplay(metricType, unitProfile);
      return {
        comfort: profile.comfort,
        optimal: profile.optimal,
        scale: profile.scale,
        step: profile.step,
        oneSided: profile.oneSided === true,
        headroom: profile.headroom,
        anchorScale: profile.anchorScale !== false,
      };
    }

    _floorToStep(value, step) {
      return Math.floor(value / step) * step;
    }

    _ceilToStep(value, step) {
      return Math.ceil(value / step) * step;
    }

    _fmt(value, digits) {
      const d = digits ?? this._config.decimals ?? this._metricMeta().decimals;
      return getNumberFormat(NUMBER_LOCALE_BY_LANGUAGE[this._language()], d).format(Number(value));
    }

    _formatTime(isoString) {
      // Formats an ISO timestamp as local "HH:MM" (hour12:false keeps this
      // consistent across languages); null for a missing/invalid timestamp.
      if (typeof isoString !== "string" || !isoString.trim()) return null;
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime())) return null;
      return getTimeFormat(NUMBER_LOCALE_BY_LANGUAGE[this._language()]).format(date);
    }

    _rawUnitForEntity(entityId) {
      // Reads one entity's own unit_of_measurement with no mode fallback —
      // the generic, entity-agnostic counterpart to _metricTypeForEntity(),
      // used by _resolveMetricContext() so metricType and unit are always
      // read from the SAME entity (DATA-01).
      const entityUnit = this._hass?.states?.[entityId]?.attributes?.unit_of_measurement;
      return typeof entityUnit === "string" && entityUnit.trim() ? entityUnit.trim() : null;
    }

    _resolveUnitProfileKey(metricKind, rawUnit) {
      // Maps one entity's own raw unit_of_measurement to a METRIC_DEFINITIONS
      // unitProfile key (e.g. "°F" -> "fahrenheit"); null when metricKind is
      // unknown or rawUnit doesn't match any registered profile. Both lookup
      // paths use normalizeUnitToken(), so equivalent Unicode/text spellings map
      // to the same registered unit without weakening unknown-unit rejection.
      const definition = METRIC_DEFINITIONS[metricKind];
      if (!definition || !rawUnit) return null;
      const normalized = normalizeUnitToken(rawUnit);
      return Object.keys(definition.unitProfiles).find((key) =>
        definition.unitProfiles[key].units.some((unit) => normalizeUnitToken(unit) === normalized)
      ) || null;
    }

    _resolveAuxiliaryUnitProfile(entityId, metricKind, { rateSuffix = false } = {}) {
      // Review fix (P0, post-2.21.1): range_entity/trend_entity are
      // auxiliary sensors, not Primary/Room participants in
      // _resolveMetricContext() — but their state/attributes still need a
      // resolved unitProfile key before _convertMetricValue() can project
      // them into canonical/display units (see _computeData()'s range/trend
      // block). A COMPLETELY MISSING unit is unusable here too — the
      // previous round's canonical-fallback-for-a-missing-unit asymmetry
      // (documented at _buildEntityModel() above) has been explicitly and
      // repeatedly rejected by the reviewer for Primary/Räume, and applies
      // identically to Range/Trend: fehlend und unbekannt müssen beide
      // unitProfile=null ergeben, nie eine stille Kanonisch-Annahme. A unit
      // that IS present but doesn't resolve to any registered profile was
      // already correctly rejected (unchanged, still `null`).
      //
      // rateSuffix: trend_entity's rate quantity is conventionally reported
      // with a "/h" suffix on the ABSOLUTE unit (e.g. "ppm/h", "°C/h" — HA's
      // own derivative/statistics helpers use exactly this convention), not
      // the bare absolute unit itself. A trailing "/h" (whitespace-
      // tolerant, case-insensitive) is stripped before matching against the
      // registered unitProfiles.units list; a trend entity using the bare
      // absolute unit with no suffix (also seen in the wild) still resolves
      // unchanged, since stripping a non-matching suffix is a no-op.
      if (!entityId) return null;
      const definition = METRIC_DEFINITIONS[metricKind];
      if (!definition) return null;
      let rawUnit = this._rawUnitForEntity(entityId);
      if (!rawUnit) return null;
      if (rateSuffix) rawUnit = rawUnit.replace(/\s*\/\s*h$/i, "");
      return this._resolveUnitProfileKey(metricKind, rawUnit);
    }

    _buildEntityModel(entityId, sourceRole) {
      // One EntityModel per Primary/Room entity (AP-02, audit section 4.1):
      // every field needed to decide whether this entity may participate in
      // metric-kind resolution or averaging, resolved once so
      // _resolveMetricContext() never has to re-derive it independently for
      // different purposes (that independent re-derivation — metricType via
      // one path, avg/avgSource via another, unit via a third — was DATA-01
      // through DATA-04's shared root cause). All four metric kinds now have
      // a MetricDefinition (review fix, post-AP-03: humidity/co2/pm25 got
      // trivial identity UnitProfiles), so canonicalValue is a genuine
      // (no-op for those three, real for temperature) conversion in every
      // case, never a bypass.
      const stateObject = entityId ? this._hass?.states?.[entityId] || null : null;
      const rawValue = this._getNum(entityId);
      const rawUnit = this._rawUnitForEntity(entityId);
      const rawDeviceClass = stateObject?.attributes?.device_class;
      const deviceClass = typeof rawDeviceClass === "string" && rawDeviceClass.trim() ? rawDeviceClass.trim() : null;
      const metricKind = this._metricTypeForEntity(entityId);
      const validNumeric = rawValue !== null;

      // Review fix (P0, post-2.21.1): a unit is only ever trusted when it is
      // BOTH present AND resolves to a registered UnitProfile — a missing
      // unit_of_measurement is no longer assumed canonical. The previous
      // round's asymmetry ("fehlend ist nicht dasselbe wie explizit
      // falsch" — a missing unit fell back to canonical while an explicit-
      // but-unresolvable one, e.g. device_class:temperature + "hPa", did
      // not) was an intentional, documented judgment call, but the reviewer
      // has since explicitly and repeatedly rejected it: fehlend und
      // unbekannt muss beide unitProfile=null/validUnit=false ergeben, die
      // Messung ausschließen und diagnostiziert werden — no exceptions.
      // validUnit:false means "this entity's own metric kind is known, but
      // its reading cannot be trusted" — metricKind itself is deliberately
      // left resolved (not nulled out), so title/icon fallbacks (see
      // _resolveMetricContext()'s "no candidates" branch) still make sense
      // even when nothing anywhere is numerically usable.
      let unitProfile = null;
      let canonicalValue = rawValue;
      let validUnit = true;
      if (validNumeric && metricKind) {
        const definition = METRIC_DEFINITIONS[metricKind]; // always exists now (all 4 kinds registered)
        if (rawUnit) {
          unitProfile = this._resolveUnitProfileKey(metricKind, rawUnit);
          if (!unitProfile) validUnit = false;
        } else {
          validUnit = false;
        }
        if (unitProfile) {
          canonicalValue = this._convertMetricValue(rawValue, {
            metricKind,
            quantityKind: "absolute",
            fromProfileKey: unitProfile,
            toProfileKey: definition.canonicalProfileKey,
          });
        }
      }

      // Physical/custom valid_range checks are defined in the profile's
      // canonical unit. Run them only after the entity value has passed unit
      // resolution and been converted; comparing a raw Fahrenheit value
      // against canonical Celsius limits would otherwise reject valid data.
      // lenient:true (P1 review fix, post-2.30.0): this entity's OWN kind
      // may not be the kind the card-wide classification policy is scoped
      // to (e.g. a humidity room on an otherwise-temperature card with
      // classification: outdoor) — see _resolveClassificationProfile()'s
      // lenient parameter for why that must not throw here.
      const validPhysical = validNumeric && (!validUnit || this._isPhysicallyValid(canonicalValue, metricKind, null, { lenient: true }));

      return { entityId, sourceRole, stateObject, rawValue, rawUnit, deviceClass, metricKind, unitProfile, quantityKind: "absolute", canonicalValue, validNumeric, validPhysical, validUnit, errors: [] };
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

    _resolveMetricContext() {
      // Atomic MeasurementContext (AP-02, v2.17.0 consolidated audit,
      // sections 4.1-4.3): resolves metric kind, display unit, and average
      // source together from EntityModels (_buildEntityModel()), replacing
      // the three independently-resolving paths (metricType here, avg/
      // avgSource via _computeData()'s own checks, unit here again) that
      // were the shared root cause of DATA-01 through DATA-04. A primary or
      // room may only determine the resolved kind or contribute to the
      // average once it is BOTH numerically and physically valid — no
      // majority vote is ever used to pick a "winner" between genuinely
      // disagreeing metric kinds (see the "mixed_metric_kinds" branch
      // below), unlike the pre-AP-02 implementation.
      //
      // 1. Primary usable (numeric + physically valid + a resolvable metric
      //    kind, e.g. NOT a stuck "0 ppm" CO2 reading — DATA-01) -> it alone
      //    determines metricKind/averageSource. Rooms of the SAME kind
      //    (also numeric + physically valid) participate; rooms of a
      //    DIFFERENT kind are excluded and diagnosed
      //    ("excluded_foreign_metric_kind"), never silently dropped and
      //    never averaged in regardless of their own validity.
      // 2. Primary not usable -> only rooms that are themselves numeric +
      //    physically valid + of a resolvable kind are candidates at all —
      //    an unavailable room can never outnumber/outvote a genuinely
      //    available one (DATA-02).
      //    - No candidates -> no usable source; metricKind still defaults
      //      sensibly (the primary's own resolvable kind if it has one,
      //      else "temperature") purely for the empty state's title/icon,
      //      but averageSource stays null.
      //    - Candidates all share one metric kind -> roomConsensus:
      //      metricKind is that kind, averageSource.canonicalValue is the
      //      mean of their CANONICAL values — compatible units of the same
      //      kind (e.g. a °F room among °C rooms) are converted before
      //      averaging, never averaged raw.
      //    - Candidates span more than one metric kind -> NO majority
      //      selection. metricKind/averageSource are null, diagnostics
      //      carries "mixed_metric_kinds" (DATA-03) — a defined
      //      configuration state, not an arbitrary winner picked by count.
      //
      // Every canonicalValue used here is expressed in the metric kind's
      // CANONICAL unit (Celsius for temperature) — even when the winning
      // source itself reports Fahrenheit/Kelvin; _computeData() (AP-03)
      // converts into the resolved displayUnitProfile exactly once, early,
      // before any comfort/classification/scale decision is made, so those
      // decisions are always made against the SAME unit as the number
      // actually displayed. displayUnitProfile itself follows audit 9.4:
      // (1) a usable primary's own unit profile; (2) otherwise, the
      // participating rooms' shared unit profile, IF they all agree — a
      // room-consensus average spanning disagreeing units (e.g. one °F room
      // among °C rooms) has no single "the" display unit, so it falls back
      // to canonical; (3) canonical when nothing else resolves. humidity/
      // co2/pm25 each have one identity UnitProfile, so their display
      // projection remains a no-op.
      //
      // Memoized like _language(): invalidated on hass or config identity
      // change, so _metricType()/_unit() (thin wrappers below) stay cheap
      // and consistent across a single render.
      if (this._metricContextCacheHass === this._hass && this._metricContextCacheConfig === this._config) {
        return this._metricContextCacheValue;
      }

      const primary = this._buildEntityModel(this._config?.entity, "primary");
      const rooms = (this._config?.rooms || []).map((room) => this._buildEntityModel(room.entity, "room"));
      const primaryUsable = primary.validNumeric && primary.validPhysical && primary.validUnit && primary.metricKind !== null;

      let metricKind;
      let averageSource;
      let participatingRooms;
      let excludedRoomIds;
      let consistent;
      let diagnostics;
      let sourceEntity;
      let sourceKind;
      let displayUnitProfileKey;

      if (primaryUsable) {
        metricKind = primary.metricKind;
        participatingRooms = [];
        excludedRoomIds = [];
        diagnostics = [];
        for (const room of rooms) {
          if (!room.validNumeric || room.metricKind === null) continue;
          if (room.metricKind !== metricKind) {
            excludedRoomIds.push(room.entityId);
            diagnostics.push({ code: "excluded_foreign_metric_kind", entityId: room.entityId, metricKind: room.metricKind });
            continue;
          }
          if (!room.validUnit) {
            // Review fix (post-AP-01..03): same metric kind as the usable
            // primary, but this room's OWN unit doesn't match any
            // registered UnitProfile for that kind — diagnosed and
            // excluded, never silently averaged in with an assumed unit.
            excludedRoomIds.push(room.entityId);
            diagnostics.push({ code: "unusable_unit", entityId: room.entityId, metricKind: room.metricKind });
            continue;
          }
          if (room.validPhysical) participatingRooms.push(room);
        }
        averageSource = { kind: "primary", entityId: primary.entityId, canonicalValue: primary.canonicalValue, unitProfile: primary.unitProfile };
        consistent = true;
        sourceEntity = primary.entityId;
        sourceKind = "primary";
        displayUnitProfileKey = primary.unitProfile;
      } else {
        const candidates = rooms.filter((room) => room.validNumeric && room.validPhysical && room.validUnit && room.metricKind !== null);
        // Review fix (post-AP-01..03): rooms that are numerically/physically
        // valid and have a resolvable metric kind, but whose OWN unit
        // doesn't match any registered UnitProfile for that kind, are
        // diagnosed here too — not just in the primaryUsable branch above —
        // so they're never silently dropped from the candidate pool without
        // a trace, regardless of which room-consensus sub-branch is reached.
        const unusableUnitRooms = rooms.filter((room) => room.validNumeric && room.validPhysical && !room.validUnit && room.metricKind !== null);
        const unusableUnitIds = unusableUnitRooms.map((room) => room.entityId);
        const unusableUnitDiagnostics = unusableUnitRooms.map((room) => ({ code: "unusable_unit", entityId: room.entityId, metricKind: room.metricKind }));
        participatingRooms = [];
        excludedRoomIds = unusableUnitIds;
        if (candidates.length === 0) {
          metricKind = primary.metricKind || "temperature";
          averageSource = null;
          diagnostics = unusableUnitDiagnostics;
          consistent = true;
          sourceEntity = primary.metricKind ? primary.entityId : null;
          sourceKind = primary.metricKind ? "primary" : "default";
          displayUnitProfileKey = null;
        } else {
          const kinds = new Set(candidates.map((room) => room.metricKind));
          if (kinds.size > 1) {
            metricKind = null;
            averageSource = null;
            diagnostics = [{ code: "mixed_metric_kinds", metricKinds: [...kinds] }, ...unusableUnitDiagnostics];
            consistent = false;
            sourceEntity = null;
            sourceKind = "mixed";
            displayUnitProfileKey = null;
            this._warnMixedMetricKindsOnce(diagnostics[0]);
          } else {
            metricKind = candidates[0].metricKind;
            participatingRooms = candidates;
            diagnostics = unusableUnitDiagnostics;
            consistent = true;
            sourceEntity = candidates[0].entityId;
            sourceKind = "roomConsensus";
            // A room-consensus average has no single "the" display unit
            // unless every participating room actually agrees on one — a
            // °F room mixed among °C rooms (audit 9.4/9.7 "Mixed Units")
            // still averages correctly (canonicalValue is already
            // canonicalized per room), but display falls back to canonical
            // rather than arbitrarily preferring one disagreeing room's unit.
            displayUnitProfileKey = candidates.every((room) => room.unitProfile === candidates[0].unitProfile)
              ? candidates[0].unitProfile
              : null;
            averageSource = {
              kind: "roomConsensus",
              entityIds: candidates.map((room) => room.entityId),
              canonicalValue: candidates.reduce((sum, room) => sum + room.canonicalValue, 0) / candidates.length,
              unitProfile: null,
            };
          }
        }
      }

      const definition = METRIC_DEFINITIONS[metricKind];
      const canonicalUnit = definition ? definition.canonicalUnit : this._metricMetaFor(metricKind).unitFallback;
      // AP-03 (audit 9.4): the resolved display profile —
      // celsius/fahrenheit/kelvin for temperature and the identity profile
      // for humidity/co2/pm25. Falls back to the canonical profile key
      // whenever displayUnitProfileKey couldn't be resolved to one source.
      const displayUnitProfile = definition
        ? this._getUnitProfile(metricKind, displayUnitProfileKey || definition.canonicalProfileKey)
        : null;
      const value = {
        metricKind,
        canonicalUnit,
        unit: displayUnitProfile ? displayUnitProfile.displayUnit : canonicalUnit,
        displayUnitProfile,
        averageSource,
        participatingRooms,
        excludedRoomIds,
        consistent,
        diagnostics,
        // Legacy aliases: kept so existing callers (_unit()/_metricType()
        // below, and pre-AP-02 tests that are still valid) keep working
        // unchanged.
        metricType: metricKind,
        sourceEntity,
        sourceKind,
      };

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
      const definition = METRIC_DEFINITIONS[metricKind];
      if (!definition) throw new Error(`No MetricDefinition registered for metricKind "${metricKind}"`);
      return definition;
    }

    _getUnitProfile(metricKind, profileKey) {
      const profile = this._getMetricDefinition(metricKind).unitProfiles[profileKey];
      if (!profile) throw new Error(`Unknown unitProfile "${profileKey}" for metricKind "${metricKind}"`);
      return profile;
    }

    // Raw primitives: operate directly on profile/tier/band objects, with
    // no registry lookup — this is what makes them reusable for a metric
    // kind that isn't registered in METRIC_DEFINITIONS yet (see the
    // registry's "Extension point" comment).
    _convertUnitValue(value, quantityKind, fromProfile, toProfile) {
      return convertUnitValue(value, quantityKind, fromProfile, toProfile);
    }

    _deriveThresholdsForProfileFromTiers(canonicalTiers, profile) {
      return deriveThresholdsForProfile(canonicalTiers, profile);
    }

    _deriveBandForProfileFromBand(band, profile) {
      return deriveBandForProfile(band, profile);
    }

    // Registry-based convenience wrappers, for the common case of an
    // already-registered metricKind.
    _convertMetricValue(value, { metricKind, quantityKind, fromProfileKey, toProfileKey }) {
      const fromProfile = this._getUnitProfile(metricKind, fromProfileKey);
      const toProfile = this._getUnitProfile(metricKind, toProfileKey);
      return this._convertUnitValue(value, quantityKind, fromProfile, toProfile);
    }

    _deriveThresholdsForProfile(metricKind, profileKey) {
      const definition = this._getMetricDefinition(metricKind);
      return this._deriveThresholdsForProfileFromTiers(definition.canonicalClassificationTiers, this._getUnitProfile(metricKind, profileKey));
    }

    _deriveBandForProfile(metricKind, profileKey, bandName) {
      const definition = this._getMetricDefinition(metricKind);
      const bandKey = `canonical${bandName[0].toUpperCase()}${bandName.slice(1)}Band`; // "comfort" -> canonicalComfortBand
      const band = definition[bandKey];
      if (!band) throw new Error(`Unknown band "${bandName}" for metricKind "${metricKind}"`);
      return this._deriveBandForProfileFromBand(band, this._getUnitProfile(metricKind, profileKey));
    }

    _metricTypeForEntity(entityId) {
      // Resolves a metric type from one entity's own device_class/unit, or
      // null if neither is present/known. Reads the state directly rather
      // than via _unit()/_resolveMetricContext() (which resolve a single
      // card-wide context) so it can be reused for arbitrary room entities.
      const state = this._hass?.states?.[entityId];
      if (!state) return null;
      const deviceClass = state.attributes?.device_class;
      if (typeof deviceClass === "string" && deviceClass.trim()) {
        const metric = METRIC_TYPE_BY_DEVICE_CLASS[deviceClass.trim().toLowerCase()];
        if (metric) return metric;
      }
      const unit = normalizeUnitToken(state.attributes?.unit_of_measurement);
      return METRIC_TYPE_BY_UNIT[unit] || null;
    }

    _fmtWithUnit(value, digits, withSpace = true) {
      // Combines the formatted number and its unit.
      const separator = withSpace ? " " : "";
      return `${this._fmt(value, digits)}${separator}${this._unit()}`;
    }

    _esc(value) {
      // HTML-escapes a value before it enters a template string (entity names, room labels).
      return String(value ?? "").replace(/[&<>"']/g, (char) => ESC_MAP[char]);
    }

    _clamp(value, min, max) {
      // Clamps a value to a fixed range.
      return Math.max(min, Math.min(max, value));
    }

    _pos(value, min, max) {
      // Converts a value into a percentage position on the scale.
      if (max === min) return 0;
      return this._clamp(((value - min) / (max - min)) * 100, 0, 100);
    }

    _rangePosition(minValue, maxValue, scaleMin, scaleMax) {
      // Computes left position and width for the comfort/optimal bands.
      const left = this._pos(minValue, scaleMin, scaleMax);
      const right = this._pos(maxValue, scaleMin, scaleMax);
      return {
        left: Math.min(left, right),
        width: Math.abs(right - left),
      };
    }

    _scaleGeometry(comfortMin, comfortMax, optimalMin, optimalMax, scaleMin, scaleMax) {
      // Bundles everything _renderScaleBar()/_updateScaleBarCommon() need to
      // draw one scale bar (comfort/optimal band position+size, scale edge
      // values). comfortMin/comfortMax/optimalMin/optimalMax are the same
      // mode-dependent thresholds for every scale bar on the card; only
      // scaleMin/scaleMax (the bar's own dynamic bounds) differ between the
      // main "scale" view (room-based) and the "rangeScale" view
      // (daily-range-based, see _computeData()) — computed here once so
      // both views share identical position math via the same function.
      const comfortBand = this._rangePosition(comfortMin, comfortMax, scaleMin, scaleMax);
      const optimalBand = this._rangePosition(optimalMin, optimalMax, scaleMin, scaleMax);
      return {
        scaleMin,
        scaleMax,
        optimalMin,
        optimalMax,
        comfortLeft: comfortBand.left,
        comfortWidth: comfortBand.width,
        comfortCenter: comfortBand.left + comfortBand.width / 2,
        optimalLeft: optimalBand.left,
        optimalWidth: optimalBand.width,
        optimalCenter: optimalBand.left + optimalBand.width / 2,
        // A data-anchored axis can legitimately sit wholly outside the
        // semantic bands (e.g. a winter outdoor scale at -3..9 °C). Keep
        // their configured bounds in the model, but do not render a
        // zero-width band or a misleading label pinned to an axis edge.
        comfortVisible: comfortMax > scaleMin && comfortMin < scaleMax,
        optimalVisible: optimalMax > scaleMin && optimalMin < scaleMax,
      };
    }

    _roomGridRows(count, columns, rows, autoMaxColumns = 7) {
      // Splits `count` room chips into an array of row descriptors
      // {itemCount, columnCount} (e.g. [{itemCount:5,columnCount:5},
      // {itemCount:4,columnCount:4}] for 9 rooms with no override).
      // columnCount is the CSS grid-template-columns count for that row —
      // equal to itemCount unless `columns` is explicitly fixed, in which
      // case every row (including a shorter last row) keeps the same
      // columnCount so chip widths stay visually consistent across rows
      // instead of a short last row's chips stretching wider. Pure
      // function of count/columns/rows/autoMaxColumns — no DOM/entity
      // access — so it's independently testable. Also returns `capacity`
      // (rooms actually shown; only less than `count` when both columns
      // and rows are explicitly configured and their product is smaller
      // than count — an explicit override always wins over showing every
      // configured room, see "Oeffentliche Konfiguration"). `autoMaxColumns`
      // (default 7, see _autoRoomColumnsFor()) only affects the fully
      // automatic branch below — any explicit columns/rows override takes
      // priority and never sees this value.
      if (count <= 0) return { rowSizes: [], capacity: 0 };

      // Both fixed: a literal columns x rows grid, filled row-major; excess
      // rooms beyond capacity are dropped rather than growing the grid.
      // rowCount is capped to what `count` can actually fill, so an
      // over-large room_rows (e.g. 5 rows for 2 rooms) never produces
      // empty trailing rows.
      if (columns && rows) {
        const capacity = columns * rows;
        const shown = Math.min(count, capacity);
        const rowCount = Math.min(rows, Math.ceil(shown / columns));
        const rowSizes = [];
        let remaining = shown;
        for (let i = 0; i < rowCount; i++) {
          const itemCount = Math.min(columns, remaining);
          rowSizes.push({ itemCount, columnCount: columns });
          remaining -= itemCount;
        }
        return { rowSizes, capacity: shown };
      }

      // Only columns fixed: rows grow automatically, no capping.
      if (columns) {
        const rowCount = Math.ceil(count / columns);
        const rowSizes = [];
        let remaining = count;
        for (let i = 0; i < rowCount; i++) {
          const itemCount = Math.min(columns, remaining);
          rowSizes.push({ itemCount, columnCount: columns });
          remaining -= itemCount;
        }
        return { rowSizes, capacity: count };
      }

      // Only rows fixed, or fully automatic (rows derived from the
      // metric-specific autoMaxColumns per row): distribute as evenly as
      // possible across the row count, extra items going to the earliest
      // rows first — e.g. 9 rooms over 2 rows -> [5, 4], 13 over 2 -> [7, 6].
      // Row count is capped to `count` so an over-large room_rows never
      // produces empty rows (the automatic default never needs this cap on
      // its own, since Math.ceil(count/autoMaxColumns) <= count for every
      // count >= 1, but an explicit room_rows override can request more
      // rows than there are rooms).
      const rowCount = Math.min(rows || Math.max(1, Math.ceil(count / autoMaxColumns)), count);
      const base = Math.floor(count / rowCount);
      const remainder = count % rowCount;
      const rowSizes = [];
      for (let i = 0; i < rowCount; i++) {
        const itemCount = base + (i < remainder ? 1 : 0);
        rowSizes.push({ itemCount, columnCount: itemCount });
      }
      return { rowSizes, capacity: count };
    }

    _resolveDynamicStep(metricType, unitProfile, staticStep, low, high, baseMin, baseMax, anchorScale = true) {
      // AP-03 (audit 9.6): Fahrenheit's rounding step depends on how wide
      // the actually-displayed span is (2°F/5°F/10°F for spans <=20/<=40/
      // >40 °F) instead of a single fixed step — a narrow Fahrenheit range
      // stays fine-grained, a wide one doesn't produce an absurd number of
      // gridlines. Celsius/Kelvin (no dynamicDisplaySteps on their profile)
      // and humidity/co2/pm25 (identity UnitProfiles without dynamic steps)
      // keep the fixed staticStep unchanged. Teil C (review
      // fix 3): unitProfile is the caller's explicit resolution, never
      // self-resolved here.
      const definition = METRIC_DEFINITIONS[metricType];
      if (!definition) return staticStep;
      if (!unitProfile?.dynamicDisplaySteps) return staticStep;
      const dataMin = Number.isFinite(low) ? low : baseMin;
      const dataMax = Number.isFinite(high) ? high : baseMax;
      const spanMin = anchorScale ? Math.min(dataMin, baseMin) : dataMin;
      const spanMax = anchorScale ? Math.max(dataMax, baseMax) : dataMax;
      const span = spanMax - spanMin;
      const tier = unitProfile.dynamicDisplaySteps.find((t) => span <= t.maxSpan);
      return (tier || unitProfile.dynamicDisplaySteps[unitProfile.dynamicDisplaySteps.length - 1]).step;
    }

    _dynamicScale(coolestValue, warmestValue, metricType, unitProfile) {
      // Expands either the mode's anchored base scale OR the live data range
      // to leave headroom around real values so markers don't hug the edge;
      // rounds to the mode's step (1 for
      // temperature/Kelvin, dynamic 2/5/10 for Fahrenheit — see
      // _resolveDynamicStep() — 5 for humidity/pm25, 200 for co2) after
      // adding a buffer (the active profile's headroom, defaulting to a full
      // step).
      // oneSided modes (co2/pm25) never expand the lower bound — there is
      // no "too low" concept for them, so min always stays at scale.min.
      // Teil C (review fix 3): unitProfile is threaded through explicitly
      // to _scaleConfigFor()/_resolveDynamicStep() — see _buildScaleModel().
      // The resolved step is now also returned (not just min/max), so
      // _buildScaleModel() can expose it as the renderer-ready
      // displayStep without a third independent call.
      const { scale, step: staticStep, oneSided, headroom, anchorScale } = this._scaleConfigFor(metricType, unitProfile);
      const baseMin = scale.min;
      const baseMax = scale.max;
      const numericLow = Number(coolestValue);
      const numericHigh = Number(warmestValue);
      const low = Number.isFinite(numericLow) ? numericLow : baseMin;
      const high = Number.isFinite(numericHigh) ? numericHigh : baseMax;
      const step = this._resolveDynamicStep(
        metricType,
        unitProfile,
        staticStep,
        oneSided ? baseMin : low,
        high,
        baseMin,
        baseMax,
        anchorScale
      );
      const buffer = headroom ?? step;

      const warmLimit = this._ceilToStep(high + buffer, step);
      let max = anchorScale ? Math.max(baseMax, warmLimit) : warmLimit;
      max = this._ceilToStep(max, step);
      if (!Number.isFinite(max)) max = baseMax;

      let min = baseMin;
      if (!oneSided) {
        const coldLimit = this._floorToStep(low - buffer, step);
        min = anchorScale ? Math.min(baseMin, coldLimit) : coldLimit;
        min = this._floorToStep(min, step);
        if (!Number.isFinite(min)) min = baseMin;
      }

      if (min >= max) max = min + step;
      return { min, max, step };
    }

    _buildScaleModel({ metricType, unitProfile, comfortMin, comfortMax, optimalMin, optimalMax, low, high, markers }) {
      // AP-03 (audit 9.6, "SCALE-01 - gemeinsames ScaleModel für beide
      // Scale-Views"): fuses _dynamicScale()+_scaleGeometry() — previously
      // two near-identical call pairs in _computeData(), one for the main
      // "scale" view (room-based low/high) and one for "rangeScale"
      // (daily-range-based low/high) — into the single shared function the
      // audit requires, called identically by both. Guarantees "identical
      // geometry for identical input in both views" structurally (it is
      // literally the same function call), not just by convention.
      //
      // Teil C (review fix 3, P1): takes an explicit options object
      // (metricType/unitProfile resolved ONCE by the caller — _computeData()
      // — instead of every downstream helper re-resolving
      // this._resolveMetricContext() independently) and returns the FULL
      // renderer-ready model, not just geometry: displayStep (the actual
      // rounding step _dynamicScale() chose — previously recomputed
      // separately, nowhere exposed) and markerPositions (one _pos() call
      // per entry in `markers`, e.g. {avg, coolest, warmest} for the main
      // scale or {current, min, max} for rangeScale — replacing the
      // several independent this._pos(...) call sites _computeData() used
      // to make against this same scale) and boundaryLabels (the min/max
      // edge labels, pre-formatted in the SAME unit as everything else this
      // model produced — replacing _renderScaleBar()'s/
      // _updateScaleBarCommon()'s own ad-hoc this._fmtWithUnit(scaleMin,...)
      // calls). geometry fields (scaleMin/scaleMax/optimalMin/optimalMax/
      // comfortLeft/.../optimalCenter) are unchanged from _scaleGeometry()'s
      // own contract.
      const dynamicScale = this._dynamicScale(low, high, metricType, unitProfile);
      const geometry = this._scaleGeometry(comfortMin, comfortMax, optimalMin, optimalMax, dynamicScale.min, dynamicScale.max);
      const markerPositions = {};
      for (const key of Object.keys(markers || {})) {
        markerPositions[key] = this._pos(markers[key], dynamicScale.min, dynamicScale.max);
      }
      return {
        ...geometry,
        displayStep: dynamicScale.step,
        markerPositions,
        boundaryLabels: {
          min: this._fmtWithUnit(dynamicScale.min, 0, false),
          max: this._fmtWithUnit(dynamicScale.max, 0, false),
        },
      };
    }

    _avgTone(value, entityId, metricType, unitProfile) {
      const classification = this._resolveValueClassification(value, entityId, metricType, unitProfile);
      const icon = this._config.icon || this._profileIconForValue(value, metricType, unitProfile);
      return {
        label: classification.level,
        color: classification.color,
        score: classification.score,
        zone: classification.zone,
        source: classification.source,
        profileId: classification.profileId,
        icon,
        soft: this._rgba(classification.color, 0.20),
      };
    }

    _classificationTableFor(metricType, unitProfile) {
      return this._classificationProfileForDisplay(metricType, unitProfile);
    }

    _classifyNumericValue(value, metricType, unitProfile) {
      const table = this._classificationTableFor(metricType, unitProfile);
      if (table.invalidWhen?.(value)) {
        const invalid = table.invalidClassification || {
          score: null,
          levelKey: "level.invalidReading",
          color: "#B4B2A9",
          zone: "invalid",
        };
        return {
          level: invalid.level || this._t(invalid.levelKey),
          color: invalid.color,
          score: invalid.score ?? null,
          zone: invalid.zone ?? "invalid",
        };
      }
      const tier = table.tiers.find((candidate) =>
        table.comparison === ">" ? value > candidate.min : value >= candidate.min
      );
      return {
        level: tier.level || this._t(tier.levelKey),
        color: tier.color,
        score: tier.score ?? null,
        zone: tier.zone ?? null,
      };
    }

    _fallbackTone(value, metricType, unitProfile) {
      const classification = this._classifyNumericValue(value, metricType, unitProfile);
      return { ...classification, label: classification.level };
    }

    _isPhysicallyValid(value, metricType, unitProfile = null, { lenient = false } = {}) {
      if (!CLASSIFICATION_PROFILE_REGISTRY[metricType]) return true;
      const profile = unitProfile
        ? this._classificationProfileForDisplay(metricType, unitProfile)
        : this._resolveClassificationProfile(metricType, { lenient });
      return !profile.invalidWhen?.(value);
    }

    _fallbackTemperatureIcon(temp, unitProfile) {
      return this._temperatureIconForProfile(temp, unitProfile);
    }

    _roomTone(value, entityId, metricType, unitProfile) {
      return this._resolveValueClassification(value, entityId, metricType, unitProfile).color;
    }

    _rgba(color, alpha) {
      // Builds a semi-transparent color from a hex, rgb(), or CSS variable
      // input. Accepts all four valid CSS hex lengths (3/4/6/8, matching
      // HEX_COLOR_PATTERN); for the two with an embedded alpha channel
      // (4/8), only the RGB part is used — this always applies the given
      // alpha rather than any alpha already embedded in the source color,
      // since the contract here is "this color at the requested opacity",
      // not "this color's own opacity, adjusted".
      if (typeof color !== "string") return `rgba(255,255,255,${alpha})`;
      if (color.startsWith("rgba") || color.startsWith("rgb")) return color;
      if (color.startsWith("var(")) return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
      const hex = color.replace("#", "").trim();
      let rgbHex;
      if (hex.length === 3 || hex.length === 4) {
        rgbHex = hex.slice(0, 3).split("").map((c) => c + c).join("");
      } else if (hex.length === 6 || hex.length === 8) {
        rgbHex = hex.slice(0, 6);
      } else {
        return `rgba(255,255,255,${alpha})`;
      }
      const int = Number.parseInt(rgbHex, 16);
      if (!Number.isFinite(int)) return `rgba(255,255,255,${alpha})`;
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }

    // ==== Data computation ====
    // Computes everything the display needs from the current sensor values:
    // average, coldest/warmest room, colors, comfort status.
    //
    // rooms is optional (minimal mode); below two valid room values,
    // hasRoomsView is false and chips/the extreme-value view are omitted
    // (see the hasRoomsView branches below and _renderContent()).
    _computeData() {
      const config = this._config;
      // Resolved first via the atomic MeasurementContext (AP-02, see
      // _resolveMetricContext()): metric kind, average source, and which
      // rooms actually participate are all decided together, from the same
      // EntityModels — never three independently-resolving checks like
      // before AP-02 (that mismatch was DATA-01 through DATA-04's shared
      // root cause). device_class/unit_of_measurement usually survive on an
      // unavailable entity, so even the empty state can show the correct
      // title/mode; comfort/optimal ranges below also depend on the mode.
      const context = this._resolveMetricContext();
      const metricType = context.metricType || "temperature";
      const title = config.title || this._t(this._metricMetaFor(metricType).titleKey);
      const scaleConfig = this._scaleConfigFor(metricType, context.displayUnitProfile);
      const comfortMin = scaleConfig.comfort.min;
      const comfortMax = scaleConfig.comfort.max;
      const optimalMin = scaleConfig.optimal.min;
      const optimalMax = scaleConfig.optimal.max;

      // No usable average source at all — either nothing resolvable/valid
      // anywhere (context.diagnostics empty), or rooms report genuinely
      // incompatible metric kinds with no usable primary to arbitrate
      // (context.diagnostics[0].code === "mixed_metric_kinds", DATA-03) —
      // exposed as configurationState so a future block can surface it more
      // specifically; for now this renders as the existing empty state,
      // never a cross-metric-kind average.
      if (context.averageSource === null) {
        return {
          empty: true,
          metricType,
          title,
          missingRooms: config.rooms.filter((room) => !this._hasEntity(room.entity)).length,
          configurationState: context.diagnostics[0]?.code ?? null,
        };
      }

      // AP-03 (audit 9.1-9.6): from here on, every number is projected into
      // the resolved DISPLAY unit (context.displayUnitProfile) exactly
      // once — comfort/classification/scale decisions must be made against
      // the SAME unit as what's actually rendered (see
      // _resolveMetricContext()/_classificationTableFor() for why a
      // canonical-only comparison would be wrong against a rounded
      // Fahrenheit boundary). Identity for humidity/co2/pm25 and whenever
      // the resolved display is already canonical (e.g. Celsius) — a
      // complete no-op for the real household's Celsius-only sensors.
      const displayProfile = context.displayUnitProfile;
      const toDisplay = displayProfile ? displayProfile.fromCanonical : (v) => v;
      const toDisplayDelta = displayProfile ? displayProfile.deltaFromCanonical : (v) => v;

      // Room values: only the rooms the atomic context actually accepted as
      // participants (same metric kind as the resolved context, numerically
      // + physically valid, entity currently available — see
      // _resolveMetricContext()). value is the DISPLAY value (e.g. a
      // Fahrenheit room reads back in °F here when the card resolves to a
      // Fahrenheit display, °C when it doesn't — see _buildEntityModel()
      // for the canonical value this is derived from), so every comparison
      // below against comfortMin/comfortMax (from _scaleConfigFor(),
      // likewise resolved into the display unit) is correct regardless of
      // which unit each entity actually reports in.
      const participatingByEntity = new Map(context.participatingRooms.map((model) => [model.entityId, model]));
      // AP-C2: room_label picks which of room.short/room.name is actually
      // rendered on the chip -- "auto" (default) resolves to room.short,
      // identical to today's unconditional behavior; "short" is the same
      // value, just explicitly chosen rather than implicit; "name" shows
      // the full name instead (CSS ellipsis remains the overflow guard,
      // same as any other label). Resolved once here so
      // _renderRoomChip()/_patchRoomChip() have a single field to read,
      // without needing to know about room_label themselves.
      const roomDisplayLabel = (room) => (config.room_label === "name" ? room.name : room.short);
      // A room's short code is guaranteed never to shrink/ellipsize only
      // when the actually-rendered label is exactly two Unicode uppercase
      // letters (e.g. "WZ", "KÜ") — a purely text-based check against the
      // resolved displayLabel, independent of whether `short` was
      // explicitly configured or derived (see .rtc-room-short[data-short-
      // guaranteed] in the styles below). Longer labels (e.g. "WOHNZ") or
      // full room names keep the normal ellipsis fallback.
      const validRooms = config.rooms
        .map((room, index) => {
          const model = participatingByEntity.get(room.entity);
          if (!model) return null;
          const displayLabel = roomDisplayLabel(room);
          return { ...room, index, value: toDisplay(model.canonicalValue), displayLabel, shortGuaranteed: TWO_UPPER_LETTER_RE.test(displayLabel) };
        })
        .filter((room) => room !== null);

      // Room-chip grid layout (see _roomGridRows()); when room_columns AND
      // room_rows are both explicitly configured and their product is
      // smaller than the number of valid rooms, the grid capacity caps how
      // many rooms are shown as chips. This is a display-only cap: it must
      // never change avg/extrema/comfort/spread/subtitle, which always use
      // every valid room (see allRooms below) — a room hidden purely by a
      // grid override still counts everywhere else, exactly as if its chip
      // were simply not rendered. The cap itself is applied here, in
      // config-declaration order (validRooms is still unsorted at this
      // point), rather than after the value-sort below — capping by value
      // would make the visible chip set drift as values change through the
      // day (e.g. a room silently vanishing from the grid once it's no
      // longer among the N coldest), which would be confusing; capping by
      // declaration order keeps the visible chip set stable and predictable.
      // autoMaxColumns is metric-specific (see _autoRoomColumnsFor()) and
      // only affects the fully-automatic branch of _roomGridRows() — an
      // explicit room_columns/room_rows override is unaffected.
      const roomGrid = this._roomGridRows(validRooms.length, config.room_columns, config.room_rows, this._autoRoomColumnsFor(metricType));
      const cappedRooms = roomGrid.capacity < validRooms.length ? validRooms.slice(0, roomGrid.capacity) : validRooms;

      // Sort by value then name for the FACHLICHE order. allRooms (every
      // valid room) feeds every calculation below (extrema, comfort count,
      // spread) and is always value-sorted, regardless of room_sort —
      // room_sort (AP-C2, audit 23.1) is purely a presentation decision,
      // so it only ever reorders `rooms` (the possibly grid-capped subset
      // that actually becomes rendered chips), never `allRooms`.
      const sortRooms = (list) => [...list].sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, this._language()));
      const allRooms = sortRooms(validRooms);
      const rooms = resolveRoomDisplayOrder(cappedRooms, config.room_sort, this._language());

      // The average IS context.averageSource's canonical value, projected
      // into the display unit — one atomic decision (see
      // _resolveMetricContext()), not the old independent avgSensor/
      // avgFallback pair that let a primary entity's own numeric-but-wrong-
      // kind reading (DATA-04: "1013 hPa") slip through untouched by the
      // room-based metricType resolution.
      const avg = toDisplay(context.averageSource.canonicalValue);

      // avgSource is the single source of truth for whether the displayed
      // average actually came from config.entity's own state; avgEntity
      // (used for the average's clickability and for _avgTone()'s/spread's
      // attribute lookups below) must follow it exactly — using a looser
      // "entity exists" check here would leave the average clickable, and
      // its color/spread sourced from a stale/unavailable primary entity,
      // even while the displayed number is the room-based fallback.
      const avgSource = context.averageSource.kind === "primary" ? "sensor" : "calculated";
      const avgEntity = avgSource === "sensor" ? config.entity : "";

      // Daily-range view: only when range_entity is configured, its state
      // is currently a valid number, AND its own unit resolves to a real
      // UnitProfile for this metric kind (review fix 2, P0: previously read
      // both raw, with no unit check at all — an entity reporting its
      // spread/min/max in a different or unresolvable unit produced wrong
      // classified/scaled numbers, e.g. a Celsius-configured card showing a
      // raw Fahrenheit "18" as if it were 18°C). rangeState is a
      // spread/delta (today's range width, quantityKind "delta" — same
      // conversion factor as the spread attribute above, never the
      // absolute +32 Fahrenheit offset); minimum/maximum are absolute
      // readings (quantityKind "absolute"). Both go through the SAME
      // resolved rangeProfile (one entity, one unit for state+attributes),
      // then through the same canonical->display projection
      // (toDisplay/toDisplayDelta) as every other number in this method.
      const metricDefinition = METRIC_DEFINITIONS[metricType];
      const rangeProfile = this._resolveAuxiliaryUnitProfile(config.range_entity, metricType);
      let rangeState = rangeProfile ? this._getNum(config.range_entity) : null;
      if (rangeState !== null) {
        rangeState = toDisplayDelta(
          this._convertMetricValue(rangeState, {
            metricKind: metricType,
            quantityKind: "delta",
            fromProfileKey: rangeProfile,
            toProfileKey: metricDefinition.canonicalProfileKey,
          })
        );
      }
      // A negative spread/delta is physically impossible (today's range
      // can't be a negative width) — checked on the DISPLAY-unit value,
      // consistent with every other physical-validity check in this method
      // running after the canonical->display projection.
      const hasRange = rangeState !== null && rangeState >= 0;
      let rangeMin = hasRange ? this._getAttrNum(config.range_entity, "minimum") : null;
      let rangeMax = hasRange ? this._getAttrNum(config.range_entity, "maximum") : null;
      if (rangeMin !== null) {
        rangeMin = toDisplay(
          this._convertMetricValue(rangeMin, {
            metricKind: metricType,
            quantityKind: "absolute",
            fromProfileKey: rangeProfile,
            toProfileKey: metricDefinition.canonicalProfileKey,
          })
        );
      }
      if (rangeMax !== null) {
        rangeMax = toDisplay(
          this._convertMetricValue(rangeMax, {
            metricKind: metricType,
            quantityKind: "absolute",
            fromProfileKey: rangeProfile,
            toProfileKey: metricDefinition.canonicalProfileKey,
          })
        );
      }
      if (rangeMin !== null && !this._isPhysicallyValid(rangeMin, metricType, context.displayUnitProfile)) rangeMin = null;
      if (rangeMax !== null && !this._isPhysicallyValid(rangeMax, metricType, context.displayUnitProfile)) rangeMax = null;
      const rangeMinTime = hasRange
        ? this._formatTime(this._hass?.states?.[config.range_entity]?.attributes?.minimum_zeitpunkt)
        : null;
      const rangeMaxTime = hasRange
        ? this._formatTime(this._hass?.states?.[config.range_entity]?.attributes?.maximum_zeitpunkt)
        : null;
      // "" (not config.range_entity) as the entity id: rangeMin/rangeMax
      // are historical readings (today's extremes, from attributes), not
      // range_entity's current state — if range_entity itself carries a
      // live value_color/value_level (a generic sensor isn't guaranteed
      // not to), both would wrongly inherit that one current classification
      // instead of their own numeric fallback tier. _roomTone()'s existing
      // "" guard (via _getEntityClassification()) already skips straight to
      // the numeric fallback, no new logic needed.
      const rangeMinColor = rangeMin !== null ? this._roomTone(rangeMin, "", metricType, context.displayUnitProfile) : null;
      const rangeMaxColor = rangeMax !== null ? this._roomTone(rangeMax, "", metricType, context.displayUnitProfile) : null;

      // Trend: only when trend_entity is configured, valid, AND its own
      // unit resolves to a real UnitProfile — typed as a RATE (review fix
      // 2, P0: same conversion factor as a delta, audit 9.5), converted
      // through the SAME two-step canonical->display projection as
      // rangeState above. trendUnit is now always "<card display unit>/h"
      // rather than the trend entity's own raw unit attribute — once the
      // NUMBER is converted into the display unit, labeling it with the
      // entity's original (pre-conversion) unit would be a label/number
      // mismatch.
      const trendProfile = this._resolveAuxiliaryUnitProfile(config.trend_entity, metricType, { rateSuffix: true });
      const rawTrendValue = trendProfile ? this._getNum(config.trend_entity) : null;
      let trendCanonicalValue = null;
      let trendValue = null;
      if (rawTrendValue !== null) {
        trendCanonicalValue = this._convertMetricValue(rawTrendValue, {
          metricKind: metricType,
          quantityKind: "rate",
          fromProfileKey: trendProfile,
          toProfileKey: metricDefinition.canonicalProfileKey,
        });
        trendValue = toDisplayDelta(trendCanonicalValue);
      }
      const trendUnit = config.trend_entity ? `${this._unit()}/h` : null;
      const trend = this._buildTrendModel(metricType, trendCanonicalValue, trendValue, trendUnit);

      // Extended mode (room chips, extreme-value view, auto-slide) needs
      // at least two valid room values. Driven by allRooms, not the
      // possibly grid-capped rooms — a room_columns/room_rows override
      // that hides chips must never turn off the room-comparison features
      // it doesn't otherwise affect.
      const hasRoomsView = allRooms.length >= 2;

      const coolest = hasRoomsView ? allRooms[0] : null;
      const warmest = hasRoomsView ? allRooms[allRooms.length - 1] : null;
      // Spread prefers the average entity's spread attribute (computed
      // server-side by averages.jinja); only recomputed locally when that
      // attribute is missing/invalid, or when the average itself is the
      // room-based fallback (avgSource !== "sensor") — the spread attribute
      // belongs to config.entity's own state and would otherwise be a stale
      // reading from a broken/unavailable primary entity. Distinct from the
      // daily-range entity's own min/max further above.
      // The spread attribute is read from config.entity's own state, in
      // that entity's own unit — canonicalized (AP-02) then projected into
      // the display unit (AP-03, toDisplayDelta — never the absolute
      // toDisplay(), a delta must never pick up the Fahrenheit +32 offset)
      // before use, so it's never compared/combined with computedSpread
      // (already display-unit, derived from display-unit room values) in
      // mismatched units. Only meaningful for "temperature" (the only kind
      // with a MetricDefinition so far, see AP-01); humidity/co2/pm25 have
      // no unit-conversion concept, so rawSpread passes through unchanged
      // there, exactly as before AP-02/AP-03.
      let rawSpread = avgSource === "sensor" ? this._getAttrNum(config.entity, "spread") : null;
      if (rawSpread !== null && context.averageSource.unitProfile && METRIC_DEFINITIONS[metricType]) {
        const definition = METRIC_DEFINITIONS[metricType];
        rawSpread = toDisplayDelta(
          this._convertMetricValue(rawSpread, {
            metricKind: metricType,
            quantityKind: "delta",
            fromProfileKey: context.averageSource.unitProfile,
            toProfileKey: definition.canonicalProfileKey,
          })
        );
      }
      // A negative spread (room-to-room range) is physically impossible;
      // treat it the same as a missing/invalid attribute.
      const attrSpread = rawSpread !== null && rawSpread >= 0 ? rawSpread : null;
      const computedSpread = hasRoomsView ? warmest.value - coolest.value : 0;
      const spread = attrSpread !== null ? attrSpread : computedSpread;

      // Dynamic scale expands beyond the profile anchor as needed or, for an
      // unanchored profile such as outdoor temperature, follows only the live
      // data range. Without room data it expands around the average instead.
      // It must cover avg too
      // (DATA-03): a weighted/independent average source can fall outside
      // [coolest, warmest], which would otherwise clamp the avg marker to
      // the scale edge — same reasoning as the rangeScale axis below.
      // _buildScaleModel() (AP-03/SCALE-01, options-object rewritten by
      // Teil C) is the single shared engine for both this main scale and
      // the rangeScale below — see there. metricType/context.displayUnitProfile
      // are resolved once, right here, and threaded through explicitly —
      // never re-resolved by any downstream helper (Teil C, review fix 3).
      const scaleMarkerValues = { avg };
      if (hasRoomsView) {
        scaleMarkerValues.coolest = coolest.value;
        scaleMarkerValues.warmest = warmest.value;
        for (const room of allRooms) scaleMarkerValues[`room_${room.index}`] = room.value;
      }
      const scaleModel = this._buildScaleModel({
        metricType,
        unitProfile: context.displayUnitProfile,
        comfortMin,
        comfortMax,
        optimalMin,
        optimalMax,
        low: hasRoomsView ? Math.min(coolest.value, avg) : avg,
        high: hasRoomsView ? Math.max(warmest.value, avg) : avg,
        markers: scaleMarkerValues,
      });
      const scaleMin = scaleModel.scaleMin;
      const scaleMax = scaleModel.scaleMax;

      const inComfort = hasRoomsView
        ? allRooms.filter((room) => room.value >= comfortMin && room.value <= comfortMax).length
        : 0;
      const tooWarm = hasRoomsView ? allRooms.filter((room) => room.value > comfortMax).length : 0;
      const tooCool = hasRoomsView ? allRooms.filter((room) => room.value < comfortMin).length : 0;

      // Positions for the comfort/optimal bands and markers on the main scale.
      const scaleGeometry = scaleModel;
      const avgPos = scaleModel.markerPositions.avg;

      // "range_scale" view (see VIEW_REGISTRY): an alternate scale bar with
      // its own dynamic bounds derived from the daily min/max instead of
      // room min/max — only computed when it can actually be shown, same
      // gating as hasRangeScale below. Reuses the exact same
      // _buildScaleModel(), just called with rangeMin/rangeMax instead of
      // coolest/warmest — the audit's required "identical geometry for
      // identical input in both views" invariant, structurally guaranteed.
      // hasRange alone isn't enough: it only reflects range_entity's own
      // state being valid, not that minimum/maximum are present too (see
      // "Daily-range view" above) — this view specifically needs both, plus
      // a sane (non-inverted) min<=max pair. AP-04: rangeScaleAvailable is
      // pure AVAILABILITY (no config gate baked in, unlike the old
      // range_scale_view-gated hasRangeScale) — resolveActiveViews() below
      // decides, from views:, whether an available range_scale view is
      // actually requested; "auto" leaves it off by default (audit 11.2).
      const rangeScaleAvailable = hasRange && rangeMin !== null && rangeMax !== null && rangeMin <= rangeMax;

      // View list: VIEW_REGISTRY order (range, range_scale, scale, extremes)
      // filtered by condition()/defaultEnabled(), then the optional YAML
      // views: config layered on top (see resolveActiveViews()) — drives
      // both the rendered .rtc-view elements and the auto-slide order (see
      // _holdSequence()). Diagnostics are surfaced once per setConfig()
      // (_warnAboutViewConfigOnce()), not re-logged here on every hass
      // update. Must run BEFORE the range_scale geometry block below —
      // hasRangeScale is now a CONSEQUENCE of whether views actually
      // resolved to include "range_scale", not an independent condition.
      const { views, entries: viewEntries } = resolveActiveViews(VIEW_REGISTRY, { hasRange, hasRoomsView, rangeScaleAvailable }, config);
      const hasRangeScale = views.includes("range_scale");

      // View-customizer "Baukasten" (Teil 2): fully resolves EVERY
      // registry view's own optionsSchema (defaults filled in) into
      // data.viewOptions.<key> — generic and additive, not specific to any
      // one option (current examples include band visibility, footer and
      // marker modes). Computed for all registry entries, not just active
      // ones (cheap, and a future consumer checking an inactive view's
      // would-be options doesn't need special-casing here).
      const viewOptions = {};
      for (const descriptor of VIEW_REGISTRY) {
        const entry = viewEntries.find((e) => e.type === descriptor.key);
        viewOptions[descriptor.key] = resolveViewOptions(descriptor, entry?.options);
      }

      // AP-05 (audit sections 13, 14.1): the null-view state has two
      // distinct causes that must render differently (explicit user
      // instruction, not the audit's own "optional" framing) — a
      // deliberately empty/fully-disabled views: config collapses the view
      // area entirely (no markup at all), while a view that was actually
      // REQUESTED but is systemically unavailable (e.g. range_scale
      // requested with no valid range_entity) shows a localized hint
      // instead, so the user can tell "nothing to show by design" apart
      // from "something's misconfigured". `entries` (from
      // resolveActiveViews(), not just the flat `views` list) is what makes
      // the distinction possible: requested/available are tracked
      // separately per entry, not collapsed into a single active flag.
      const anyRequestedButUnavailable = viewEntries.some((e) => e.requested && !e.available);
      const viewAreaCollapsed = views.length === 0 && !anyRequestedButUnavailable;

      let rangeScaleGeometry = null;
      let rangeCurrentPos = 0;
      let rangeMinPos = 0;
      let rangeMaxPos = 0;
      if (hasRangeScale) {
        // The axis must cover every value actually rendered on it,
        // including avg — which can fall outside [rangeMin, rangeMax] when
        // range_entity updates less often than entity (see readme climate
        // card.md, "Auto-Slide und Bedienung"). Building the axis from only
        // rangeMin/rangeMax would then clamp the avg marker to 0 or 100%
        // even though the edge labels show a different min/max.
        const rangeScaleModel = this._buildScaleModel({
          metricType,
          unitProfile: context.displayUnitProfile,
          comfortMin,
          comfortMax,
          optimalMin,
          optimalMax,
          low: Math.min(rangeMin, avg),
          high: Math.max(rangeMax, avg),
          markers: { current: avg, min: rangeMin, max: rangeMax },
        });
        rangeScaleGeometry = rangeScaleModel;
        rangeCurrentPos = rangeScaleModel.markerPositions.current;
        rangeMinPos = rangeScaleModel.markerPositions.min;
        rangeMaxPos = rangeScaleModel.markerPositions.max;
      }

      let coolestPos = 0;
      let warmestPos = 0;
      let coolestShift = 0;
      let warmestShift = 0;
      let coolestColor = null;
      let warmestColor = null;
      let scaleRoomMarkers = [];
      if (hasRoomsView) {
        coolestPos = scaleModel.markerPositions.coolest;
        warmestPos = scaleModel.markerPositions.warmest;
        const markerOverlap = Math.abs(warmestPos - coolestPos) < 1.6;
        coolestShift = markerOverlap ? -4 : 0;
        warmestShift = markerOverlap ? 4 : 0;
        coolestColor = this._roomTone(coolest.value, coolest.entity, metricType, context.displayUnitProfile);
        warmestColor = this._roomTone(warmest.value, warmest.entity, metricType, context.displayUnitProfile);
        scaleRoomMarkers = allRooms.map((room) => ({
          index: room.index,
          entity: room.entity,
          name: room.name,
          value: room.value,
          position: scaleModel.markerPositions[`room_${room.index}`],
          color: this._roomTone(room.value, room.entity, metricType, context.displayUnitProfile),
        }));
      }

      const tone = this._avgTone(avg, avgEntity, metricType, context.displayUnitProfile);
      const avgColor = tone.color;

      // Short status line under the title; without room data it stays
      // limited to the plain average assessment.
      let subtitle = "";
      if (avg > comfortMax) {
        subtitle = hasRoomsView
          ? this._t("subtitle.aboveComfort", { diff: this._fmtWithUnit(avg - comfortMax), count: tooWarm, total: allRooms.length, adjective: this._t(this._metricMetaFor(metricType).aboveAdjectiveKey) })
          : this._t("subtitle.aboveComfortNoRooms", { diff: this._fmtWithUnit(avg - comfortMax) });
      } else if (avg < comfortMin) {
        subtitle = hasRoomsView
          ? this._t("subtitle.belowComfort", { diff: this._fmtWithUnit(comfortMin - avg), count: tooCool, total: allRooms.length, adjective: this._t(this._metricMetaFor(metricType).belowAdjectiveKey) })
          : this._t("subtitle.belowComfortNoRooms", { diff: this._fmtWithUnit(comfortMin - avg) });
      } else if (hasRoomsView && tooWarm + tooCool > 0) {
        // The out-of-comfort room furthest from avg is always coolest or
        // warmest (avg sits between the global min/max, and |x-avg| is
        // maximized at one of those two endpoints) — so this reuses those
        // already-computed objects instead of re-deriving via a second,
        // independent sort. That second sort used to tie-break differently
        // from coolest/warmest's own sort on an exact value tie, so the
        // named room and the "warmest/coolest room" card could disagree.
        const warmestOut = warmest.value > comfortMax;
        const coolestOut = coolest.value < comfortMin;
        const issue = warmestOut && coolestOut
          ? (Math.abs(warmest.value - avg) >= Math.abs(coolest.value - avg) ? warmest : coolest)
          : warmestOut ? warmest : coolest;
        subtitle = this._t("subtitle.inComfortIssue", { name: issue.name });
      } else if (hasRoomsView) {
        subtitle = this._t("subtitle.inComfortAllGood");
      } else {
        subtitle = this._t("subtitle.inComfort");
      }

      const missingRooms = config.rooms.length - allRooms.length;
      if (missingRooms > 0) {
        subtitle += this._t("subtitle.missingRooms", { count: missingRooms });
      }

      // AP-C2: show_rooms:false hides only the rendered chip grid --
      // hasRoomsView itself (and everything derived from allRooms: coolest/
      // warmest, comfort count, spread, the scale's cold/warm markers)
      // stays exactly as it would with rooms visible, since rooms remain
      // full data sources either way.
      const showRoomChips = hasRoomsView && config.show_rooms !== false;

      // Central view model for rendering and updates.
      return {
        empty: false,
        hasRoomsView,
        showRoomChips,
        hasRange,
        rangeState,
        hasRangeScale,
        views,
        viewOptions,
        viewAreaCollapsed,
        metricType,
        // Teil C (review fix 3): exposed so render functions that call
        // _roomTone() directly (_renderExtremeCard()/_renderRoomChip(),
        // outside this method's own scope) can pass the SAME explicitly-
        // resolved profile _computeData() itself used, instead of each
        // re-resolving it independently.
        displayUnitProfile: context.displayUnitProfile,
        title,
        avg,
        avgLabel: config.avg_label || this._t("avg.label"),
        avgEntity,
        avgSource,
        rooms,
        roomCount: allRooms.length,
        roomRows: roomGrid.rowSizes,
        coolest,
        warmest,
        spread,
        rangeMin,
        rangeMax,
        rangeMinTime,
        rangeMaxTime,
        rangeMinColor,
        rangeMaxColor,
        trendValue,
        trendUnit,
        trend,
        inComfort,
        comfortMin,
        comfortMax,
        // optimalMin/optimalMax/scaleMin/scaleMax/comfortLeft/comfortWidth/
        // comfortCenter/optimalLeft/optimalWidth/optimalCenter come from scaleGeometry.
        ...scaleGeometry,
        avgPos,
        coolestPos,
        warmestPos,
        coolestShift,
        warmestShift,
        coolestColor,
        warmestColor,
        scaleRoomMarkers,
        avgColor,
        tone,
        subtitle,
        rangeScaleGeometry,
        rangeCurrentPos,
        rangeMinPos,
        rangeMaxPos,
      };
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
      if (allowSkip && signature === this._lastRenderSignature) return;

      const data = this._computeData();
      const currentlyEmpty = Boolean(this.shadowRoot.querySelector(".rtc-empty"));
      // showRoomChips (AP-C2: hasRoomsView AND show_rooms !== false) drives
      // the room-chip grid, a DOM section independent of the view
      // carousel; a change forces a full rebuild instead of a partial
      // update. Can change from a plain data update, not just a config
      // change (e.g. a second room becoming available), so this check
      // can't be skipped even when setConfig() wasn't just called.
      const currentlyHasRooms = Boolean(this.shadowRoot.querySelector(".rtc-room-grid"));
      // The view carousel's own structure is checked generically: does the
      // exact ordered list of view keys differ from what's currently
      // mounted (this._views, set by the last _renderAll())? This catches
      // any availability, count, or pure ordering change for any current
      // or future view — not just a hardcoded set of flags that would need
      // a new one added by hand for every new view type.
      const currentViews = this._views || [];
      const currentViewAreaCollapsed = this._viewAreaCollapsed || false;
      // P1 fix (post-2.22.1): data.views alone is [] for BOTH null-view
      // states (deliberately collapsed vs. requested-but-unavailable, see
      // data.viewAreaCollapsed at _computeData()), so a transition between
      // them must also be caught here — otherwise it's invisible to this
      // check and _renderAll() never fires, leaving the DOM (no markup vs.
      // .rtc-no-views) stuck on whichever state rendered first.
      const viewsChanged = data.empty
        ? false
        : currentViews.length !== data.views.length ||
          data.views.some((key, i) => key !== currentViews[i]) ||
          data.viewAreaCollapsed !== currentViewAreaCollapsed;

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
      // doesn't touch that list at all — _updateContent()'s partial patch
      // path can't add/remove the comfort/optimal band <div>s
      // (_updateScaleBarCommon() only patches elements that already exist),
      // so any options change must force a full rebuild too. Generic and
      // future-proof: covers every current and future structural view
      // option, not just the band toggles.
      const structuralConfigSignature = `${this._config.hide_footer}|${this._config.rotation_seconds}|${this._config.slide_seconds}|${this._config.auto_slide}|${JSON.stringify(this._config.views)}`;
      const structuralConfigChanged = structuralConfigSignature !== this._structuralConfigSignature;

      // Both signatures are committed only after a render path actually
      // succeeds (set hass()'s try/catch means a thrown _computeData()/
      // _renderAll()/_updateContent()/_updateEmpty() skips the assignment
      // below entirely) — committing upfront would suppress a correct
      // retry of the exact same, currently-failing update, since the next
      // identical hass push would compute the same signature and be
      // silently skipped as "unchanged".
      if (
        !this._rendered ||
        data.empty !== currentlyEmpty ||
        (!data.empty && (data.showRoomChips !== currentlyHasRooms || viewsChanged || structuralConfigChanged))
      ) {
        this._renderAll(data);
        this._lastRenderSignature = signature;
        this._structuralConfigSignature = structuralConfigSignature;
        return;
      }

      if (data.empty) {
        this._updateEmpty(data);
        this._lastRenderSignature = signature;
        this._structuralConfigSignature = structuralConfigSignature;
        return;
      }

      this._updateContent(data);
      this._lastRenderSignature = signature;
      this._structuralConfigSignature = structuralConfigSignature;
    }

    _renderAll(data) {
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
      this._lastRenderData = data;

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
      // _renderContent()'s `data.views.length >= 2 ? ... : ...`).
      // _applyAutoSlideStyles() bails out on its very first line when
      // there's no track, so it never reaches _scheduleAccessibilitySync()
      // — the only place that otherwise clears this._a11ySyncTimer. Without
      // this, a timer armed while >=2 views were active would linger
      // (harmless once it eventually fires and self-corrects, but violates
      // "Timer nur ab zwei aktiven Views" until then). _stopRotation()
      // clears both timers unconditionally; the branches below re-arm
      // exactly what's actually warranted for the NEW view count — for
      // every other transition this is a harmless no-op, since
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
      this._views = data.empty ? [] : (data.views || []);
      this._viewAreaCollapsed = data.empty ? false : Boolean(data.viewAreaCollapsed);
      let nextIndex = this._views.indexOf(previousActiveKey);
      if (nextIndex === -1) nextIndex = this._views.indexOf(this._config?.start_view);
      // AP-04: the "mandatory scale" fallback is gone along with mandatory
      // itself — nextIndex === -1 ? 0 : nextIndex already IS "the first
      // active view" (index 0 of this._views), which is exactly the
      // correct final fallback now that any view, including "scale", can
      // be absent.
      this._activeView = nextIndex === -1 ? 0 : nextIndex;

      this.shadowRoot.innerHTML = `
        <style>${this._styles()}</style>
        <ha-card class="rtc-card">
          ${data.empty ? this._renderEmpty(data) : this._renderContent(data)}
        </ha-card>
      `;
      this._bindEvents();
      this._rendered = true;
      if (!isFirstRender && !data.empty) {
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
      this._resolveAllScaleLabelPositions(data);
      // On a cold dashboard reload, this first synchronous measurement can
      // run before the page's web font has actually loaded (the card
      // inherits its font from the page, no @font-face of its own) — the
      // fallback-font metrics produce a slightly wrong position that looks
      // like an overlap until the next real render corrects it. Re-resolve
      // once, exactly once per card instance (not once per full rebuild —
      // _fontsReadyBound guards against registering a fresh .then() on
      // every hasRoomsView/hasRange/hasRangeScale-triggered rebuild before
      // fonts finish loading, which would each close over that call's own
      // data and could re-apply a stale one after a newer rebuild already
      // ran); a no-op in the common case where fonts were already ready.
      // Uses this._lastRenderData at fire time, not the data closed over
      // here, so it's never stale even if it fires after a later update.
      if (!data.empty && document.fonts?.ready && !this._fontsReadyBound) {
        this._fontsReadyBound = true;
        document.fonts.ready
          .then(() => {
            if (this.isConnected) this._resolveAllScaleLabelPositions(this._lastRenderData);
          })
          .catch(() => {});
      }
    }

    _resolveLabelForm(el, longText, shortText, fitsWithWidth) {
      // Long-/short-form label architecture (post-2.27.0 review): a
      // collision-prone label (e.g. scale.optimalLabel, rangeScale.
      // currentLabel) is never permanently shortened in TRANSLATIONS —
      // instead both a canonical long form and a short fallback are
      // available, and the card picks between them here at measure time,
      // based on the ACTUAL rendered width, the same way
      // _resolveOptimalLabelPosition()/_resolveRangeScaleLabels() already
      // measure real geometry rather than guessing from character counts.
      // Always tries the long form FIRST and reverts to it whenever there's
      // room again (this runs on every resolve pass — resize, font-ready,
      // every data update — so growing the card back out restores the long
      // form on the very next pass, not just once at load). The short form
      // is a deliberate intermediate step BEFORE the existing CSS-ellipsis
      // max-width fallback (still applied by the caller below when even
      // the short form doesn't fit) — a real word beats a truncated one
      // whenever there's a real word that fits.
      el.textContent = longText;
      if (longText === shortText) return el.getBoundingClientRect().width;
      const longWidth = el.getBoundingClientRect().width;
      if (fitsWithWidth(longWidth)) return longWidth;
      el.textContent = shortText;
      return el.getBoundingClientRect().width;
    }

    _resolveOptimalLabelPosition(containerEl, geometry) {
      // The optimal label under the bar is centered on
      // geometry.optimalCenter (a percentage), but text width is fixed in
      // pixels while the bar's rendered width varies with card/viewport
      // size — a percentage alone can't guarantee it won't visually
      // overlap the min/max value labels in the same row (most relevant
      // for co2/pm25, whose optimal band always starts at the scale's left
      // edge). This measures the actual rendered widths (only possible
      // after the DOM exists) and positions the label in pixels at the
      // nearest point that doesn't overlap. Always derives the desired
      // position fresh from geometry.optimalCenter — the one authoritative
      // source — rather than reading back its own previous (already-in-
      // pixels) output, so repeated calls never drift.
      // Scoped to containerEl (that view's own .rtc-scale-view/
      // .rtc-range-scale-view wrapper), not the whole shadow root, because
      // both scale-bar views can exist in the DOM at once (the carousel
      // keeps every view mounted, sliding between them) and share the same
      // inner class names — a root-wide query would only ever find the first.
      if (!containerEl) return;
      const bar = containerEl.querySelector(".rtc-scale-bar");
      const minEl = containerEl.querySelector(".rtc-scale-label-min");
      const centerEl = containerEl.querySelector(".rtc-scale-label-center");
      const maxEl = containerEl.querySelector(".rtc-scale-label-max");
      if (!bar || !minEl || !centerEl || !maxEl) return;

      // A previous call may have constrained centerEl's own width (see
      // max-width below); clearing it first guarantees this call measures
      // centerEl's natural, unconstrained width. Without this, a second
      // call shortly after the first would measure the already-shrunk box,
      // wrongly conclude it now "fits", clear max-width again, and let the
      // text spring back to full width — an infinite reflow/re-narrow loop
      // between repeated calls (observed via the resize observer, which can
      // legitimately fire more than once for a single resize).
      centerEl.style.maxWidth = "";

      const barWidth = bar.getBoundingClientRect().width;
      if (!barWidth) return;
      const minWidth = minEl.getBoundingClientRect().width;
      const maxWidth = maxEl.getBoundingClientRect().width;

      const gap = 4; // minimum visual gap in px between adjacent labels
      // Long-/short-form resolution (see _resolveLabelForm()): "fits" here
      // is the exact same lowLimit<=highLimit criterion computed below,
      // just evaluated once for whichever centerWidth the candidate form
      // actually measures at.
      const range = `${this._fmt(geometry.optimalMin, 0)}–${this._fmtWithUnit(geometry.optimalMax, 0, false)}`;
      const longText = this._t("scale.optimalLabel", { range });
      const shortText = this._t("scale.optimalLabelShort", { range });
      const centerWidth = this._resolveLabelForm(
        centerEl,
        longText,
        shortText,
        (width) => minWidth + gap + width / 2 <= barWidth - maxWidth - gap - width / 2
      );

      const desiredPx = (barWidth * geometry.optimalCenter) / 100;
      const lowLimit = minWidth + gap + centerWidth / 2;
      const highLimit = barWidth - maxWidth - gap - centerWidth / 2;
      // If there isn't enough room anywhere even for the short form (very
      // narrow bar/very long label), centering it is the fairest fallback —
      // better than pinning fully against one side. In that case the
      // label's own width is also capped to the space actually available
      // between min/max (see the matching text-overflow:ellipsis in
      // _styles()), so it visibly truncates instead of overlapping its
      // neighbors — the fallback above only prevents anchoring the label
      // off-center, not overlap by itself when centerWidth alone already
      // exceeds the free space. The label is centered at barWidth/2
      // (symmetric), so the space actually available to it is bounded by
      // whichever side (min/max) is tighter, used on *both* sides — not
      // minWidth+maxWidth combined, which would only be safe for an
      // (impossible, for a centered box) asymmetric split matching each
      // side's individual slack exactly.
      const fits = lowLimit <= highLimit;
      const targetPx = fits ? this._clamp(desiredPx, lowLimit, highLimit) : barWidth / 2;
      centerEl.style.left = `${targetPx}px`;
      centerEl.style.maxWidth = fits ? "" : `${Math.max(0, barWidth - 2 * Math.max(minWidth, maxWidth) - gap * 2)}px`;
    }

    _resolveAllScaleLabelPositions(data) {
      // Re-resolves every currently-rendered scale-bar's floating label(s)
      // — the main "scale" view always, "rangeScale" only when it exists.
      // Single entry point for triggers that don't know (or care) which
      // scale-bar-shaped views currently exist: initial render, resize,
      // font-ready (see _bindResizeObserver(), _renderAll()).
      if (!this.shadowRoot || !data || data.empty) return;
      const scaleContainer = this.shadowRoot.querySelector(".rtc-scale-view");
      if (scaleContainer) this._resolveOptimalLabelPosition(scaleContainer, data);
      if (data.hasRangeScale) {
        const rangeScaleContainer = this.shadowRoot.querySelector(".rtc-range-scale-view");
        if (rangeScaleContainer) {
          // rangeScale has its own shared-template optimal label (from
          // _renderScaleBar(), same as the main scale view) in addition to
          // its three top labels — both need resolving here, or the
          // optimal label stays at its unresolved initial percentage
          // through the first render, a resize, and font-ready, only
          // catching up on the next actual data update (which routes
          // through _updateScaleBarCommon() instead).
          this._resolveOptimalLabelPosition(rangeScaleContainer, data.rangeScaleGeometry);
          this._resolveRangeScaleLabels(rangeScaleContainer, data);
        }
      }
    }

    _resolveRangeScaleLabels(containerEl, data) {
      // Hotfix (post-2.22.0, "jetzt"-Marker-Zuordnung): current is a FIXED
      // pivot, never repositioned by collision avoidance — only min/max are
      // ever allowed to drift from their own anchor to avoid overlapping a
      // neighbor. The previous version modeled all three labels as equally
      // free-floating items in one shared forward-/backward-pass declutter
      // group; that shared group also included an edge-clamp step ("shift
      // the WHOLE group" if any member ran past the bar's own edge), which
      // could silently drag current away from its own marker even without a
      // direct current/neighbor collision (e.g. min or max naturally
      // anchored right at 0%/100% of a wide value range) — current has no
      // stable visual identity distinct from a marker directly above it, so
      // a drifted current label reads as belonging to whichever marker it
      // ends up nearest, typically max. current is the primary live value;
      // min/max are historical context values that can absorb a shift
      // without creating a misleading reading. See readme climate card.md,
      // "Tagesbereich-Balken-Ansicht" for the full policy writeup.
      if (!containerEl) return;
      const bar = containerEl.querySelector(".rtc-scale-bar");
      const currentEl = containerEl.querySelector(".rtc-range-scale-label-current");
      const minEl = containerEl.querySelector(".rtc-range-scale-label-min");
      const maxEl = containerEl.querySelector(".rtc-range-scale-label-max");
      const topRow = containerEl.querySelector(".rtc-range-scale-top-row");
      if (!bar || !currentEl || !minEl || !maxEl || !topRow) return;
      const barWidth = bar.getBoundingClientRect().width;
      if (!barWidth) return;

      const gap = 4;
      // Reset any previous shrink before measuring natural widths — else a
      // still-applied max-width from an earlier narrow-bar resolve would
      // be measured as if it were the label's natural size (the same
      // measure-before-shrink idempotency _resolveOptimalLabelPosition()
      // already depends on).
      for (const el of [currentEl, minEl, maxEl]) el.style.maxWidth = "";

      // Step 1: fix current's own center. Long-/short-form resolution (see
      // _resolveLabelForm()) happens first: current reserves
      // [currentLeft-gap, currentRight+gap] exclusively for itself (Step 3
      // below never lets min/max encroach on it), so a long current label
      // eating too much of the bar can starve min/max of room — the short
      // form is tried before that happens. "Fits" here is deliberately the
      // WORST case (min and max both landing on the same side, e.g. when
      // avg sits outside [min,max] — see Step 2 below): current's reserved
      // width plus the standard gaps must still leave enough room for BOTH
      // side labels' natural widths stacked together, even though they
      // usually split across both sides and so usually have much more room
      // than this. Never a consequence of an actual min/max-vs-min/max
      // collision (that's still Step 3/_layoutSideLabelGroup()'s own job,
      // via its existing ellipsis fallback) — only of current's own width.
      // minEl/maxEl are measured lazily, inside the fits closure, so most
      // languages (whose *Short form is identical to the long form —
      // _resolveLabelForm() short-circuits before ever calling fits) never
      // pay for these two extra reflows at all.
      const currentLongText = this._t("rangeScale.currentLabel");
      const currentShortText = this._t("rangeScale.currentLabelShort");
      let currentWidth = this._resolveLabelForm(
        currentEl,
        currentLongText,
        currentShortText,
        (width) => barWidth - width - 2 * gap >= minEl.getBoundingClientRect().width + gap + maxEl.getBoundingClientRect().width
      );
      if (currentWidth > barWidth) {
        currentEl.style.maxWidth = `${barWidth}px`;
        currentWidth = currentEl.getBoundingClientRect().width;
      }
      const currentAnchor = (barWidth * data.rangeCurrentPos) / 100;
      const currentCenter = this._clamp(currentAnchor, currentWidth / 2, barWidth - currentWidth / 2);
      const currentLeft = currentCenter - currentWidth / 2;
      const currentRight = currentCenter + currentWidth / 2;
      currentEl.style.left = `${currentCenter}px`;

      // Step 2: assign min/max to a side of the fixed current pivot, by the
      // same displayed-value + semanticRank tie-break UI-01 already
      // established (min=0, current=1, max=2 — see _fmt()). AP-06 fix
      // (audit section 15, UI-01 follow-up): the tie-detection string
      // (displayKey) is only ever compared for EQUALITY, never re-parsed
      // back into a number — a grouped/thousands-separated display value
      // (e.g. "1,200") is not valid Number() input and used to compare as
      // NaN, which made the old rounded-then-Number() tie-break always fall
      // through to "right" for any value >=1000. Actual ordering when not
      // tied uses the raw numeric value/data.avg, never the formatted
      // string. This is what makes "current outside [rangeMin, rangeMax]"
      // (range_entity updates less often than entity — see "Auto-Slide und
      // Bedienung") fall out naturally: if both min and max are numerically
      // below (or both above) current, both are assigned the same side and
      // packed together there, preserving their own min-before-max order —
      // no separate branch needed for that case.
      const digits = this._config.decimals ?? this._metricMeta().decimals;
      const displayKey = (value) => this._fmt(value, digits);
      const currentKey = displayKey(data.avg);
      const sideItems = [
        { el: minEl, anchor: (barWidth * data.rangeMinPos) / 100, value: data.rangeMin, semanticRank: 0 },
        { el: maxEl, anchor: (barWidth * data.rangeMaxPos) / 100, value: data.rangeMax, semanticRank: 2 },
      ].map((item) => {
        const key = displayKey(item.value);
        const side = key !== currentKey ? (item.value < data.avg ? "left" : "right") : (item.semanticRank < 1 ? "left" : "right");
        return { ...item, side, width: item.el.getBoundingClientRect().width };
      });
      const leftItems = sideItems.filter((item) => item.side === "left").sort((a, b) => a.value - b.value);
      const rightItems = sideItems.filter((item) => item.side === "right").sort((a, b) => a.value - b.value);

      // Step 3: keep as many historical labels as possible on current's
      // lower line. If a side group does not fit naturally between the
      // fixed pivot and its outer edge, lift ONLY the item nearest current
      // (last on the left, first on the right), then re-check. This targets
      // the actual collision instead of moving the unrelated label on the
      // opposite side too. Lifted items reuse _layoutSideLabelGroup() over
      // the full bar width; lower items keep the established independent
      // side packing. No label geometry feeds back into the value-derived
      // scale, and current never moves horizontally.
      const fitsNaturally = (items, edgeMin, edgeMax) =>
        items.length === 0 ||
        items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1) <= edgeMax - edgeMin;
      const liftUntilFit = (items, edgeMin, edgeMax, side) => {
        const lower = [...items];
        const upper = [];
        while (lower.length && !fitsNaturally(lower, edgeMin, edgeMax)) {
          upper.push(side === "left" ? lower.pop() : lower.shift());
        }
        return { lower, upper };
      };
      const leftLayout = liftUntilFit(leftItems, 0, currentLeft - gap, "left");
      const rightLayout = liftUntilFit(rightItems, currentRight + gap, barWidth, "right");
      const upperItems = [...leftLayout.upper, ...rightLayout.upper]
        .sort((a, b) => a.value - b.value || a.semanticRank - b.semanticRank);

      topRow.classList.toggle("rtc-range-scale-has-upper", upperItems.length > 0);
      for (const item of sideItems) {
        item.el.classList.toggle("rtc-range-scale-label-upper", upperItems.includes(item));
      }
      this._layoutSideLabelGroup(leftLayout.lower, 0, currentLeft - gap, gap);
      this._layoutSideLabelGroup(rightLayout.lower, currentRight + gap, barWidth, gap);
      this._layoutSideLabelGroup(upperItems, 0, barWidth, gap);

      for (const item of sideItems) {
        item.el.style.left = `${item.left + item.width / 2}px`;
      }
    }

    _layoutSideLabelGroup(items, edgeMin, edgeMax, gap) {
      // Positions 0-2 labels (already sorted ascending by value, i.e. the
      // desired left-to-right reading order within this group) inside
      // [edgeMin, edgeMax] — the same deterministic forward-pass/clamp-
      // right/backward-pass/clamp-left declutter _resolveRangeScaleLabels()
      // used to run once for all three labels together, now run
      // independently per side of the fixed current pivot (see there).
      // Mutates each item's .left/.width in place; does not touch the DOM
      // (the caller applies el.style.left once, after both sides are laid
      // out) or the fixed current pivot itself.
      if (items.length === 0) return;
      const available = edgeMax - edgeMin;
      const requiredWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
      if (requiredWidth > available) {
        const maxWidthEach = Math.max(0, (available - gap * (items.length - 1)) / items.length);
        for (const item of items) {
          item.el.style.maxWidth = `${maxWidthEach}px`;
          item.width = Math.min(item.width, item.el.getBoundingClientRect().width);
        }
      }

      for (const item of items) item.left = item.anchor - item.width / 2;

      for (let i = 1; i < items.length; i++) {
        items[i].left = Math.max(items[i].left, items[i - 1].left + items[i - 1].width + gap);
      }
      const overflow = items[items.length - 1].left + items[items.length - 1].width - edgeMax;
      if (overflow > 0) {
        for (const item of items) item.left -= overflow;
      }
      for (let i = items.length - 2; i >= 0; i--) {
        items[i].left = Math.min(items[i].left, items[i + 1].left - gap - items[i].width);
      }
      const underflow = Math.min(0, items[0].left - edgeMin);
      if (underflow < 0) {
        for (const item of items) item.left -= underflow;
      }
    }

    _emptyHint(data) {
      // Shared empty-state hint text for _renderEmpty()/_updateEmpty();
      // avoids a misleading "room entity" wording when no rooms are configured.
      if (this._config?.rooms?.length === 0) {
        return this._t("empty.hintNoRooms");
      }
      return data?.missingRooms
        ? this._t("empty.hintMissingRooms", { count: data.missingRooms })
        : this._t("empty.hintNoRoomData");
    }

    _updateEmpty(data) {
      // Updates the empty state without a full DOM rebuild.
      const root = this.shadowRoot;
      if (!root) return;
      this._lastRenderData = data;
      const titleEl = root.querySelector(".rtc-empty-title");
      if (titleEl) titleEl.textContent = data.title;
      const subtitleEl = root.querySelector(".rtc-empty-subtitle");
      if (subtitleEl) {
        subtitleEl.textContent = `${this._t("empty.title")} ${this._emptyHint(data)}`;
      }
      // An empty→empty update (e.g. the configured entity is swapped for a
      // different mode while both stay unavailable) still needs its icon
      // to follow the new mode — title/subtitle alone would leave a stale
      // icon from the previous mode.
      const iconEl = root.querySelector(".rtc-empty-icon ha-icon");
      if (iconEl) iconEl.setAttribute("icon", this._metricMetaFor(data.metricType).emptyIcon);
    }

    _toneStyle(data) {
      // CSS variables for the current tone color, consumed by several child elements.
      return `--tone-color:${data.tone.color};--tone-soft:${data.tone.soft};--tone-border:${this._rgba(data.tone.color, 0.38)};--tone-band:${this._rgba(data.tone.color, 0.20)};`;
    }

    // ==== AP-09 (audit 18, A11Y-02): keyed DOM-patching helpers ====
    // Average/Rooms/Range/Extrema used to be fully replaced via `innerHTML =`
    // on every single hass update, destroying and recreating every
    // focusable <button> even when only a number changed -- a focused
    // element vanished and activeElement fell back to the shadow root/host/
    // body. The methods below patch existing nodes' attributes/text in
    // place instead, only ever falling back to a full (re-)render for the
    // rare cases that are genuinely structural (a room's entity appearing/
    // disappearing, the average's interactive-vs-disabled shape flipping).
    // Scale/RangeScale (_updateScaleBarCommon()) were already correct
    // (attribute patching, no innerHTML) and are untouched here.

    _htmlToElement(html) {
      // Parses an already-_esc()-safe HTML string (the output of an
      // existing _renderXxx() string-builder) into one detached element.
      // The ONLY place the update path still parses HTML, and only for
      // genuinely NEW nodes (a new room appearing, a shape change) -- never
      // for an existing node that merely needs new content, which is
      // patched in place instead. Reuses the same, already-correct,
      // already-escaped _renderXxx() builders rather than maintaining a
      // second, independent description of each element's markup.
      const wrapper = this.ownerDocument.createElement("div");
      wrapper.innerHTML = html.trim();
      return wrapper.firstElementChild;
    }

    _focusFallbackTarget() {
      // Deterministic fallback target (audit 18.1: "etwa auf den
      // Average-Button oder den Card-Host mit erklärtem ARIA-Status") for
      // when a focused element genuinely disappears. The average button is
      // preferred when it exists AND is the interactive (button) shape --
      // the disabled div variant is never a valid target, it isn't
      // focusable. `.rtc-root` (tabindex="-1" in the template, see
      // _renderAll()) is the last-resort fallback, e.g. when no entity:
      // is configured or the average itself is currently non-interactive.
      const root = this.shadowRoot;
      if (!root) return null;
      const avgButton = root.querySelector("button.rtc-avg-button");
      if (avgButton) return avgButton;
      return root.querySelector(".rtc-root");
    }

    _applyFocusFallback() {
      const target = this._focusFallbackTarget();
      if (target) target.focus();
    }

    _updateAverage(avgEl, data) {
      // Patches the average button/disabled-div in place when its shape
      // (interactive vs. disabled) hasn't changed -- the common case, one
      // per hass update. Only falls back to a full replace when the shape
      // itself must change (avgEntity presence flipped, a genuinely
      // structural, comparatively rare transition) or on the very first
      // call (avgEl still empty).
      if (!avgEl) return;
      const hasEntity = Boolean(data.avgEntity);
      const child = avgEl.firstElementChild;
      const existing = child && (hasEntity ? child.tagName === "BUTTON" && child.classList.contains("rtc-avg-button") : child.classList.contains("rtc-avg-button-disabled")) ? child : null;
      if (existing) {
        this._patchAverage(existing, data);
        return;
      }

      const focusedWithin = this.shadowRoot?.activeElement && avgEl.contains(this.shadowRoot.activeElement);
      avgEl.replaceChildren(this._htmlToElement(this._renderAverage(data)));
      if (focusedWithin) this._applyFocusFallback();
    }

    _patchAverage(el, data) {
      // Shared attribute/text patch for both the interactive button and
      // the disabled div shape -- mirrors _renderAverage()'s two branches
      // field-for-field. Uses setAttribute()/textContent exclusively
      // (never innerHTML), which is itself a modest security hardening
      // (audit 21.3) on top of the focus fix: no interpolated string is
      // ever re-parsed as HTML for an update that only changes a value.
      const tooltip = this._averageTooltip(data);
      el.setAttribute("title", tooltip);
      if (data.avgEntity) {
        el.setAttribute("data-entity", data.avgEntity);
      }
      el.setAttribute("aria-label", this._averageAriaLabel(data, tooltip));
      el.querySelector(".rtc-avg-label").textContent = data.avgLabel;
      el.querySelector(".rtc-avg-value-num").textContent = this._fmt(data.avg);
      el.querySelector(".rtc-avg-value-unit").textContent = this._unit();
      const hasTrend = Boolean(data.trend);
      el.classList.toggle("rtc-has-trend", hasTrend);
      if (hasTrend) {
        el.setAttribute("data-trend-direction", data.trend.direction);
      } else {
        el.removeAttribute("data-trend-direction");
      }
      const arrowEl = el.querySelector(".rtc-avg-trend-arrow");
      arrowEl.hidden = !hasTrend;
    }

    _updateContent(data) {
      // Fast partial update on new HA values: only text, markers, colors,
      // and dynamic subsections change, so the slider animation never restarts.
      const root = this.shadowRoot;
      if (!root) return;
      this._lastRenderData = data;

      const contentRoot = root.querySelector(".rtc-root");
      if (contentRoot) {
        contentRoot.setAttribute("style", this._toneStyle(data));
        contentRoot.setAttribute("data-metric", data.metricType);
      }

      const iconEl = root.querySelector(".rtc-icon-badge ha-icon");
      if (iconEl) iconEl.setAttribute("icon", data.tone.icon);

      const titleEl = root.querySelector(".rtc-title");
      if (titleEl) titleEl.textContent = data.title;

      const subtitleEl = root.querySelector(".rtc-subtitle");
      if (subtitleEl) subtitleEl.textContent = data.subtitle;

      const statusEl = root.querySelector(".rtc-status-pill");
      if (statusEl) statusEl.textContent = data.tone.label;

      const avgEl = root.querySelector(".rtc-average");
      this._updateAverage(avgEl, data);

      const roomGrid = root.querySelector(".rtc-room-grid");
      this._updateRoomGrid(roomGrid, data);

      // Each view (range/scale/extremes) patches its own subsection; a
      // view not currently in the DOM (its VIEW_REGISTRY condition was
      // false) is a no-op via its own querySelector guard.
      VIEW_REGISTRY.forEach((v) => v.update(this, root, data));
    }

    _updateScaleBarCommon(containerEl, data, geometry, footerText) {
      // Shared partial-update for one scale bar's comfort/optimal band
      // position, scale-edge min/max labels, optimal-band label, and footer
      // — everything both "scale" and "rangeScale" views have identically
      // (see _renderScaleBar()). Scoped to containerEl, not the whole
      // shadow root, for the same reason as _resolveOptimalLabelPosition()
      // (both views' bars can coexist in the DOM at once). AP-06: footerText
      // is computed by the caller (same expression as its render path),
      // not decided in here — mirrors _renderScaleBar()'s own change.
      if (!containerEl) return;

      const comfortBandEl = containerEl.querySelector(".rtc-comfort-band");
      if (comfortBandEl) {
        comfortBandEl.style.left = `${geometry.comfortLeft}%`;
        comfortBandEl.style.width = `${geometry.comfortWidth}%`;
        comfortBandEl.hidden = !geometry.comfortVisible;
      }

      const optimalBandEl = containerEl.querySelector(".rtc-optimal-band");
      if (optimalBandEl) {
        optimalBandEl.style.left = `${geometry.optimalLeft}%`;
        optimalBandEl.style.width = `${geometry.optimalWidth}%`;
        optimalBandEl.hidden = !geometry.optimalVisible;
      }

      // Footer only exists in the DOM when its render path decided to show
      // one (hasRoomsView/hide_footer for "scale", hide_footer only for
      // "rangeScale") — the querySelector guard already handles "no footer
      // in this view", footerText itself is never null when the element
      // exists.
      const footerEl = containerEl.querySelector(".rtc-scale-footer");
      if (footerEl) {
        footerEl.textContent = footerText;
      }

      const optimalLabelEl = containerEl.querySelector(".rtc-scale-label-center");
      if (optimalLabelEl) optimalLabelEl.hidden = !geometry.optimalVisible;

      // .rtc-scale-label-center's own text/position are otherwise owned by
      // _resolveOptimalLabelPosition() below (long-/short-form choice plus
      // collision-aware placement, see there) -- no separate assignment
      // here, so the "how is this label's text built" logic exists in
      // exactly one place.
      const labelMinEl = containerEl.querySelector(".rtc-scale-label-min");
      if (labelMinEl) labelMinEl.textContent = geometry.boundaryLabels.min;

      const labelMaxEl = containerEl.querySelector(".rtc-scale-label-max");
      if (labelMaxEl) labelMaxEl.textContent = geometry.boundaryLabels.max;

      this._resolveOptimalLabelPosition(containerEl, geometry);
    }

    _updateScaleView(root, data) {
      // Fast partial update for the main scale view (comfort/optimal bands,
      // labels, footer, markers); called from VIEW_REGISTRY's "scale"
      // entry. data doubles as its own geometry object (see _renderScaleView()).
      const containerEl = root.querySelector(".rtc-scale-view");
      const footerText = data.hasRoomsView && !this._config.hide_footer && data.viewOptions.scale.footer !== false ? this._scaleFooterText(data) : null;
      this._updateScaleBarCommon(containerEl, data, data, footerText);
      if (!containerEl) return;

      const comfortLabelEl = containerEl.querySelector(".rtc-scale-comfort-label");
      if (comfortLabelEl) {
        comfortLabelEl.style.left = `${data.comfortCenter}%`;
        comfortLabelEl.textContent = this._t("scale.comfortLabel", { range: `${this._fmt(data.comfortMin, 0)}–${this._fmtWithUnit(data.comfortMax, 0, false)}` });
        comfortLabelEl.hidden = !data.comfortVisible;
      }

      // Coldest/warmest markers only exist in room mode; the guards below
      // simply no-op in minimal mode.
      const coldMarker = containerEl.querySelector(".rtc-marker-cold");
      const warmMarker = containerEl.querySelector(".rtc-marker-warm");
      const avgMarker = containerEl.querySelector(".rtc-marker-avg");
      if (coldMarker) {
        coldMarker.setAttribute("style", `left:calc(${data.coolestPos}% + ${data.coolestShift}px);--marker-color:${data.coolestColor};--marker-shadow:${this._rgba(data.coolestColor, 0.28)};`);
        coldMarker.setAttribute("title", `${this._extremeRoomLabel("cold", data.metricType)}: ${data.coolest.name} ${this._fmtWithUnit(data.coolest.value)}`);
      }
      if (warmMarker) {
        warmMarker.setAttribute("style", `left:calc(${data.warmestPos}% + ${data.warmestShift}px);--marker-color:${data.warmestColor};--marker-shadow:${this._rgba(data.warmestColor, 0.28)};`);
        warmMarker.setAttribute("title", `${this._extremeRoomLabel("warm", data.metricType)}: ${data.warmest.name} ${this._fmtWithUnit(data.warmest.value)}`);
      }
      this._updateScaleRoomMarkers(containerEl, data);
      if (avgMarker) {
        avgMarker.setAttribute("style", `left:${data.avgPos}%;--marker-color:${data.avgColor};--marker-shadow:${this._rgba(data.avgColor, 0.28)};`);
        avgMarker.setAttribute("title", this._t("avg.tooltip", { value: this._fmtWithUnit(data.avg), label: data.avgLabel }));
        avgMarker.classList.toggle("rtc-marker-emphasized", data.viewOptions.scale.markers === "all" && data.hasRoomsView);
      }
    }

    _updateScaleRoomMarkers(containerEl, data) {
      // `markers:all` is a keyed, data-driven marker set. Room availability
      // may change while the scale view itself remains mounted, so patch by
      // the original YAML room index instead of assuming the initial count
      // remains stable. These markers are non-interactive; adding/removing
      // them cannot disturb focus.
      const bar = containerEl?.querySelector(".rtc-scale-bar");
      if (!bar) return;
      const desired = data.viewOptions.scale.markers === "all" && data.hasRoomsView
        ? data.scaleRoomMarkers
        : [];
      const existing = new Map(
        [...bar.querySelectorAll(".rtc-marker-room")].map((el) => [Number(el.dataset.roomMarkerIndex), el])
      );
      const avgMarker = bar.querySelector(".rtc-marker-avg");
      for (const marker of desired) {
        let markerEl = existing.get(marker.index);
        if (!markerEl) {
          markerEl = bar.ownerDocument.createElement("div");
          markerEl.className = "rtc-marker rtc-marker-room";
          markerEl.dataset.roomMarkerIndex = String(marker.index);
          bar.insertBefore(markerEl, avgMarker);
        }
        markerEl.setAttribute("style", `left:${marker.position}%;--marker-color:${marker.color};--marker-shadow:${this._rgba(marker.color, 0.22)};`);
        markerEl.setAttribute("title", `${marker.name}: ${this._fmtWithUnit(marker.value)}`);
        existing.delete(marker.index);
      }
      for (const stale of existing.values()) stale.remove();
    }

    _updateRangeScaleView(root, data) {
      // Fast partial update for the rangeScale view; called from
      // VIEW_REGISTRY's "rangeScale" entry. Mirrors _updateScaleView() but
      // for daily min/max markers and the current/min/max top labels — see
      // _renderRangeScaleView().
      const containerEl = root.querySelector(".rtc-range-scale-view");
      if (!containerEl) return;
      const footerMode = data.viewOptions.range_scale.footer;
      const footerText = this._config.hide_footer || footerMode === false ? null : this._rangeScaleFooterText(data, footerMode);
      this._updateScaleBarCommon(containerEl, data, data.rangeScaleGeometry, footerText);

      const currentLabelEl = containerEl.querySelector(".rtc-range-scale-label-current");
      if (currentLabelEl) currentLabelEl.style.left = `${data.rangeCurrentPos}%`;
      const minLabelEl = containerEl.querySelector(".rtc-range-scale-label-min");
      if (minLabelEl) minLabelEl.style.left = `${data.rangeMinPos}%`;
      const maxLabelEl = containerEl.querySelector(".rtc-range-scale-label-max");
      if (maxLabelEl) maxLabelEl.style.left = `${data.rangeMaxPos}%`;

      // Reuses the "cold"/"warm" marker classes for min/max (same visual
      // shape/CSS, just a different meaning here — see _renderRangeScaleView()).
      const minMarker = containerEl.querySelector(".rtc-marker-cold");
      const maxMarker = containerEl.querySelector(".rtc-marker-warm");
      const avgMarker = containerEl.querySelector(".rtc-marker-avg");
      if (minMarker) {
        minMarker.setAttribute("style", `left:${data.rangeMinPos}%;--marker-color:${data.rangeMinColor};--marker-shadow:${this._rgba(data.rangeMinColor, 0.28)};`);
        minMarker.setAttribute("title", `${this._t("card.dailyMinimum")}: ${data.rangeMinTime || "–"} ${this._fmtWithUnit(data.rangeMin)}`);
      }
      if (maxMarker) {
        maxMarker.setAttribute("style", `left:${data.rangeMaxPos}%;--marker-color:${data.rangeMaxColor};--marker-shadow:${this._rgba(data.rangeMaxColor, 0.28)};`);
        maxMarker.setAttribute("title", `${this._t("card.dailyMaximum")}: ${data.rangeMaxTime || "–"} ${this._fmtWithUnit(data.rangeMax)}`);
      }
      if (avgMarker) {
        avgMarker.setAttribute("style", `left:${data.rangeCurrentPos}%;--marker-color:${data.avgColor};--marker-shadow:${this._rgba(data.avgColor, 0.28)};`);
        avgMarker.setAttribute("title", this._t("avg.tooltip", { value: this._fmtWithUnit(data.avg), label: this._t("rangeScale.currentLabel") }));
      }

      this._resolveRangeScaleLabels(containerEl, data);
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
        const transform = window.getComputedStyle(track).transform;
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

    _renderEmpty(data) {
      // HTML for the case where neither the average entity nor any room reports a number.
      const missingHint = this._emptyHint(data);
      const emptyIcon = this._metricMetaFor(data.metricType).emptyIcon;
      return `
        <div class="rtc-empty">
          <div class="rtc-empty-icon"><ha-icon icon="${this._esc(emptyIcon)}"></ha-icon></div>
          <div class="rtc-empty-copy">
            <div class="rtc-empty-title">${this._esc(data.title)}</div>
            <div class="rtc-empty-subtitle">${this._esc(this._t("empty.title"))} ${this._esc(missingHint)}</div>
          </div>
        </div>
      `;
    }

    _renderNoActiveViews(data) {
      // AP-05 (audit sections 13, 14.1, "Null aktive Views"): only called
      // for the "requested but systemically unavailable" half of the
      // null-view policy (see data.viewAreaCollapsed at _computeData()) —
      // the header/average/room chips (rendered unconditionally outside
      // mainPanelRight, unaffected by this branch) stay visible, but the
      // view area itself becomes a plain localized hint instead of
      // guessing which view to fall back to. A deliberately empty/fully-
      // disabled views: config takes the OTHER branch in _renderContent()
      // and collapses to nothing here — this function is never reached for
      // that case. No auto-slide/swipe either way: both already gate on
      // this._views.length >= 2 (see _hasAutoSlide()), automatically
      // satisfied here since this._views is empty.
      return `<div class="rtc-rotator-solo rtc-no-views">${this._esc(this._t("views.none"))}</div>`;
    }

    _renderContent(data) {
      // HTML for the whole card: header, main panel, room chips. data.views
      // has 1-4 entries (see VIEW_REGISTRY); with only one view the rotator/swipe mechanics
      // are omitted entirely (static scale view, no auto-slide) — the
      // wrapper deliberately skips the .rtc-rotator class so vertical
      // scrolling stays untouched by the pointer handlers, which only treat
      // .rtc-rotator elements as swipeable.
      const toneStyle = this._toneStyle(data);
      const viewRenderers = Object.fromEntries(VIEW_REGISTRY.map((v) => [v.key, () => v.render(this, data)]));
      const rotatorHint = this._esc(this._t("rotator.hint"));
      // AP-04 (necessary, minimal consequence of removing "mandatory" from
      // VIEW_REGISTRY): the solo-view path used to hardcode
      // this._renderScaleView(data) — harmless only because "scale" could
      // never be missing or sit anywhere but wherever the carousel path put
      // it. Once views: can genuinely omit "scale" (e.g.
      // views:[{type:extremes,enabled:true}]), that hardcoding would render
      // the wrong view. Reuses the SAME generic viewRenderers lookup the
      // carousel path already uses, keyed by data.views[0] — one view, one
      // renderer call, no special-casing of which view it is. A views:
      // config that resolves to ZERO active views renders one of two
      // null-view states, per data.viewAreaCollapsed (see _computeData()):
      // a deliberately empty/fully-disabled config collapses the view area
      // to nothing at all (empty string — no markup, no .rtc-no-views), so
      // a card intentionally configured with no views doesn't show a
      // "nothing to see" hint that looks like a misconfiguration; a
      // REQUESTED-but-unavailable view (e.g. range_scale with no valid
      // range_entity) instead shows _renderNoActiveViews()'s localized
      // hint, since that case genuinely IS something the user should
      // notice and can fix.
      const mainPanelRight = data.views.length >= 2
        ? `
          <div class="rtc-rotator" aria-live="off" title="${rotatorHint}">
            <div class="rtc-track">
              ${data.views.map((kind) => `<div class="rtc-view">${viewRenderers[kind]()}</div>`).join("")}
            </div>
          </div>
        `
        : data.views.length === 1
          ? `
          <div class="rtc-rotator-solo">${viewRenderers[data.views[0]]()}</div>
        `
          : data.viewAreaCollapsed
            ? ""
            : this._renderNoActiveViews(data);
      const roomGrid = data.showRoomChips
        ? `
          <div class="rtc-room-grid">
            ${this._renderRoomGridRows(data)}
          </div>
        `
        : "";

      // tabindex="-1": out of the normal tab order, but focusable via
      // .focus() -- the last-resort AP-09 focus-fallback target (see
      // _focusFallbackTarget()) when a focused element disappears and no
      // average button exists to fall back to instead.
      return `
        <div class="rtc-root" data-metric="${this._esc(data.metricType)}" style="${toneStyle}" tabindex="-1">
          <div class="rtc-top-line"></div>

          <div class="rtc-header">
            <div class="rtc-icon-badge" aria-hidden="true">
              <ha-icon icon="${this._esc(data.tone.icon)}"></ha-icon>
            </div>

            <div class="rtc-title-block">
              <div class="rtc-title">${this._esc(data.title)}</div>
              <div class="rtc-subtitle">${this._esc(data.subtitle)}</div>
            </div>

            <div class="rtc-status-pill">${this._esc(data.tone.label)}</div>
          </div>

          <div class="rtc-main-panel">
            <div class="rtc-average">${this._renderAverage(data)}</div>

            ${mainPanelRight}
          </div>

          ${roomGrid}
        </div>
      `;
    }

    _renderAverage(data) {
      // Home average, left side of the main panel; stays visible but not
      // clickable when there's no average entity.
      const tooltip = this._averageTooltip(data);
      const ariaLabel = this._averageAriaLabel(data, tooltip);
      const avgLabel = this._esc(data.avgLabel);
      const hasTrend = Boolean(data.trend);
      const trendClass = hasTrend ? " rtc-has-trend" : "";
      const trendDirection = hasTrend ? ` data-trend-direction="${this._esc(data.trend.direction)}"` : "";
      const hidden = hasTrend ? "" : " hidden";
      const content = `
        <span class="rtc-avg-label">${avgLabel}</span>
        <span class="rtc-avg-value">
          <span class="rtc-avg-value-num">${this._fmt(data.avg)}</span><span class="rtc-avg-unit-wrap"><span class="rtc-avg-unit-gap" aria-hidden="true"> </span><span class="rtc-avg-unit-core"><span class="rtc-avg-trend-arrow" aria-hidden="true"${hidden}><svg class="rtc-avg-trend-arrow-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" focusable="false"><path d="M3 13L13 3M8 3H13V8" vector-effect="non-scaling-stroke"></path></svg></span><span class="rtc-avg-value-unit">${this._esc(this._unit())}</span></span></span>
        </span>
      `;

      if (!data.avgEntity) {
        return `
          <div
            class="rtc-avg-button rtc-avg-button-disabled${trendClass}"
            ${trendDirection}
            title="${this._esc(tooltip)}"
            aria-label="${this._esc(ariaLabel)}"
          >
            ${content}
          </div>
        `;
      }

      return `
        <button
          type="button"
          class="rtc-avg-button${trendClass}"
          ${trendDirection}
          data-entity="${this._esc(data.avgEntity)}"
          aria-label="${this._esc(ariaLabel)}"
          title="${this._esc(tooltip)}"
        >
          ${content}
        </button>
      `;
    }

    _scaleFooterText(data) {
      // The signed rate is a third, independently optional segment of the
      // room-bound main Scale footer. RangeScale owns a different footer.
      const segments = [
        this._t("footer.comfort", { count: data.inComfort, total: data.roomCount }),
        this._t("footer.spread", { value: this._fmtWithUnit(data.spread) }),
      ];
      if (data.trend) {
        segments.push(this._t("footer.trend", { value: this._trendDisplayText(data.trend) }));
      }
      return segments.join(" · ");
    }

    _rangeScaleFooterText(data, mode) {
      // AP-06 (audit section 16): RangeScale's own footer — today's span
      // (rangeState, the range_entity's own STATE, never rangeMax -
      // rangeMin) plus the daily min/max and their timestamps. Deliberately
      // NOT tied to hasRoomsView (unlike _scaleFooterText()) — RangeScale
      // must show this footer with zero rooms configured. rangeState/
      // rangeMin/rangeMax are formatted without a null-guard: this is only
      // ever called while the rangeScale view itself is showing, and
      // hasRangeScale already requires rangeScaleAvailable (hasRange &&
      // rangeMin !== null && rangeMax !== null, see _computeData()) — all
      // three are structurally guaranteed non-null here. Only the
      // timestamps are independently nullable (minimum_zeitpunkt/
      // maximum_zeitpunkt can be absent even when the numeric attributes
      // aren't), hence the "–" fallback already established for them in
      // this view's marker tooltips (see _renderRangeScaleView()).
      // AP-C3 (audit 23.2): "compact" reuses rangeScale.footerCompact — the
      // exact same template with the two timestamp parentheticals dropped,
      // already translated for every language (see TRANSLATIONS) — rather
      // than composing a truncated string here, which would need to
      // guess at each language's own punctuation/connector conventions.
      const key = mode === "compact" ? "rangeScale.footerCompact" : "rangeScale.footer";
      return this._t(key, {
        span: this._fmtWithUnit(data.rangeState),
        min: this._fmtWithUnit(data.rangeMin),
        minTime: data.rangeMinTime || "–",
        max: this._fmtWithUnit(data.rangeMax),
        maxTime: data.rangeMaxTime || "–",
      });
    }

    _renderScaleBar(data, geometry, viewClass, topRowHtml, markersHtml, footerText, showComfortBand, showOptimalBand) {
      // Shared markup for any scale-bar-shaped view (comfort/optimal band,
      // scale edge labels, footer) — used by both "scale" (room-based
      // geometry) and "rangeScale" (daily-range-based geometry, see
      // _computeData()'s rangeScaleGeometry). Only the top row (comfort
      // pill vs. avg/min/max labels), the markers, and the footer text
      // differ between views; callers build/compute those and pass them
      // in — AP-06: footer content is each caller's own decision (room
      // comfort vs. RangeScale's daily span), not decided in here.
      //
      // Teil 2 (view-customizer Baukasten): showComfortBand/showOptimalBand
      // are likewise each caller's own resolved data.viewOptions.<key>
      // decision, not read from data here — identical pattern to
      // footerText. Purely a markup omission: when false, the band <div>
      // and its matching descriptive label are not emitted
      // (_updateScaleBarCommon()'s existing querySelector guards already
      // no-op correctly on their absence, no update-path change needed).
      const footer = footerText ? `<div class="rtc-scale-footer">${this._esc(footerText)}</div>` : "";
      const comfortBandHtml = showComfortBand ? `<div class="rtc-comfort-band" style="left:${geometry.comfortLeft}%;width:${geometry.comfortWidth}%;"${geometry.comfortVisible ? "" : " hidden"}></div>` : "";
      const optimalBandHtml = showOptimalBand ? `<div class="rtc-optimal-band" style="left:${geometry.optimalLeft}%;width:${geometry.optimalWidth}%;"${geometry.optimalVisible ? "" : " hidden"}></div>` : "";
      const optimalLabelHtml = showOptimalBand
        ? `<span class="rtc-scale-label-center" style="left:${geometry.optimalCenter}%"${geometry.optimalVisible ? "" : " hidden"}>${this._esc(this._t("scale.optimalLabel", { range: `${this._fmt(geometry.optimalMin, 0)}–${this._fmtWithUnit(geometry.optimalMax, 0, false)}` }))}</span>`
        : "";

      return `
        <div class="${viewClass}">
          ${topRowHtml}

          <div class="rtc-scale-bar">
            ${comfortBandHtml}
            ${optimalBandHtml}
            ${markersHtml}
          </div>

          <div class="rtc-scale-labels">
            <span class="rtc-scale-label-min">${this._esc(geometry.boundaryLabels.min)}</span>
            ${optimalLabelHtml}
            <span class="rtc-scale-label-max rtc-scale-max">${this._esc(geometry.boundaryLabels.max)}</span>
          </div>

          ${footer}
        </div>
      `;
    }

    _renderScaleView(data) {
      // Dynamic scale with comfort band, optimal band, and marker(s); rendered
      // as the "scale" view, or alone (no rotator) in minimal mode. Thin
      // wrapper around the shared _renderScaleBar() — data doubles as its
      // own geometry object here (_computeData() spreads scaleGeometry's
      // fields directly onto data for the main scale).
      const avgMarkerColor = data.avgColor;
      const { show_comfort_band: showComfortBand, show_optimal_band: showOptimalBand, footer: showFooter, markers: markersMode } = data.viewOptions.scale;
      const extremaMarkers = data.hasRoomsView && markersMode === "extremes"
        ? `
            <div class="rtc-marker rtc-marker-cold" style="left:calc(${data.coolestPos}% + ${data.coolestShift}px);--marker-color:${data.coolestColor};--marker-shadow:${this._rgba(data.coolestColor, 0.28)};" title="${this._esc(`${this._extremeRoomLabel("cold", data.metricType)}: ${data.coolest.name} ${this._fmtWithUnit(data.coolest.value)}`)}"></div>
            <div class="rtc-marker rtc-marker-warm" style="left:calc(${data.warmestPos}% + ${data.warmestShift}px);--marker-color:${data.warmestColor};--marker-shadow:${this._rgba(data.warmestColor, 0.28)};" title="${this._esc(`${this._extremeRoomLabel("warm", data.metricType)}: ${data.warmest.name} ${this._fmtWithUnit(data.warmest.value)}`)}"></div>
          `
        : "";
      const roomMarkers = data.hasRoomsView && markersMode === "all"
        ? data.scaleRoomMarkers.map((marker) => `
            <div class="rtc-marker rtc-marker-room" data-room-marker-index="${marker.index}" style="left:${marker.position}%;--marker-color:${marker.color};--marker-shadow:${this._rgba(marker.color, 0.22)};" title="${this._esc(`${marker.name}: ${this._fmtWithUnit(marker.value)}`)}"></div>
          `).join("")
        : "";
      const avgMarkerClass = markersMode === "all" && data.hasRoomsView ? " rtc-marker-emphasized" : "";
      const markersHtml = `
            ${extremaMarkers}
            ${roomMarkers}
            <div class="rtc-marker rtc-marker-avg${avgMarkerClass}" style="left:${data.avgPos}%;--marker-color:${avgMarkerColor};--marker-shadow:${this._rgba(avgMarkerColor, 0.28)};" title="${this._esc(this._t("avg.tooltip", { value: this._fmtWithUnit(data.avg), label: data.avgLabel }))}"></div>
      `;
      const topRowHtml = `
          <div class="rtc-scale-comfort-row">
            ${showComfortBand ? `<span class="rtc-scale-comfort-label" style="left:${data.comfortCenter}%"${data.comfortVisible ? "" : " hidden"}>${this._esc(this._t("scale.comfortLabel", { range: `${this._fmt(data.comfortMin, 0)}–${this._fmtWithUnit(data.comfortMax, 0, false)}` }))}</span>` : ""}
          </div>
      `;
      const footerText = data.hasRoomsView && !this._config.hide_footer && showFooter !== false ? this._scaleFooterText(data) : null;
      return this._renderScaleBar(data, data, "rtc-scale-view", topRowHtml, markersHtml, footerText, showComfortBand, showOptimalBand);
    }

    _renderRangeScaleView(data) {
      // Alternate scale bar (optional, requested via views:
      // [{type:"range_scale"}], see "Oeffentliche
      // Konfiguration"): same comfort/optimal band and scale-edge labels as
      // the main "scale" view (via the shared _renderScaleBar()), but the
      // markers show today's minimum/maximum instead of coldest/warmest
      // room, and the top row shows current/min/max labels above their own
      // markers instead of a single "Komfort" pill — see
      // _resolveRangeScaleLabels() for how those three labels avoid
      // overlapping each other. Reuses the "cold"/"warm" marker classes
      // for min/max (identical shape/CSS, just a different meaning here).
      const geometry = data.rangeScaleGeometry;
      const markersHtml = `
            <div class="rtc-marker rtc-marker-cold" style="left:${data.rangeMinPos}%;--marker-color:${data.rangeMinColor};--marker-shadow:${this._rgba(data.rangeMinColor, 0.28)};" title="${this._esc(`${this._t("card.dailyMinimum")}: ${data.rangeMinTime || "–"} ${this._fmtWithUnit(data.rangeMin)}`)}"></div>
            <div class="rtc-marker rtc-marker-warm" style="left:${data.rangeMaxPos}%;--marker-color:${data.rangeMaxColor};--marker-shadow:${this._rgba(data.rangeMaxColor, 0.28)};" title="${this._esc(`${this._t("card.dailyMaximum")}: ${data.rangeMaxTime || "–"} ${this._fmtWithUnit(data.rangeMax)}`)}"></div>
            <div class="rtc-marker rtc-marker-avg" style="left:${data.rangeCurrentPos}%;--marker-color:${data.avgColor};--marker-shadow:${this._rgba(data.avgColor, 0.28)};" title="${this._esc(this._t("avg.tooltip", { value: this._fmtWithUnit(data.avg), label: this._t("rangeScale.currentLabel") }))}"></div>
      `;
      const topRowHtml = `
          <div class="rtc-range-scale-top-row">
            <span class="rtc-range-scale-label-current" style="left:${data.rangeCurrentPos}%">${this._esc(this._t("rangeScale.currentLabel"))}</span>
            <span class="rtc-range-scale-label-min" style="left:${data.rangeMinPos}%">${this._esc(this._t("rangeScale.minLabel"))}</span>
            <span class="rtc-range-scale-label-max" style="left:${data.rangeMaxPos}%">${this._esc(this._t("rangeScale.maxLabel"))}</span>
          </div>
      `;
      const { show_comfort_band: showComfortBand, show_optimal_band: showOptimalBand, footer: footerMode } = data.viewOptions.range_scale;
      const footerText = this._config.hide_footer || footerMode === false ? null : this._rangeScaleFooterText(data, footerMode);
      return this._renderScaleBar(data, geometry, "rtc-range-scale-view", topRowHtml, markersHtml, footerText, showComfortBand, showOptimalBand);
    }

    _renderExtremesView(data) {
      // Extreme-value view: two large cards for the coldest/warmest room.
      return `
        <div class="rtc-extremes-view">
          ${this._renderExtremeCards(data)}
        </div>
      `;
    }

    _renderExtremeCards(data) {
      // Renders both extreme-value cards together, so updates stay short.
      const showValue = data.viewOptions.extremes.show_value;
      return `
        ${this._renderExtremeCard(data.coolest, "cold", data.metricType, data.displayUnitProfile, showValue)}
        ${this._renderExtremeCard(data.warmest, "warm", data.metricType, data.displayUnitProfile, showValue)}
      `;
    }

    _renderMetricCard({ label, name, value, entity, color, roomIndex, showName = true, showValue = true }) {
      // Shared card markup for the extreme-value view and the daily-range
      // view, so both are laid out identically. roomIndex is only set for
      // real rooms, so _buildActionConfig() correctly falls back to the
      // card's default actions for daily-range cards instead of a
      // nonexistent room index. Missing value/name render as "–" (the card
      // stays clickable) instead of crashing.
      // AP-C3 (audit 23.2): showName/showValue are the two independent
      // per-caller visibility flags -- range.show_time (this slot holds
      // the min/max timestamp for range cards, see _renderRangeCards())
      // drives showName; extremes.show_value drives showValue. Both
      // default true (today's unchanged behavior). A hidden field is
      // omitted from the tooltip/aria-label too, not just the visible
      // text, so it isn't silently exposed on hover.
      const cardColor = color || "var(--rtc-muted)";
      const roomIndexAttr = roomIndex !== undefined && roomIndex !== null ? ` data-room-index="${roomIndex}"` : "";
      const hasValue = typeof value === "number" && Number.isFinite(value);
      const nameText = showName ? name || "–" : "";
      const numText = showValue ? (hasValue ? this._fmt(value) : "–") : "";
      const unitText = showValue && hasValue ? ` ${this._unit()}` : "";
      const titleValueText = showValue ? (hasValue ? this._fmtWithUnit(value) : "–") : "";
      const titleText = [label, [nameText, titleValueText].filter(Boolean).join(" ")].filter(Boolean).join(": ");

      return `
        <button
          type="button"
          class="rtc-extreme-card"
          data-entity="${this._esc(entity)}"${roomIndexAttr}
          style="--extreme-color:${cardColor};--extreme-bg:${this._rgba(cardColor, 0.09)};--extreme-border:${this._rgba(cardColor, 0.36)};--extreme-line-shadow:${this._rgba(cardColor, 0.24)};"
          title="${this._esc(titleText)}"
          aria-label="${this._esc(this._t("card.ariaOpen", { label, name: nameText }))}"
        >
          <span class="rtc-extreme-line"></span>
          <span class="rtc-extreme-label">${this._esc(label)}</span>
          <span class="rtc-extreme-name">${this._esc(nameText)}</span>
          <span class="rtc-extreme-value"><span class="rtc-extreme-value-num">${this._esc(numText)}</span><span class="rtc-extreme-value-unit">${this._esc(unitText)}</span></span>
        </button>
      `;
    }

    // AP-09 (audit 18): patches an existing metric-card node in place --
    // field-for-field mirror of _renderMetricCard() above, shared by both
    // Range and Extrema's update paths. Uses style.setProperty() for the
    // four CSS custom properties (audit 21.3's hardening recommendation for
    // newly-written dynamic-style code) rather than reassembling one
    // `style` string.
    _patchMetricCard(cardEl, { label, name, value, entity, color, roomIndex, showName = true, showValue = true }) {
      const cardColor = color || "var(--rtc-muted)";
      const hasValue = typeof value === "number" && Number.isFinite(value);
      const nameText = showName ? name || "–" : "";
      const numText = showValue ? (hasValue ? this._fmt(value) : "–") : "";
      const unitText = showValue && hasValue ? ` ${this._unit()}` : "";
      const titleValueText = showValue ? (hasValue ? this._fmtWithUnit(value) : "–") : "";
      const titleText = [label, [nameText, titleValueText].filter(Boolean).join(" ")].filter(Boolean).join(": ");

      cardEl.setAttribute("data-entity", entity == null ? "" : String(entity));
      if (roomIndex !== undefined && roomIndex !== null) cardEl.setAttribute("data-room-index", String(roomIndex));
      else cardEl.removeAttribute("data-room-index");
      cardEl.style.setProperty("--extreme-color", cardColor);
      cardEl.style.setProperty("--extreme-bg", this._rgba(cardColor, 0.09));
      cardEl.style.setProperty("--extreme-border", this._rgba(cardColor, 0.36));
      cardEl.style.setProperty("--extreme-line-shadow", this._rgba(cardColor, 0.24));
      cardEl.setAttribute("title", titleText);
      cardEl.setAttribute("aria-label", this._t("card.ariaOpen", { label, name: nameText }));
      cardEl.querySelector(".rtc-extreme-label").textContent = label;
      cardEl.querySelector(".rtc-extreme-name").textContent = nameText;
      cardEl.querySelector(".rtc-extreme-value-num").textContent = numText;
      cardEl.querySelector(".rtc-extreme-value-unit").textContent = unitText;
    }

    _extremeCardModel(room, type, metricType, unitProfile, showValue) {
      // Pure model computation shared by _renderExtremeCard() (initial
      // render) and _updateExtremeCards() (patch path) -- one place that
      // decides label/color/etc. for an extrema card, so the two paths can
      // never quietly drift apart. showValue (AP-C3: extremes.show_value)
      // defaults true so every OTHER existing caller/test keeps working
      // unchanged.
      const color = this._roomTone(room.value, room.entity, metricType, unitProfile);
      return {
        label: this._extremeRoomLabel(type, metricType),
        name: room.name,
        value: room.value,
        entity: room.entity,
        color,
        roomIndex: room.index,
        showValue: showValue !== false,
      };
    }

    _renderExtremeCard(room, type, metricType, unitProfile, showValue) {
      // Single extreme-value card; thin wrapper around _renderMetricCard().
      return this._renderMetricCard(this._extremeCardModel(room, type, metricType, unitProfile, showValue));
    }

    _updateRangeCards(el, data) {
      // AP-09: patches the two fixed range cards (min, max) in place --
      // called from VIEW_REGISTRY's "range" entry. Reads the two existing
      // .rtc-extreme-card nodes by position (render order is structurally
      // fixed by _renderRangeCards() below: minimum first, maximum second).
      // Falls back to a full re-render only as a defensive guard if the DOM
      // doesn't actually hold two cards (shouldn't happen in practice --
      // this view only appears/disappears via _renderAll(), never mid-patch).
      if (!el) return;
      const cards = el.querySelectorAll(".rtc-extreme-card");
      if (cards.length !== 2) {
        el.innerHTML = this._renderRangeCards(data);
        return;
      }
      const showName = data.viewOptions.range.show_time;
      this._patchMetricCard(cards[0], {
        label: this._t("card.dailyMinimum"),
        name: data.rangeMinTime,
        value: data.rangeMin,
        entity: this._config.range_entity,
        color: data.rangeMinColor,
        showName,
      });
      this._patchMetricCard(cards[1], {
        label: this._t("card.dailyMaximum"),
        name: data.rangeMaxTime,
        value: data.rangeMax,
        entity: this._config.range_entity,
        color: data.rangeMaxColor,
        showName,
      });
    }

    _updateExtremeCards(el, data) {
      // AP-09: mirrors _updateRangeCards() for the two fixed extrema cards
      // (coldest, warmest) -- called from VIEW_REGISTRY's "extremes" entry.
      // Deliberately role-keyed, not entity-keyed: when a different room
      // becomes coldest/warmest, the SAME card node is patched with the new
      // room's data rather than being replaced -- the slot is continuously
      // "the coldest room", the same way a value display continuously shows
      // "the current temperature" regardless of which sensor briefly backs
      // it. A focused card therefore never loses focus just because the
      // underlying room changed.
      if (!el) return;
      const cards = el.querySelectorAll(".rtc-extreme-card");
      if (cards.length !== 2) {
        el.innerHTML = this._renderExtremeCards(data);
        return;
      }
      const showValue = data.viewOptions.extremes.show_value;
      this._patchMetricCard(cards[0], this._extremeCardModel(data.coolest, "cold", data.metricType, data.displayUnitProfile, showValue));
      this._patchMetricCard(cards[1], this._extremeCardModel(data.warmest, "warm", data.metricType, data.displayUnitProfile, showValue));
    }

    _renderRangeView(data) {
      // Daily-range view (left of scale, only when hasRange): daily min/max of range_entity.
      return `
        <div class="rtc-range-view">
          ${this._renderRangeCards(data)}
        </div>
      `;
    }

    _renderRangeCards(data) {
      // Both cards share range_entity — minimum/maximum are attributes of that one entity.
      const showName = data.viewOptions.range.show_time;
      return `
        ${this._renderMetricCard({
          label: this._t("card.dailyMinimum"),
          name: data.rangeMinTime,
          value: data.rangeMin,
          entity: this._config.range_entity,
          color: data.rangeMinColor,
          showName,
        })}
        ${this._renderMetricCard({
          label: this._t("card.dailyMaximum"),
          name: data.rangeMaxTime,
          value: data.rangeMax,
          entity: this._config.range_entity,
          color: data.rangeMaxColor,
          showName,
        })}
      `;
    }

    _renderRoomGridRows(data) {
      // Splits data.rooms into data.roomRows-sized rows (see
      // _roomGridRows()); each row is its own CSS grid with its own column
      // count, since a single native CSS grid can't vary column count per
      // row. A single row (the unconfigured, <= 7 rooms default) renders
      // identically to the old flat-grid markup, just wrapped one level
      // deeper. columnCount (not itemCount) drives grid-template-columns,
      // so a short last row under a fixed room_columns keeps the same chip
      // width as the rows above it instead of stretching to fill.
      let cursor = 0;
      return data.roomRows
        .map(({ itemCount, columnCount }) => {
          const roomsInRow = data.rooms.slice(cursor, cursor + itemCount);
          cursor += itemCount;
          return `<div class="rtc-room-row" style="grid-template-columns:repeat(${columnCount}, minmax(0, 1fr));">${roomsInRow.map((room) => this._renderRoomChip(room, data)).join("")}</div>`;
        })
        .join("");
    }

    _renderRoomChip(room, data) {
      // Small room chip at the bottom; rooms outside the comfort range get a bolder color.
      const out = room.value < data.comfortMin || room.value > data.comfortMax;
      const color = this._roomTone(room.value, room.entity, data.metricType, data.displayUnitProfile);
      const mark = room.value > data.comfortMax ? "↑" : room.value < data.comfortMin ? "↓" : "•";
      const style = `--room-color:${color};--room-mark-bg:${this._rgba(color, 0.18)};--room-bg:${out ? this._rgba(color, 0.10) : "var(--rtc-chip-bg)"};--room-border:${out ? this._rgba(color, 0.36) : "var(--rtc-hairline)"};`;
      const shortGuaranteedAttr = room.shortGuaranteed ? ' data-short-guaranteed="true"' : "";

      return `
        <button
          type="button"
          class="rtc-room-chip"
          data-entity="${this._esc(room.entity)}"
          data-room-index="${room.index}"
          style="${style}"
          title="${this._esc(`${room.name}: ${this._fmtWithUnit(room.value)}`)}"
          aria-label="${this._esc(this._t("room.ariaOpen", { name: room.name }))}"
        >
          <span class="rtc-room-top">
            <span class="rtc-room-short"${shortGuaranteedAttr}>${this._esc(room.displayLabel)}</span>
            <span class="rtc-room-mark">${mark}</span>
          </span>
          <span class="rtc-room-value"><span class="rtc-room-value-num">${this._fmt(room.value)}</span><span class="rtc-room-value-unit">${this._esc(this._unit())}</span></span>
        </button>
      `;
    }

    // AP-09 (audit 18): patches an existing room-chip node in place --
    // field-for-field mirror of _renderRoomChip() above. Used for BOTH
    // reused chips (an already-existing entity) and freshly created ones
    // (see _updateRoomGrid()) -- a freshly created chip is first parsed via
    // _htmlToElement(_renderRoomChip(...)) purely for its skeleton shape,
    // then immediately patched here too, so there is exactly one place
    // that knows which fields a room chip has, not two independently
    // maintained descriptions.
    _patchRoomChip(chip, room, data) {
      const out = room.value < data.comfortMin || room.value > data.comfortMax;
      const color = this._roomTone(room.value, room.entity, data.metricType, data.displayUnitProfile);
      const mark = room.value > data.comfortMax ? "↑" : room.value < data.comfortMin ? "↓" : "•";

      chip.setAttribute("data-entity", room.entity);
      chip.setAttribute("data-room-index", String(room.index));
      chip.style.setProperty("--room-color", color);
      chip.style.setProperty("--room-mark-bg", this._rgba(color, 0.18));
      chip.style.setProperty("--room-bg", out ? this._rgba(color, 0.1) : "var(--rtc-chip-bg)");
      chip.style.setProperty("--room-border", out ? this._rgba(color, 0.36) : "var(--rtc-hairline)");
      chip.setAttribute("title", `${room.name}: ${this._fmtWithUnit(room.value)}`);
      chip.setAttribute("aria-label", this._t("room.ariaOpen", { name: room.name }));
      const shortEl = chip.querySelector(".rtc-room-short");
      shortEl.textContent = room.displayLabel;
      // toggleAttribute (not a conditional setAttribute): chip DOM nodes are
      // reused across re-renders (see AP-09 keyed patching above), so a
      // stale "true" from a prior config must be actively removed once the
      // label no longer qualifies, not merely left unset.
      shortEl.toggleAttribute("data-short-guaranteed", room.shortGuaranteed);
      chip.querySelector(".rtc-room-mark").textContent = mark;
      chip.querySelector(".rtc-room-value-num").textContent = this._fmt(room.value);
      chip.querySelector(".rtc-room-value-unit").textContent = this._unit();
    }

    _updateRoomGrid(roomGridEl, data) {
      // AP-09 (audit 18): entity-keyed reconciliation instead of rebuilding
      // the whole grid via innerHTML on every update. Row wrapper <div>s
      // themselves are cheap, unkeyed, non-focusable layout containers --
      // only the room-chip <button>s inside them carry identity/focus and
      // are reused by data-entity, wherever in the new row structure they
      // end up.
      //
      // A real browser (confirmed only there -- jsdom's simplified focus
      // model doesn't reproduce this, see focus-stability.spec.js) blurs a
      // focused node the instant appendChild()/insertBefore() is called on
      // it, EVEN when the node is already exactly where it's being "moved"
      // to (a net no-op position-wise) -- the DOM spec's insert algorithm
      // unconditionally removes-then-reinserts an already-connected node,
      // and the HTML living standard's focus fixup rule fires on that
      // removal step alone, unconditionally. The fix is to never issue the
      // move call at all for a chip that's already correctly positioned --
      // by far the common case (a plain value update touches zero chip
      // positions) -- so the dominant, per-second update path never risks
      // a blur. Row wrapper COUNT is only ever GROWN before repositioning
      // (new wrappers attach to roomGridEl immediately, never sitting
      // detached, which would ALSO blur via the same fixup rule) and
      // trimmed only afterward, once guaranteed empty.
      if (!roomGridEl) return;

      const activeBefore = this.shadowRoot?.activeElement;
      const focusedChip = activeBefore?.classList?.contains("rtc-room-chip") ? activeBefore : null;
      const rooms = data.rooms || [];
      const presentEntities = new Set(rooms.map((room) => room.entity));

      const existingChips = new Map();
      roomGridEl.querySelectorAll(".rtc-room-chip").forEach((chip) => {
        const entity = chip.getAttribute("data-entity");
        if (presentEntities.has(entity)) existingChips.set(entity, chip);
        else chip.remove();
      });

      while (roomGridEl.children.length < data.roomRows.length) roomGridEl.appendChild(this.ownerDocument.createElement("div"));

      let cursor = 0;
      data.roomRows.forEach(({ itemCount, columnCount }, rowIndex) => {
        const rowEl = roomGridEl.children[rowIndex];
        rowEl.className = "rtc-room-row";
        rowEl.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
        const roomsInRow = rooms.slice(cursor, cursor + itemCount);
        cursor += itemCount;
        roomsInRow.forEach((room, indexInRow) => {
          const chip = existingChips.get(room.entity) || this._htmlToElement(this._renderRoomChip(room, data));
          this._patchRoomChip(chip, room, data);
          if (rowEl.children[indexInRow] !== chip) rowEl.insertBefore(chip, rowEl.children[indexInRow] || null);
        });
      });

      while (roomGridEl.children.length > data.roomRows.length) roomGridEl.removeChild(roomGridEl.lastElementChild);

      // Covers both ways a focused chip can lose focus: its room
      // disappeared (removed above) or it genuinely had to move to a new
      // row/position (unavoidably blurred by the browser, see above) --
      // comparing before/after rather than pre-guessing "will be lost"
      // catches both uniformly.
      if (focusedChip && this.shadowRoot?.activeElement !== focusedChip) this._applyFocusFallback();
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
    _styles() {
      // All CSS for the card, scoped to the shadow DOM.
      return `
        ${this._slideKeyframes()}

        :host {
          display: block;
          --rtc-radius: 20px;
          --rtc-muted: var(--secondary-text-color);
          --rtc-faint: color-mix(in srgb, var(--secondary-text-color) 72%, transparent);
          --rtc-hairline: color-mix(in srgb, var(--divider-color, var(--primary-text-color)) 42%, transparent);
          --rtc-panel: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
          --rtc-chip-bg: color-mix(in srgb, var(--primary-text-color) 3%, transparent);
          --rtc-card-border: color-mix(in srgb, var(--divider-color, var(--primary-text-color)) 70%, transparent);
          --rtc-top-overlay: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
          -webkit-tap-highlight-color: transparent;
        }

        .rtc-card {
          container: rtc-card / inline-size;
          border-radius: var(--rtc-radius);
          padding: 0;
          overflow: hidden;
          background: linear-gradient(135deg, var(--rtc-top-overlay), transparent), var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--rtc-card-border);
          box-shadow: var(--ha-card-box-shadow, 0 8px 26px rgba(0,0,0,0.18));
        }

        .rtc-root {
          position: relative;
          padding: 15px 16px 16px;
          display: grid;
          gap: 11px;
        }

        .rtc-top-line {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 3px;
          background: linear-gradient(90deg, var(--tone-color), transparent);
        }

        .rtc-header {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 11px;
          align-items: center;
          min-width: 0;
        }

        .rtc-icon-badge {
          width: 39px;
          height: 39px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-icon-badge ha-icon {
          width: 22px;
          height: 22px;
          color: var(--tone-color);
        }

        .rtc-title-block {
          min-width: 0;
        }

        .rtc-title {
          font-size: 21px;
          font-weight: 920;
          line-height: 1.05;
          color: var(--primary-text-color);
        }

        .rtc-subtitle {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 650;
          line-height: 1.25;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-status-pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          color: var(--tone-color);
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-main-panel {
          display: grid;
          grid-template-columns: minmax(94px, 106px) minmax(0, 1fr);
          gap: 8px;
          align-items: center;
          border-radius: 17px;
          padding: 9px 10px;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

        button {
          appearance: none;
          -webkit-appearance: none;
          font: inherit;
          color: inherit;
          border: 0;
          margin: 0;
          text-align: left;
        }

        .rtc-avg-button {
          position: relative;
          display: block;
          width: 100%;
          min-width: 0;
          border-radius: 13px;
          cursor: pointer;
          background: transparent;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-avg-button-disabled {
          cursor: default;
        }

        .rtc-avg-button:focus-visible,
        .rtc-room-chip:focus-visible,
        .rtc-extreme-card:focus-visible {
          outline: 2px solid var(--tone-color);
          outline-offset: 2px;
        }

        .rtc-avg-label {
          display: block;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: .075em;
          text-transform: uppercase;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-avg-value {
          display: block;
          margin-top: 4px;
          font-size: 33px;
          font-weight: 950;
          line-height: .95;
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .rtc-avg-unit-wrap {
          display: inline-block;
        }

        .rtc-avg-unit-gap {
          font-size: 14px;
        }

        .rtc-avg-unit-core {
          display: inline;
        }

        .rtc-avg-button.rtc-has-trend .rtc-avg-unit-core {
          display: inline-grid;
          grid-template-rows: minmax(0, 1fr) auto;
          justify-items: center;
          align-items: center;
          height: .95em;
          vertical-align: bottom;
        }

        .rtc-avg-value-unit {
          display: inline;
          font-size: 14px;
          font-weight: 750;
          line-height: 1;
          color: var(--rtc-faint);
        }

        .rtc-avg-trend-arrow {
          display: block;
          align-self: end;
          width: 10px;
          height: 10px;
          color: var(--rtc-muted);
          transform: translateY(-1px);
        }

        .rtc-avg-trend-arrow-svg {
          display: block;
          width: 10px;
          height: 10px;
          overflow: visible;
          stroke-width: 1.2;
          stroke-linecap: round;
          stroke-linejoin: round;
          transform: rotate(0deg);
          transform-origin: center;
        }

        .rtc-avg-button[data-trend-direction="stable"] .rtc-avg-trend-arrow-svg {
          transform: rotate(45deg);
        }

        .rtc-avg-button[data-trend-direction="falling"] .rtc-avg-trend-arrow-svg {
          transform: rotate(90deg);
        }

        .rtc-avg-trend-arrow[hidden] {
          display: none;
        }

        .rtc-rotator,
        .rtc-rotator-solo {
          min-width: 0;
          height: 70px;
          /* Keep the carousel clipped horizontally, but extend its paint
             viewport upward for RangeScale's collision-only upper label.
             overflow:hidden and paint containment both clipped at the
             border box, which cut the label under Home Assistant's real
             font metrics. The directional clip changes paint only: layout,
             row heights, and the scale-bar position remain untouched. */
          overflow: visible;
          clip-path: inset(-10px 0 0 0);
          border-radius: 14px;
          contain: layout style;
        }

        .rtc-rotator {
          /* Only the swipeable rotator needs pan-y so vertical scroll still reaches the browser. */
          touch-action: pan-y;
        }

        .rtc-no-views {
          /* _renderNoActiveViews(): a requested-but-unavailable view (e.g.
             range_scale with no valid range_entity) falls back to this
             localized one-line hint instead of the usual view content.
             Previously unstyled — it inherited plain block/left/top text
             instead of matching the rest of the card's centered, muted
             typography. Same box as .rtc-rotator-solo above (this class is
             always combined with it, never alone), so centering here only
             needs flex on that existing 70px-tall box. */
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
          color: var(--secondary-text-color);
        }

        .rtc-track {
          /* Width is views.length*100% so all views sit correctly side by side. */
          display: flex;
          width: ${Math.max(1, (this._views || []).length) * 100}%;
          height: 70px;
          align-items: stretch;
          ${this._trackAnimationCss()}
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          will-change: transform;
        }

        .rtc-track.rtc-manual {
          animation: none !important;
        }

        .rtc-view {
          /* Width is 100/views.length % of the track's own width. */
          flex: 0 0 ${this._viewWidthPct()}%;
          width: ${this._viewWidthPct()}%;
          min-width: 0;
          box-sizing: border-box;
        }

        .rtc-scale-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          align-content: center;
          gap: 4px;
          padding: 0 1px;
        }

        .rtc-scale-comfort-row {
          position: relative;
          height: 12px;
          font-size: 10px;
          font-weight: 800;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-scale-comfort-label {
          position: absolute;
          top: 0;
          transform: translateX(-50%);
        }

        /* "rangeScale" view (optional, requested via views:
           [{type:"range_scale"}]): same overall
           layout as .rtc-scale-view, but its top row holds three labels
           (current/min/max) above their markers instead of one centered
           "Komfort" pill — positions set/corrected in JS, see
           _renderRangeScaleView()/_resolveRangeScaleLabels(). */
        .rtc-range-scale-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          align-content: center;
          gap: 4px;
          padding: 0 1px;
        }

        .rtc-range-scale-top-row {
          position: relative;
          height: 12px;
          font-size: 10px;
          font-weight: 800;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-range-scale-label-current,
        .rtc-range-scale-label-min,
        .rtc-range-scale-label-max {
          position: absolute;
          top: 0;
          /* JS sets style.left to a resolved center px value (see
             _resolveRangeScaleLabels()), which this transform then centers
             on. current is a FIXED pivot — always exactly centered on the
             .rtc-marker-avg current-value marker, never repositioned by
             collision avoidance. Only min/max drift off-center from their
             own marker, and only when they'd otherwise overlap current or
             each other. Ellipsis only actually engages when
             _resolveRangeScaleLabels()/_layoutSideLabelGroup() sets an
             explicit max-width (a side group doesn't fit even at natural
             width, or — rarely — current alone is wider than the whole bar)
             — harmless no-op otherwise. */
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* When one historical label cannot fit between the fixed current
           pivot and its outer edge, only that colliding label moves to the
           upper line. Current and any non-colliding historical label share
           the lower line. The row height itself stays 12px, so the scale
           bar's grid position never changes. */
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-current,
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-min,
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-max {
          top: 4px;
          line-height: 12px;
        }

        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-upper {
          top: -8px;
          line-height: 12px;
          /* The generic label rule clips horizontally for the genuine
             narrow-bar ellipsis fallback. A lifted min/max label instead
             sits partly outside its normal line box; Home Assistant's real
             font rasterization can paint glyph ink beyond that tight box
             (most visibly the i-dot in "min"). Let the short historical
             label paint freely in both axes so neither min nor max can
             self-clip. Position, row height, and therefore the bar stay
             byte-for-byte unchanged. */
          overflow: visible;
          text-overflow: clip;
        }

        .rtc-scale-bar {
          position: relative;
          height: 9px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
          overflow: visible;
          border: 1px solid var(--rtc-hairline);
        }

        .rtc-comfort-band,
        .rtc-optimal-band,
        .rtc-marker {
          position: absolute;
          top: 0;
          bottom: 0;
        }

        .rtc-comfort-band {
          background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
          z-index: 1;
        }

        .rtc-optimal-band {
          background: var(--tone-band);
          z-index: 2;
        }

        .rtc-marker {
          top: 50%;
          transform: translate(-50%, -50%);
          width: 4px;
          height: 17px;
          border-radius: 999px;
          background: var(--marker-color);
          box-shadow: 0 0 0 3px var(--marker-shadow);
        }

        .rtc-marker-cold { z-index: 4; }
        .rtc-marker-warm { z-index: 5; }
        .rtc-marker-room {
          height: 13px;
          z-index: 4;
        }
        .rtc-marker-avg {
          height: 15px;
          z-index: 6;
        }
        .rtc-marker-avg.rtc-marker-emphasized {
          height: 19px;
        }

        .rtc-scale-labels {
          position: relative;
          height: 12px;
          font-size: 10px;
          font-weight: 750;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-scale-labels span {
          position: absolute;
          top: 0;
          /* Ellipsis only actually engages on .rtc-scale-label-center, and
             only when _resolveOptimalLabelPosition() sets an explicit
             max-width (no non-overlapping position fits) — harmless no-op
             on min/max, which never get a max-width. */
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-scale-label-min { left: 0; }
        .rtc-scale-label-center { transform: translateX(-50%); }
        .rtc-scale-label-max { right: 0; }

        .rtc-scale-footer {
          font-size: 10.5px;
          font-weight: 750;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-extremes-view,
        .rtc-range-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          padding: 0 1px;
        }

        .rtc-extreme-card {
          position: relative;
          min-width: 0;
          height: 70px;
          box-sizing: border-box;
          border-radius: 14px;
          padding: 8px 9px 7px;
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto 1fr;
          column-gap: 0;
          row-gap: 1px;
          background: linear-gradient(135deg, var(--extreme-bg), transparent 72%);
          border: 1px solid var(--extreme-border);
          box-shadow: inset 0 1px 0 color-mix(in srgb, var(--extreme-color) 16%, transparent);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-extreme-line {
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, var(--extreme-color), transparent);
          box-shadow: 0 0 10px var(--extreme-line-shadow);
          opacity: .98;
        }

        .rtc-extreme-label {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0;
          color: var(--extreme-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.05;
          opacity: .94;
        }

        .rtc-extreme-name {
          grid-column: 1;
          grid-row: 2;
          align-self: start;
          min-width: 0;
          max-width: 100%;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.05;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-extreme-value {
          grid-column: 1;
          grid-row: 3;
          align-self: end;
          justify-self: end;
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          font-size: 25px;
          font-weight: 950;
          line-height: .88;
          color: var(--extreme-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          letter-spacing: -.02em;
          min-width: 0;
        }

        .rtc-extreme-value-unit {
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
        }

        .rtc-room-grid {
          /* One .rtc-room-row per row (see _roomGridRows()) — a plain flex
             column, since native CSS grid can't vary column count per row
             within a single grid. gap here is the vertical row gap. */
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .rtc-room-row {
          display: grid;
          /* grid-template-columns is set inline (repeat(rowSize, ...)) to match that row's chip count. */
          gap: 6px;
        }

        .rtc-room-chip {
          min-width: 0;
          border-radius: 13px;
          padding: 7px 7px 8px;
          background: var(--room-bg);
          border: 1px solid var(--room-border);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-room-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          min-width: 0;
        }

        .rtc-room-short {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .04em;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* Guarantees full visibility for an exactly-two-uppercase-letter
           label (see TWO_UPPER_LETTER_RE / validRooms.shortGuaranteed) --
           overflow:visible alone would not be enough, since .rtc-room-chip
           itself clips at narrow widths (see the 460px/600px breakpoints
           below) and .rtc-room-short competes for space in .rtc-room-top
           with the fixed 15px .rtc-room-mark and its 4px gap. Presence-only
           attribute selector: _patchRoomChip() sets/clears this via
           toggleAttribute(), which does not guarantee the "true" value. */
        .rtc-room-short[data-short-guaranteed] {
          flex: 0 0 auto;
          min-width: max-content;
          overflow: visible;
          text-overflow: clip;
        }

        .rtc-room-mark {
          flex: 0 0 15px;
          width: 15px;
          height: 15px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 900;
          line-height: 1;
          color: var(--room-color);
          background: var(--room-mark-bg);
        }

        .rtc-room-value {
          display: flex;
          align-items: baseline;
          gap: 1px;
          margin-top: 5px;
          font-size: 17px;
          font-weight: 920;
          line-height: 1;
          color: var(--primary-text-color);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .rtc-room-value-unit {
          flex: 0 0 auto;
          font-size: 10px;
          font-weight: 750;
          color: var(--rtc-faint);
        }

        .rtc-empty {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .rtc-empty-icon {
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

        .rtc-empty-icon ha-icon {
          width: 22px;
          height: 22px;
          color: var(--secondary-text-color);
        }

        .rtc-empty-copy {
          min-width: 0;
        }

        .rtc-empty-title {
          font-size: 21px;
          font-weight: 900;
          color: var(--primary-text-color);
          line-height: 1.05;
        }

        .rtc-empty-subtitle {
          margin-top: 4px;
          font-size: 12px;
          color: var(--secondary-text-color);
          line-height: 1.3;
        }

        @container rtc-card (max-width: 460px) {
          .rtc-root { padding: 14px; }
          .rtc-main-panel { grid-template-columns: minmax(82px, 96px) minmax(0, 1fr); }
          .rtc-avg-value { font-size: 29px; }
          .rtc-room-grid { gap: 5px; }
          .rtc-room-row { gap: 5px; }
          .rtc-room-chip {
            padding-left: 5px;
            padding-right: 5px;
            overflow: hidden;
          }
          .rtc-room-value {
            font-size: 14px;
            gap: 0;
            letter-spacing: 0;
            min-width: 0;
          }
          .rtc-room-value-unit {
            font-size: 7.5px;
            line-height: 1;
            transform: translateY(-1px);
          }
          .rtc-room-short { font-size: 10px; }
          .rtc-extremes-view,
          .rtc-range-view { gap: 6px; }
          .rtc-extreme-card {
            height: 70px;
            padding: 8px 7px 7px;
          }
          .rtc-extreme-label {
            grid-column: 1;
            grid-row: 1;
            font-size: 9.5px;
            white-space: nowrap;
          }
          .rtc-extreme-name {
            font-size: 12.5px;
          }
          .rtc-extreme-value {
            font-size: 22px;
          }
          .rtc-extreme-value-unit { font-size: 9px; }
        }

        @container rtc-card (max-width: 360px) {
          .rtc-main-panel {
            grid-template-columns: minmax(78px, 90px) minmax(0, 1fr);
          }
          .rtc-rotator,
          .rtc-rotator-solo,
          .rtc-track,
          .rtc-scale-view,
          .rtc-range-scale-view,
          .rtc-extremes-view,
          .rtc-range-view {
            height: 74px;
          }
          .rtc-extreme-card {
            height: 74px;
            padding-left: 6px;
            padding-right: 6px;
          }
          .rtc-extreme-label {
            font-size: 9px;
          }
          .rtc-extreme-name {
            font-size: 12px;
          }
          .rtc-extreme-value {
            font-size: 21px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (max-width: 600px) {
            .rtc-root { padding: 14px; }
            .rtc-main-panel { grid-template-columns: minmax(82px, 96px) minmax(0, 1fr); }
            .rtc-avg-value { font-size: 29px; }
            .rtc-room-grid { gap: 5px; }
            .rtc-room-row { gap: 5px; }
            .rtc-room-chip {
              padding-left: 5px;
              padding-right: 5px;
              overflow: hidden;
            }
            .rtc-room-value {
              font-size: 14px;
              gap: 0;
              letter-spacing: 0;
              min-width: 0;
            }
            .rtc-room-value-unit {
              font-size: 7.5px;
              line-height: 1;
              transform: translateY(-1px);
            }
            .rtc-room-short { font-size: 10px; }
            .rtc-extremes-view,
            .rtc-range-view { gap: 6px; }
            .rtc-extreme-card {
              height: 70px;
              padding: 8px 7px 7px;
            }
            .rtc-extreme-label {
              font-size: 9.5px;
              white-space: nowrap;
            }
            .rtc-extreme-name {
              font-size: 12.5px;
            }
            .rtc-extreme-value {
              font-size: 22px;
            }
            .rtc-extreme-value-unit { font-size: 9px; }
          }

          @media (max-width: 380px) {
            .rtc-main-panel {
              grid-template-columns: minmax(78px, 90px) minmax(0, 1fr);
            }
            .rtc-rotator,
            .rtc-rotator-solo,
            .rtc-track,
            .rtc-scale-view,
            .rtc-range-scale-view,
            .rtc-extremes-view,
            .rtc-range-view {
              height: 74px;
            }
            .rtc-extreme-card {
              height: 74px;
              padding-left: 6px;
              padding-right: 6px;
            }
            .rtc-extreme-label {
              font-size: 9px;
            }
            .rtc-extreme-name {
              font-size: 12px;
            }
            .rtc-extreme-value {
              font-size: 21px;
            }
          }
        }

        @media (prefers-reduced-motion: reduce) {
          /* Disables the auto animation; transform isn't !important, so manual swiping still works. */
          .rtc-track {
            animation: none !important;
            transition: none !important;
          }
        }
      `;
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
    documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/",
  };

  if (existingCard) {
    Object.assign(existingCard, cardMetadata);
  } else {
    window.customCards.push(cardMetadata);
  }

  window.roomClimateCardVersion = CARD_VERSION;
})();
