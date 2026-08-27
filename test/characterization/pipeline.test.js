"use strict";

// Proves the extracted pipeline independently of the custom element.
//
// The element-level characterization test builds a real card in jsdom — a shadow root,
// a config setter, a hass setter — and compares the result against the committed
// baselines. That is a valid integration test, but it cannot tell you whether the LOGIC
// moved correctly or whether the element is quietly compensating for a difference. This
// file bypasses the element entirely — it composes
//
//   resolveMeasurementContext -> buildCardDomainModel -> buildCardViewModel
//                             -> toLegacyData
//
// by hand, runs the full characterization scenario catalog through it, and compares
// the result against the SAME committed model baselines the element-level test
// compares against.
//
// If both pass, the pipeline is provably equivalent AND provably reachable without
// a browser. If only the element-level one passes, something in the element is
// papering over a difference.
//
// TZ is pinned before any Intl formatter exists: the range timestamps are rendered
// in local time.
process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { SCENARIOS, buildHass } = require("../helpers/characterization-scenarios.js");

let resolveMeasurementContext;
let buildCardDomainModel;
let buildCardViewModel;
let toLegacyData;
let normalizeConfig;
let optionSchemaForView;
let isSupportedLanguage;
let translate;
let resolveLanguage;
let formatNumber;
let formatTimeOfDay;
let metricMetaFor;
let CLASSIFICATION_ZONES;
let METRIC_TYPE_BY_UNIT;
let METRIC_DEFINITIONS;
let resolveUnitProfileKey;
let normalizeUnitToken;
let palettes;

// WHAT THE CARD IS STANDING ON, because the pipeline's answer depends on it and the element's
// answer does too. Home Assistant's own default light background is what the element resolves
// to when nothing readable has been painted — which is exactly the situation the DTO baselines
// were captured in. Leaving it out would not make this test purer; it would make it a
// characterization of a card that is nowhere, and the same baselines are produced through the
// element in model.test.js.
let PAINTED_ON;

test.before(async () => {
  ({ resolveMeasurementContext } = await import("../../src/application/model/measurement-context.js"));
  ({ buildCardDomainModel } = await import("../../src/application/model/card-domain-model.js"));
  ({ buildCardViewModel } = await import("../../src/presentation/view-model/card-view-model.js"));
  // The frozen oracle, not a production module: the flat shape no longer exists in
  // src/, and the 32 committed baselines are what it still serves.
  ({ toLegacyData } = require("../helpers/legacy-dto.js"));
  ({ normalizeConfig } = await import("../../src/config/normalize-config.js"));
  ({ optionSchemaForView } = await import("../../src/presentation/view-model/view-state.js"));
  ({ isSupportedLanguage, resolveLanguage, translate } = await import("../../src/i18n/translate.js"));
  ({ formatNumber, formatTimeOfDay } = await import("../../src/i18n/formatters.js"));
  ({ metricMetaFor } = await import("../../src/presentation/view-model/metric-meta.js"));
  ({ CLASSIFICATION_ZONES } = await import("../../src/domain/classification/zones.js"));
  ({ METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } = await import("../../src/domain/metrics/resolution.js"));
  ({ METRIC_DEFINITIONS } = await import("../../src/domain/metrics/definitions.js"));
  ({ normalizeUnitToken } = await import("../../src/domain/units/unit-token.js"));
  palettes = await import("../../src/domain/classification/palettes/registry.js");
  const { SURFACE_BACKGROUNDS } = await import("../../src/domain/classification/surface.js");
  const { surfaceOf } = await import("../../src/domain/classification/paint-roles.js");
  PAINTED_ON = surfaceOf([SURFACE_BACKGROUNDS.light]);
});

