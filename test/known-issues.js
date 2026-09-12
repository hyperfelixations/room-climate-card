"use strict";

// Known defects in the card, each held open by a reproduction that must keep failing.
//
// A defect that is understood, reproduced and deliberately not fixed yet gets an entry in
// KNOWN_ISSUES and a reproduction wrapped in expectedFailure(), which requires the
// reproduction to fail; if it ever passes, the run fails and the entry must be retired and
// the reproduction promoted to an ordinary test. Each id matches a BUG-xx section in the
// internal RCC backlog, which carries the full reproduction and assessment. Mechanism:
// see internal dev doc §4 "Register bekannter Fehler".

const test = require("node:test");
const assert = require("node:assert/strict");

// Each entry carries an id (the backlog link), a one-line actionable summary, the product
// area, and the date found.
const KNOWN_ISSUES = [];

// Partition violations one by one. A known symptom can never make an unrelated violation
// disappear merely because both occurred in the same generated case. `issues` defaults to
// the register; the mechanism tests pass a synthetic one.
function classifyViolations(violations, issues = KNOWN_ISSUES) {
  const known = [];
  const unknown = [];
  for (const violation of violations) {
    const issue = issues.find(
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
