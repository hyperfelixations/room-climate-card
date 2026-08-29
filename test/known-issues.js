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
