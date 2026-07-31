"use strict";

// The compositions the custom element used to expose only for these tests.
//
// Each one below combines a pure module function with something only a live card has:
// the hass states map, the classification policy derived from the configuration, or the
// text/formatting bundle. Production never called any of them — it composes the same
// functions inside presentation/view-model — so they were pure test surface sitting on
// the element, where they were indistinguishable from real behaviour and kept the
// element from being reducible to its actual job.
//
// They live here instead. The card is the first argument rather than `this`, which
// makes the dependency on card state explicit at every call site, and each helper names
// the real module it is exercising.
//
// This is deliberately NOT a general-purpose façade: nothing here exists that no test
// needs, and anything a test can reach through a controller (el._carousel, el._interaction,
// el._renderController) is not duplicated here.

const SPECS = {
  classification: "../../src/application/model/classification.js",
  entityModel: "../../src/application/model/entity-model.js",
  entityAttributes: "../../src/domain/classification/entity-attributes.js",
  metricDefinitions: "../../src/domain/metrics/definitions.js",
  dynamicScale: "../../src/domain/scale/dynamic-scale.js",
  scaleConfig: "../../src/domain/scale/scale-config.js",
  tone: "../../src/presentation/view-model/tone.js",
  scaleViewModel: "../../src/presentation/view-model/scale-view-model.js",
  cardViewModel: "../../src/presentation/view-model/card-view-model.js",
  metricCard: "../../src/render/primitives/metric-card.js",
  metricMeta: "../../src/presentation/view-model/metric-meta.js",
  icons: "../../src/domain/classification/icons.js",
  registry: "../../src/views/registry.js",
};

let cached = null;

