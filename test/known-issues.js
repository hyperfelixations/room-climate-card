"use strict";

// Known defects in the card, each held open by a reproduction that must keep failing.
//
// A defect that is understood, reproduced and deliberately not fixed yet gets an entry in
// KNOWN_ISSUES and a reproduction wrapped in expectedFailure(), which requires the
// reproduction to fail; if it ever passes, the run fails and the entry must be retired and
// the reproduction promoted to an ordinary test. Each id matches a BUG-xx section in the
// internal RCC backlog, which carries the full reproduction and assessment. Mechanism:
// see internal dev doc §4 "Bekannte Fehler: das Register".

const test = require("node:test");
const assert = require("node:assert/strict");

// Each entry carries an id (the backlog link), a one-line actionable summary, the product
// area, and the date found.
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
    // Assigns a property-run violation to this bug instead of reporting it as new. Two
    // symptoms, one cause: the spread itself goes infinite, or every derived position goes
    // NaN with nothing else wrong. The second is an `every`, not a `some` — a NaN position
    // alongside any other violation is a different finding and stays new.
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

// Registers a reproduction that must fail with the identifying assertion for this defect.
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