// The same collaborators the composition root injects, assembled here by hand so
// the wiring itself is exercised rather than assumed.
function configCollaborators() {
  return {
    classificationZones: CLASSIFICATION_ZONES,
    isSupportedLanguage,
    optionSchemaForView,
    metricKindForUnit: (unit) => METRIC_TYPE_BY_UNIT[normalizeUnitToken(unit)],
    unitProfileForUnit: (metricKind, unit) => {
      const profileKey = resolveUnitProfileKey(metricKind, unit);
      return profileKey ? METRIC_DEFINITIONS[metricKind].unitProfiles[profileKey] : null;
    },
    // The full palette collaborator set, exactly as element/room-climate-card.js wires it.
    // A partial stub would still pass every baseline here — they all use a palette name —
    // while hiding the day one of them stops resolving and takes the colour road instead.
    paletteForName: (name) => (name === null ? palettes.DEFAULT_PALETTE : palettes.paletteForName(name)),
    paletteForColor: palettes.paletteForColor,
    paletteKeys: palettes.paletteKeys,
    assertPalette: palettes.assertPalette,
    completePalette: palettes.completePalette,
  };
}

// The presentation collaborator, mirroring what the element builds. The digit
// resolution (explicit argument, then the config override, then the metric's own
// default) is part of the contract and is reproduced here rather than simplified.
function buildTexts(config, hass, unit, metricKind) {
  const language = resolveLanguage(config.language, hass);
  const digitsFor = (digits) => digits ?? config.decimals ?? metricMetaFor(metricKind).decimals;
  const fmt = (value, digits) => formatNumber(language, value, digitsFor(digits));
  return {
    language,
    t: (key, vars) => translate(language, key, vars),
    fmt,
    fmtWithUnit: (value, digits, withSpace = true) => `${fmt(value, digits)}${withSpace ? " " : ""}${unit}`,
    formatTime: (isoString) => formatTimeOfDay(language, isoString),
  };
}

// The whole pipeline, with no element anywhere in sight.
function runPipeline(scenario) {
  const hass = buildHass(scenario);
  const config = normalizeConfig(scenario.config, configCollaborators());
  const context = resolveMeasurementContext(hass.states, config);
  const language = resolveLanguage(config.language, hass);
  const domainModel = buildCardDomainModel({ states: hass.states, config, context, language, surface: PAINTED_ON });
  const texts = buildTexts(config, hass, context.unit, domainModel.metric.kind);
  const viewModel = buildCardViewModel({ domainModel, config, texts });
  return { context, domainModel, viewModel, data: toLegacyData(viewModel) };
}

for (const scenario of SCENARIOS) {
  test(`pure pipeline reproduces the DTO baseline: ${scenario.name}`, () => {
    const { data } = runPipeline(scenario);
    expectBaseline(`model/${scenario.name}.json`, stableStringify(data));
  });
}

test("the pipeline never mutates the config or the hass states it is given", () => {
  for (const scenario of SCENARIOS) {
    const hass = buildHass(scenario);
    const config = normalizeConfig(scenario.config, configCollaborators());
    const configBefore = stableStringify(config);
    const statesBefore = stableStringify(hass.states);

    const context = resolveMeasurementContext(hass.states, config);
    const language = resolveLanguage(config.language, hass);
    const domainModel = buildCardDomainModel({ states: hass.states, config, context, language, surface: PAINTED_ON });
    toLegacyData(buildCardViewModel({ domainModel, config, texts: buildTexts(config, hass, context.unit, domainModel.metric.kind) }));

    assert.equal(stableStringify(config), configBefore, `${scenario.name}: config must not be mutated`);
    assert.equal(stableStringify(hass.states), statesBefore, `${scenario.name}: hass.states must not be mutated`);
  }
});

test("the pipeline is deterministic: two runs of one scenario agree exactly", () => {
  for (const scenario of SCENARIOS) {
    assert.equal(
      stableStringify(runPipeline(scenario).data),
      stableStringify(runPipeline(scenario).data),
      scenario.name
    );
  }
});

test("the domain model carries no translated text, formatted number or CSS colour", () => {
  // The boundary that makes the model language-independent. A German run and an
  // English run of the same scenario must produce the same domain model.
  const german = SCENARIOS.find((s) => s.name === "i18n-german-full");
  const englishVariant = { ...german, language: "en" };

  const build = (scenario) => {
    const hass = buildHass(scenario);
    const config = normalizeConfig(scenario.config, configCollaborators());
    const context = resolveMeasurementContext(hass.states, config);
    return buildCardDomainModel({
      states: hass.states,
      config,
      context,
      language: resolveLanguage(config.language, hass),
    });
  };

  const germanModel = build(german);
  const englishModel = build(englishVariant);
  assert.equal(stableStringify(germanModel), stableStringify(englishModel), "the domain model must not depend on the UI language");

  // And the subtitle is a semantic descriptor, not a sentence.
  assert.equal(typeof germanModel.subtitle.kind, "string");
  assert.doesNotMatch(stableStringify(germanModel.subtitle), /Wohnung|Raum|Komfort/, "no German UI text in the model");
});

