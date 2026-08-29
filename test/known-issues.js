"use strict";

// KNOWN DEFECTS, HELD OPEN BY A TEST THAT MUST KEEP FAILING.
//
// The suite is green at every commit. That rule is not negotiable: the moment a red run
// becomes normal, nobody can tell a new regression from an old one that everybody agreed
// to live with, and the suite stops being a gate.
//
// But a test that finds a real bug must not be deleted either, and softening it until it
// passes is worse than deleting it — it leaves behind an assertion that looks like a
// contract and is not one.
//
// So a defect that is understood, reproduced and deliberately NOT fixed yet gets an entry
// here and a reproduction wrapped in expectedFailure(). The wrapper runs the reproduction
// and requires it to FAIL. The run stays green, the bug stays documented in executable
// form, and — the part that makes this honest rather than a way of hiding things —
//
//   IF THE REPRODUCTION EVER PASSES, THE RUN FAILS.
//
// It cannot rot. The day someone fixes the underlying defect, this suite tells them to
// come here, delete the entry, and promote the reproduction to an ordinary test. That is
// the same discipline pytest calls a strict xfail and Playwright calls test.fail().
//
// WHAT DOES NOT BELONG HERE: a test that is merely awkward, slow, or environment-
// dependent. This register is for defects in the CARD.
//
// THE ID IS THE INTERNAL BACKLOG'S ID. Every entry below has a matching `BUG-xx` section in
// the project's internal backlog carrying the reproduction, the affected module, an
// assessment of the impact and whatever decision is still open. This file is the executable
// half of that pair, not a substitute for it: a bug that lives only in a test file is a bug
// nobody plans.

const test = require("node:test");
const assert = require("node:assert/strict");

function isFahrenheitConversionOverflowViolation(violation) {
  return /^everyNumberIsFinite: (?:average\.value|rooms\.visible\[\d+\]\.value|rooms\.chips\[\d+\]\.room\.value|rooms\.chipRows\[\d+\]\.chips\[\d+\]\.room\.value|extremes\.(?:coolest|warmest)\.value|roomMarkers\[\d+\]\.value|spread) is -?Infinity .*finite Fahrenheit entity state .*overflowed during conversion/.test(
    violation
  );
}

