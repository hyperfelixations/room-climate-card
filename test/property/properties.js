"use strict";

// THE INVARIANTS. Statements that must hold for every card the generator can describe,
// whatever it describes.
//
// Each one returns a list of violations rather than throwing, so a single failing case
// reports everything wrong with it at once instead of the first thing the runner happened
// to look at. A violation is a string a person can read without opening this file.
//
// WHAT IS DELIBERATELY NOT ASSERTED. Nothing here says a particular configuration must
// produce a particular card. That is what the hand-written tests are for, and they say it
// far more precisely. These are the statements that are true of ALL of them — which is why
// they are worth checking against inputs nobody thought of.

const { VIEWS } = require("../contracts/product-surface.js");

const EPSILON = 1e-9;

// Walks every value in the model, tagging each with the path it was found at. The old
// property test looked only at the model's own top-level keys and searched them for names
// ending in "Pos" — of which there were none, so it checked nothing at all. Positions live
// under average.position, scale.markerPositions, extremes and roomMarkers[].position, and
// only a recursive walk can see them.
function* walk(value, path = "", parentKey = "", depth = 0) {
  if (depth > 24) return; // the model is not deep; this is a guard against a cycle, not a limit
  yield { path, value, parentKey };
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      yield* walk(value[index], `${path}[${index}]`, parentKey, depth + 1);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    yield* walk(value[key], path ? `${path}.${key}` : key, key, depth + 1);
  }
}

function inRange(number, low, high) {
  return number >= low - EPSILON && number <= high + EPSILON;
}

// ------------------------------------------------------------------- the invariants --

// Nothing COMPUTED may be NaN or Infinity. Either one reaches the DOM as the literal text
// "NaN" or "Infinity" in a value, a width, or a transform.
//
// Exactly one non-finite number is legitimate, and it is not a computed one: the last tier
// of a unit profile's dynamic step table carries `maxSpan: Infinity`, meaning "and
// everything above". It is a static definition (see METRIC_DEFINITIONS) that rides along in
// the model because the whole profile does, and it is only ever read as `span <= maxSpan`.
// The allowance is written as one exact path rather than "skip the unit profile", so a
// non-finite number appearing anywhere else in that profile still fails.
const PERMITTED_NON_FINITE = /^metric\.displayUnitProfile\.dynamicDisplaySteps\[\d+\]\.maxSpan$/;

function everyNumberIsFinite(model) {
  const violations = [];
  for (const { path, value } of walk(model)) {
    if (typeof value !== "number" || Number.isFinite(value)) continue;
    if (PERMITTED_NON_FINITE.test(path)) continue;
    violations.push(`${path || "<root>"} is ${String(value)}`);
  }
  return violations;
}

// Anything the card places along the 0–100 % track has to land on the track. A marker at
// −40 % or 260 % is drawn outside the card.
function positionsAreOnTheTrack(model) {
  const violations = [];
  for (const { path, value, parentKey } of walk(model)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const isPosition =
      parentKey === "position" ||
      /Position$/.test(parentKey) ||
      /(^|\.)markerPositions(\.|\[)/.test(path) ||
      /(Left|Width|Center)$/.test(parentKey);
    if (isPosition && !inRange(value, 0, 100)) {
      violations.push(`${path} = ${value} is outside the 0–100 % track`);
    }
  }
  return violations;
}

// A band starts on the track and ends on it.
function bandsStayInsideTheTrack(model) {
  const violations = [];
  for (const { path, value } of walk(model)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [leftKey, widthKey] of [
      ["comfortLeft", "comfortWidth"],
      ["optimalLeft", "optimalWidth"],
    ]) {
      if (typeof value[leftKey] !== "number" || typeof value[widthKey] !== "number") continue;
      const end = value[leftKey] + value[widthKey];
      if (!inRange(end, 0, 100)) {
        violations.push(`${path}: ${leftKey}+${widthKey} = ${end} runs off the track`);
      }
    }
  }
  return violations;
}

// A scale that does not increase cannot be drawn on.
function scalesIncrease(model) {
  const violations = [];
  for (const { path, value } of walk(model)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (typeof value.scaleMin !== "number" || typeof value.scaleMax !== "number") continue;
    if (!(value.scaleMax > value.scaleMin)) {
      violations.push(`${path}: scaleMax ${value.scaleMax} is not above scaleMin ${value.scaleMin}`);
    }
  }
  return violations;
}

// The view list is the card's own answer to "what is on screen". It must name only views
// that exist, name each at most once, and agree with its own entries.
//
// It must NOT be forced to contain `scale`: an authoritative `views:` configuration is
// entitled to leave it out, and the previous property test asserted the opposite.
function activeViewsAreCoherent(model) {
  const violations = [];
  const views = model.views;
  if (!views || typeof views !== "object") return violations;

  const keys = Array.isArray(views.keys) ? views.keys : [];
  for (const key of keys) {
    if (!VIEWS.includes(key)) violations.push(`views.keys contains "${key}", which is not a view`);
  }
  if (new Set(keys).size !== keys.length) {
    violations.push(`views.keys repeats a view: ${keys.join(", ")}`);
  }

  const entries = Array.isArray(views.entries) ? views.entries : [];
  const activeFromEntries = entries.filter((entry) => entry.active).map((entry) => entry.type);
  if (activeFromEntries.join("|") !== keys.join("|")) {
    violations.push(`views.keys [${keys.join(", ")}] disagrees with its entries [${activeFromEntries.join(", ")}]`);
  }
  for (const entry of entries) {
    if (entry.active && !entry.available) violations.push(`view "${entry.type}" is active but not available`);
    if (entry.active && !entry.requested) violations.push(`view "${entry.type}" is active but was not requested`);
  }
  return violations;
}