test("the view model translates the same domain model into different languages", () => {
  const german = SCENARIOS.find((s) => s.name === "i18n-german-full");
  const hass = buildHass(german);
  const config = normalizeConfig(german.config, configCollaborators());
  const context = resolveMeasurementContext(hass.states, config);
  const domainModel = buildCardDomainModel({ states: hass.states, config, context, language: "de" });

  const asGerman = buildCardViewModel({ domainModel, config, texts: buildTexts({ ...config, language: "de" }, hass, context.unit, domainModel.metric.kind) });
  const asEnglish = buildCardViewModel({ domainModel, config, texts: buildTexts({ ...config, language: "en" }, hass, context.unit, domainModel.metric.kind) });

  assert.equal(asGerman.title, "Temperatur");
  assert.equal(asEnglish.title, "Temperature");
  assert.notEqual(asGerman.subtitle, asEnglish.subtitle);
  // Numbers stay identical; only their formatting differs.
  assert.equal(asGerman.average.value, asEnglish.average.value);
});

test("the legacy DTO adds no fields beyond the documented contract", () => {
  // Guards against a diagnostic or debug field slipping into the shape every
  // renderer reads.
  const nonEmpty = SCENARIOS.find((s) => s.name === "case-d-with-range-scale");
  const keys = Object.keys(runPipeline(nonEmpty).data).sort();
  assert.deepEqual(keys, [
    "avg", "avgColor", "avgEntity", "avgLabel", "avgPos", "avgSource",
    "boundaryLabels", "comfortCenter", "comfortLeft", "comfortMax", "comfortMin",
    "comfortVisible", "comfortWidth", "coolest", "coolestColor", "coolestPos",
    "coolestShift", "displayStep", "displayUnitProfile", "empty", "hasRange",
    "hasRangeScale", "hasRoomsView", "inComfort", "markerPositions", "metricType",
    "optimalCenter", "optimalLeft", "optimalMax", "optimalMin", "optimalVisible",
    "optimalWidth", "rangeCurrentPos", "rangeMax", "rangeMaxColor", "rangeMaxPos",
    "rangeMaxTime", "rangeMin", "rangeMinColor", "rangeMinPos", "rangeMinTime",
    "rangeScaleGeometry", "rangeState", "roomCount", "roomRows", "rooms",
    "scaleMax", "scaleMin", "scaleRoomMarkers", "showRoomChips", "spread",
    "subtitle", "title", "tone", "trend", "trendUnit", "trendValue",
    "viewAreaCollapsed", "viewOptions", "views", "warmest", "warmestColor",
    "warmestPos", "warmestShift",
  ]);
});

test("the empty DTO keeps its minimal five-field shape", () => {
  const empty = SCENARIOS.find((s) => s.name === "state-mixed-metric-kinds");
  const data = runPipeline(empty).data;
  assert.deepEqual(Object.keys(data).sort(), ["configurationState", "empty", "metricType", "missingRooms", "title"]);
  assert.equal(data.empty, true);
  assert.equal(data.configurationState, "mixed_metric_kinds");
});

test("resolving the measurement context never logs", () => {
  // The mixed-kind warning is stateful and deduplicated, so it belongs to the
  // caller. The pure resolution must stay silent even for the scenario that
  // triggers it.
  const mixed = SCENARIOS.find((s) => s.name === "state-mixed-metric-kinds");
  const original = { warn: console.warn, error: console.error, log: console.log };
  const captured = [];
  console.warn = (...a) => captured.push(a);
  console.error = (...a) => captured.push(a);
  console.log = (...a) => captured.push(a);
  try {
    const hass = buildHass(mixed);
    const config = normalizeConfig(mixed.config, configCollaborators());
    const context = resolveMeasurementContext(hass.states, config);
    assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
    buildCardDomainModel({ states: hass.states, config, context, language: "en" });
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(captured, []);
});