// Every entry must carry an id, a one-line summary a person can act on, the area of the
// product it lives in, and the date it was found. The id is the link to the internal
// backlog; nothing here is a substitute for that entry.
const KNOWN_ISSUES = [
  {
    id: "BUG-06",
    area: "domain/scale",
    discovered: "2026-08-24",
    summary:
      "An axis wider than Number.MAX_VALUE overflows: the span becomes Infinity, every " +
      "position derived from it becomes NaN, and the card writes that into the DOM as " +
      "calc(NaN% + 0px). An unusable computed span should reach the no-data state the way an " +
      "unusable reading does. Reachable through a custom profile whose declared scale spans " +
      "both extremes; two ENTITY readings can no longer do it, because every metric now has a " +
      "floor and none of them can be far enough apart.",
    foundBy: "test/property/model.property.test.js",
    // How the property run recognises THIS defect among the violations it collects, so a
    // case that reproduces a registered bug is counted as one rather than reported as a new
    // failure.
    //
    // Two symptoms, one cause. The overflow shows either as the spread itself going
    // infinite, or — when the scale range is what overflows — as every derived POSITION
    // going NaN with nothing else wrong. The second clause is an `every` rather than a
    // `some` on purpose: a NaN position accompanied by any other kind of violation is a
    // different finding and must still be reported as new.
    matchesViolation: (violation) =>
      /everyNumberIsFinite: spread is Infinity$|calc\(NaN%|"\)" is expected|everyNumberIsFinite: \S*[Pp]osition\S* is NaN/.test(violation),
  },
  {
    id: "BUG-07",
    area: "domain/metrics conversion",
    discovered: "2026-08-24",
    summary:
      "Converting an extreme Fahrenheit reading overflows: the ×5/9 step turns 1e308 °F into " +
      "Infinity, and the card renders the infinity sign as a value. Celsius and Kelvin at the " +
      "same magnitude are unaffected — only the scaling path overflows. A non-finite conversion " +
      "result should reach the no-data state. The negative direction no longer shows: an " +
      "overflow to -Infinity lands below absolute zero and is refused as an impossible reading, " +
      "which is the right answer for the wrong reason and leaves the cause untouched.",
    foundBy: "test/property/model.property.test.js",
    // Distinct from BUG-06: no span is involved, a single room is enough, and what goes
    // non-finite is the VALUE rather than a position derived from a spread.
    matchesViolation: isFahrenheitConversionOverflowViolation,
  },
  {
    id: "BUG-11",
    area: "application/model measurement-context",
    discovered: "2026-08-27",
    summary:
      "A room-consensus average can overflow even though every room value is finite: two " +
      "readings of 1e308 are added before division, so the calculated headline becomes " +
      "Infinity. The card should reject an unusable aggregate or compute the mean without " +
      "overflowing its intermediate sum.",
    foundBy: "test/property/model.property.test.js, seed 0x3382a0c6",
    matchesViolation: (violation) =>
      /everyNumberIsFinite: average\.value is -?Infinity \(source calculated; finite room inputs\)|aggregatesStayWithinTheirInputs: average -?Infinity lies outside its rooms/.test(
        violation
      ),
  },
  {
    id: "BUG-09",
    area: "config/normalize-config",
    discovered: "2026-08-25",
    summary:
      "A misspelled TOP-LEVEL configuration key is accepted in silence. `pallete: vivid` or " +
      "`subtitel: Ground floor` produce no error, no warning and no diagnostic — the option " +
      "simply does nothing. The same mistake one level down is refused by name, because every " +
      "nested object goes through assertAllowedKeys(), so the card is inconsistent with its " +
      "own convention exactly where a user is most likely to make the mistake.",
    foundBy: "manual investigation while extending the property generator",
    // Deliberately no fingerprint: the property invariants cannot see this. Nothing about
    // the rendered card is wrong — that IS the problem, and only a direct test can say so.
  },
  {
    id: "BUG-10",
    area: "application/model measurement-context",
    discovered: "2026-08-25",
    summary:
      "When the rooms report more than one metric kind AND the primary entity's state is unusable, " +
      "the card discards EVERYTHING: no average, no room markers, no views, the no-data state. The " +
      "primary entity still DECLARES what it measures — device_class is a statement about a sensor, " +
      "not a reading — and measurement-context.js already computes that declaration for another " +
      "purpose a few lines later. It simply is not used to settle the disagreement, so a single " +
      "humidity sensor among four thermometers blanks the card the moment the thermometer feeding " +
      "the average goes offline.",
    foundBy: "test/property/metamorphic.property.test.js",
    // TWO RELATIONS FIND IT, and both phrasings are listed because each says something the
    // other cannot: one shows data being lost when a room the card was ALREADY ignoring is
    // added, the other shows it being lost when only the primary goes offline.
    //
    // Specific enough to attribute. Both phrases are produced only after their relation has
    // established that the card had something to show and that the change made to it cannot
    // account for the loss — see the preconditions in test/property/metamorphic.js. A future
    // violation of either is BUG-10 or a new defect of the same class, and either way it
    // belongs here rather than in a run that has gone red for an unrelated reason.
    matchesViolation: (violation) =>
      /^emptied by an unusable room:|^rooms dropped when an unusable one was added:|^metric kind changed from .+ to .+|^rooms lost when only the primary went unavailable:|^the whole card emptied when only the primary went unavailable,/.test(
        violation
      ),
  },
  {
    id: "BUG-12",
    area: "application/model source-topology",
    discovered: "2026-08-28",
    summary:
      "The card's IDENTITY is decided by which room entities exist, not by which ones it can use. " +
      "A card whose only usable source is a room that is also its primary is a single-room card: the " +
      "headline carries that room's name and its tap action. Adding a room that reports a different " +
      "metric — data the card excludes and never shows — makes it a whole-home card instead, so the " +
      "headline's caption changes from the room's name to \"Home average\" and its tap target changes " +
      "with it, while the number itself does not move at all. A room that is MISSING does not do this; " +
      "only one that exists and is unusable does, which is the inconsistency.",
    foundBy: "test/property/metamorphic.property.test.js",
    // NARROW ON PURPOSE. `average moved` is also how a real value change would be reported,
    // and that would be a different defect entirely — so the matcher parses both sides and
    // accepts only the case where every NUMBER is identical and just the attribution moved
    // from the room to the primary. Anything else stays unknown and turns the run red.
    matchesViolation: (violation) => {
      const parts = /^average moved from (\{.*\}) to (\{.*\})$/.exec(violation);
      if (!parts) return false;
      let before;
      let after;
      try {
        before = JSON.parse(parts[1]);
        after = JSON.parse(parts[2]);
      } catch {
        return false;
      }
      return (
        before.source === "room" &&
        after.source === "sensor" &&
        before.value === after.value &&
        before.position === after.position
      );
    },
  },
];

// Partition violations one by one. A known symptom can never make an unrelated violation
// disappear merely because both occurred in the same generated case.
function classifyViolations(violations) {
  const known = [];
  const unknown = [];
  for (const violation of violations) {
    const issue = KNOWN_ISSUES.find(
      (candidate) => typeof candidate.matchesViolation === "function" && candidate.matchesViolation(violation)
    );
    if (issue) known.push({ issue, violation });
    else unknown.push(violation);
  }
  return { known, unknown };
}

const BY_ID = new Map(KNOWN_ISSUES.map((issue) => [issue.id, issue]));

function isExpectedReproductionFailure(error, matcher) {
  if (typeof matcher === "function") return matcher(error) === true;
  return Boolean(
    error &&
      error.code === "ERR_ASSERTION" &&
      matcher instanceof RegExp &&
      matcher.test(String(error.message || ""))
  );
}

// Registers a reproduction that MUST fail with the identifying assertion for this defect.
// Setup, harness and unrelated assertion failures are deliberately rethrown.
function expectedFailure(id, matcher, body) {
  const issue = BY_ID.get(id);
  if (!issue) {
    throw new Error(`known-issues: "${id}" has no entry in KNOWN_ISSUES — add one before registering a reproduction`);
  }
  const headline = issue.summary.length > 70 ? `${issue.summary.slice(0, 67).trimEnd()}…` : issue.summary;
  test(`${id} (known defect, expected to fail): ${headline}`, async () => {
    try {
      await body();
    } catch (error) {
      if (isExpectedReproductionFailure(error, matcher)) return;
      throw error;
    }
    assert.fail(
      `${id} no longer reproduces — the defect appears to be FIXED.\n` +
        `Remove its entry from test/known-issues.js, turn this reproduction into an ordinary ` +
        `test, and close ${id} in the internal RCC backlog.`
    );
  });
}

module.exports = { KNOWN_ISSUES, classifyViolations, expectedFailure, isExpectedReproductionFailure };