async function loadCardInternals() {
  if (cached) return cached;

  const entries = await Promise.all(
    Object.entries(SPECS).map(async ([name, spec]) => [name, await import(spec)])
  );
  const m = Object.fromEntries(entries);

  // The two compositions everything else here is built from. The card derives its
  // classification policy from the configuration and its display profile from that
  // policy; both used to be element methods, and neither has a production caller left
  // now that the view model composes them itself.
  const policyOf = (el) => m.classification.classificationPolicyOf(el._config);
  const displayProfileOf = (el, metricType, unitProfile) =>
    m.classification.resolveDisplayProfile(policyOf(el), metricType, unitProfile);

  cached = {
    classificationPolicy: policyOf,
    displayProfile: displayProfileOf,

    // ---- readings that need the hass states map -----------------------------
    numericState: (el, entityId) => m.entityModel.readNumericState(el._hass?.states, entityId),

    numericAttribute: (el, entityId, attribute) =>
      m.entityModel.readNumericAttribute(el._hass?.states, entityId, attribute),

    auxiliaryUnitProfile: (el, entityId, metricKind, options = {}) =>
      m.entityModel.resolveAuxiliaryUnitProfileKey(el._hass?.states, entityId, metricKind, options),

    // Attribute-declared classification, validated. Resolving the attributes needs
    // hass; the validation itself is pure.
    entityClassification: (el, entityId, { allowPartial = false } = {}) => {
      if (!entityId || !el._hass?.states?.[entityId]) return null;
      return m.entityAttributes.readEntityClassification(el._hass.states[entityId].attributes, { allowPartial });
    },

    // ---- rules that need the configured classification policy ---------------
    isPhysicallyValid: (el, value, metricType, unitProfile = null, { lenient = false } = {}) =>
      m.classification.isValuePhysicallyValid(policyOf(el), metricType, unitProfile, value, { lenient }),

    canonicalProfile: (el, metricType, { lenient = false } = {}) =>
      m.classification.resolveCanonicalProfile(policyOf(el), metricType, { lenient }),

    // ---- classification and tone --------------------------------------------
    // The three compositions the view model performs internally, spelled out here so a
    // test can address one classification decision at a time.
    classifyNumeric: (el, value, metricType, unitProfile) =>
      m.tone.numericTone(
        m.classification.classifyNumericTier(policyOf(el), metricType, unitProfile, value),
        el._texts()
      ),

    classifyValue: (el, value, entityId, metricType, unitProfile) =>
      m.classification.classifyValue(
        policyOf(el),
        metricType,
        unitProfile,
        value,
        entityId ? el._hass?.states?.[entityId]?.attributes ?? null : null
      ),

    // A metric kind without icon tiers keeps its stable presentation icon, so adding
    // another kind never forces a semantically dubious icon family.
    profileIcon: (el, value, metricType, unitProfile) =>
      m.classification.resolveProfileIcon(policyOf(el), metricType, unitProfile, value) ||
      m.metricMeta.metricMetaFor(metricType).icon,

    temperatureIcon: (el, temperature, unitProfile) =>
      m.icons.temperatureIconForProfile(temperature, displayProfileOf(el, "temperature", unitProfile)),

    // The tone a value carries when nothing entity-specific overrides it: the numeric
    // tier, labelled by its own level.
    fallbackTone(el, value, metricType, unitProfile) {
      const classification = this.classifyNumeric(el, value, metricType, unitProfile);
      return { ...classification, label: classification.level };
    },

    // The average's tone, including the configured icon override.
    averageTone(el, value, entityId, metricType, unitProfile) {
      return m.tone.buildTone({
        classification: this.classifyValue(el, value, entityId, metricType, unitProfile),
        icon: el._config.icon || this.profileIcon(el, value, metricType, unitProfile),
        texts: el._texts(),
      });
    },

    roomTone(el, value, entityId, metricType, unitProfile) {
      return this.classifyValue(el, value, entityId, metricType, unitProfile).color;
    },

    // The scale bounds and steps the configured classification profile implies.
    scaleConfigFor(el, metricType, unitProfile) {
      return m.scaleConfig.scaleConfigFor(displayProfileOf(el, metricType, unitProfile));
    },

    // The entity model as the card builds it: the states map and the configuration are
    // both needed, and only a live card has them.
    entityModel: (el, entityId, sourceRole) =>
      m.entityModel.buildEntityModel(el._hass?.states, el._config, entityId, sourceRole),

    // The data-following scale. Passing the dynamic steps only for a REGISTERED metric
    // kind is what keeps the registry guard in the loop.
    dynamicScale(el, coolestValue, warmestValue, metricType, unitProfile) {
      return m.dynamicScale.dynamicScale(
        coolestValue,
        warmestValue,
        this.scaleConfigFor(el, metricType, unitProfile),
        m.metricDefinitions.METRIC_DEFINITIONS[metricType] ? unitProfile?.dynamicDisplaySteps : undefined
      );
    },

    // ---- view-model and markup readbacks ------------------------------------
    scaleModel(el, { metricType, unitProfile, comfortMin, comfortMax, optimalMin, optimalMax, low, high, markers }) {
      return m.scaleViewModel.buildScaleAxis({
        scaleConfig: this.scaleConfigFor(el, metricType, unitProfile),
        displayUnitProfile: m.metricDefinitions.METRIC_DEFINITIONS[metricType] ? unitProfile : undefined,
        comfort: { min: comfortMin, max: comfortMax },
        optimal: { min: optimalMin, max: optimalMax },
        low,
        high,
        markers,
        formatBoundary: (value) => el._fmtWithUnit(value, 0, false),
      });
    },

    trendText: (el, trend) => m.cardViewModel.buildTrendText(trend, el._texts()),

    footerText: (el, viewKey) => el._computeViewModel().views.byKey[viewKey].footerText,

    metricCardsMarkup: (el, viewKey) =>
      m.metricCard.renderMetricCards(el._computeViewModel().views.byKey[viewKey].cards),

    // One view's markup, rendered on its own. Throws for a view the current
    // configuration does not activate, which is what the card would do too.
    viewMarkup: (el, key) => {
      const viewModel = el._computeViewModel();
      if (!viewModel.views.byKey[key]) throw new Error(`view "${key}" is not active for this configuration`);
      return m.registry.VIEW_RENDERERS.find((view) => view.key === key).render(el._renderContext(), viewModel);
    },
  };
  return cached;
}

module.exports = { loadCardInternals };