// An average the card says it calculated from rooms cannot lie outside them, and the
// coldest room cannot be warmer than the warmest.
function aggregatesStayWithinTheirInputs(model) {
  const violations = [];
  if (model.empty) return violations;

  const markerValues = Array.isArray(model.roomMarkers)
    ? model.roomMarkers.map((marker) => marker.value).filter((value) => typeof value === "number")
    : [];

  if (model.average && model.average.source === "calculated" && markerValues.length) {
    const low = Math.min(...markerValues);
    const high = Math.max(...markerValues);
    if (typeof model.average.value === "number" && !inRange(model.average.value, low, high)) {
      violations.push(`average ${model.average.value} lies outside its rooms [${low}, ${high}]`);
    }
  }

  const coolest = model.extremes && model.extremes.coolest;
  const warmest = model.extremes && model.extremes.warmest;
  if (coolest && warmest && typeof coolest.value === "number" && typeof warmest.value === "number") {
    if (coolest.value > warmest.value + EPSILON) {
      violations.push(`coolest ${coolest.value} is above warmest ${warmest.value}`);
    }
  }
  return violations;
}

// Every room the card counts as comfortable is a room it has.
function comfortCountsAddUp(model) {
  const violations = [];
  const comfort = model.comfort;
  if (!comfort || model.empty) return violations;
  const parts = ["inComfort", "tooCool", "tooWarm"].map((key) => comfort[key]).filter((n) => typeof n === "number");
  if (parts.length !== 3) return violations;
  const total = parts.reduce((sum, n) => sum + n, 0);
  const roomCount = Array.isArray(model.roomMarkers) ? model.roomMarkers.length : 0;
  if (total > roomCount) {
    violations.push(`comfort counts total ${total} but there are only ${roomCount} rooms with values`);
  }
  for (const [key, count] of Object.entries(comfort)) {
    if (typeof count === "number" && key !== "min" && key !== "max" && count < 0) {
      violations.push(`comfort.${key} is negative (${count})`);
    }
  }
  return violations;
}

// -------------------------------------------------------------------- rendered markup --

// Two things must never reach the DOM: an arithmetic accident spelled out as text, and
// anything executable that came from a configuration value.
//
// THE SAFETY HALF IS ASKED OF THE PARSED DOM, NOT OF THE MARKUP TEXT, and that distinction
// is the whole point. A room named `"><img src=x onerror=alert(1)>` is rendered by the card
// as `&quot;&gt;&lt;img src=x onerror=alert(1)&gt;` — correctly escaped, no element created,
// nothing executable. A regular expression over innerHTML sees the characters `onerror=`
// and calls it an injection; a browser sees text. The first version of this invariant did
// exactly that and reported twenty-seven false alarms, every one of them a case where the
// card had behaved perfectly.
//
// So the question is asked the way a browser answers it: are there dangerous NODES?
const DANGEROUS_ELEMENTS = "script, iframe, object, embed, form, base, link, meta";
const URL_ATTRIBUTES = ["href", "src", "xlink:href", "action", "formaction"];

function domIsSafe(root) {
  const violations = [];
  if (!root || typeof root.querySelectorAll !== "function") return violations;

  for (const element of root.querySelectorAll(DANGEROUS_ELEMENTS)) {
    violations.push(`the rendered card contains a <${element.tagName.toLowerCase()}> element`);
  }
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes || [])) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        violations.push(`<${element.tagName.toLowerCase()}> carries the event handler attribute ${name}`);
      }
      if (URL_ATTRIBUTES.includes(name) && /^\s*(javascript|vbscript|data):/i.test(attribute.value)) {
        violations.push(`<${element.tagName.toLowerCase()}> ${name} is an executable URL: ${attribute.value.slice(0, 60)}`);
      }
    }
  }
  return violations;
}

// The numeric half stays textual, and can: the card never echoes a raw entity state — a
// sensor reporting the literal string "NaN" renders as no data, not as the word — so those
// characters anywhere in the markup, in text or in a width or in a transform, always came
// from arithmetic rather than from something a user typed.
function markupIsNumeric(html) {
  const violations = [];
  if (/\bNaN\b/.test(html)) violations.push("rendered markup contains the text NaN");
  if (/\bInfinity\b/.test(html)) violations.push("rendered markup contains the text Infinity");
  return violations;
}

const MODEL_INVARIANTS = {
  everyNumberIsFinite,
  positionsAreOnTheTrack,
  bandsStayInsideTheTrack,
  scalesIncrease,
  activeViewsAreCoherent,
  aggregatesStayWithinTheirInputs,
  comfortCountsAddUp,
};

// Runs every model invariant and returns a flat list of "name: violation" strings.
function checkModel(model) {
  const violations = [];
  for (const [name, invariant] of Object.entries(MODEL_INVARIANTS)) {
    for (const violation of invariant(model)) violations.push(`${name}: ${violation}`);
  }
  return violations;
}

// The rendered card: its DOM for safety, its markup for arithmetic accidents.
function checkRendered(root, html) {
  return [
    ...domIsSafe(root).map((violation) => `domIsSafe: ${violation}`),
    ...markupIsNumeric(html).map((violation) => `markupIsNumeric: ${violation}`),
  ];
}

module.exports = { checkModel, checkRendered, MODEL_INVARIANTS, domIsSafe, markupIsNumeric, walk };
