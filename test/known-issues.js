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
// dependent. This register is for defects in the CARD, each one with an entry in the
// internal RCC backlog under the same id.

const test = require("node:test");
const assert = require("node:assert/strict");

// Every entry must carry an id, a one-line summary a person can act on, the area of the
// product it lives in, and the date it was found. The id is the link to the internal
// backlog; nothing here is a substitute for that entry.
const KNOWN_ISSUES = [
  {
    id: "RCC-BUG-01",
    area: "domain/scale",
    discovered: "2026-08-24",
    summary:
      "A room span wider than Number.MAX_VALUE overflows: spread becomes Infinity and every " +
      "derived position becomes NaN, which the card writes into the DOM as calc(NaN% + 0px). " +
      "An unusable computed span should reach the no-data state the way an unusable reading does.",
    foundBy: "test/property/model.property.test.js",
    // How the property run recognises THIS defect among the violations it collects, so a
    // case that reproduces a registered bug is counted as one rather than reported as a
    // new failure. Deliberately narrow: it keys on the overflowing span and on the CSS the
    // overflow produces, not on "a NaN somewhere" — a different NaN must still fail.
    fingerprint: (violations) =>
      violations.some((violation) => /spread is Infinity|calc\(NaN%|"\)" is expected/.test(violation)),
  },
  {
    id: "RCC-BUG-02",
    area: "domain/metrics conversion",
    discovered: "2026-08-24",
    summary:
      "Converting an extreme Fahrenheit reading overflows: the ×5/9 step turns -1e308 °F into " +
      "-Infinity, and the card renders the infinity sign as a value and classifies it as very " +
      "cold. Celsius and Kelvin at the same magnitude are unaffected — only the scaling path " +
      "overflows. A non-finite conversion result should reach the no-data state.",
    foundBy: "test/property/model.property.test.js",
    // Distinct from RCC-BUG-01: no span is involved, a single room is enough, and what goes
    // non-finite is the VALUE rather than a position derived from a spread.
    fingerprint: (violations) => violations.some((violation) => /\.value is -?Infinity/.test(violation)),
  },
  {
    id: "RCC-BUG-03",
    area: "domain/classification profiles",
    discovered: "2026-08-24",
    summary:
      "The temperature profile declares no invalidWhen rule, so a reading below absolute zero " +
      "is accepted and rendered as data. Every other metric rejects its impossible readings — " +
      "co2 at <= 0, humidity outside 0-100, pm25 below 0 — and the machinery to do the same " +
      "for temperature already exists and is simply not used.",
    foundBy: "manual investigation while characterising RCC-BUG-02",
    // Not reachable through the property invariants: nothing there knows what is physically
    // possible, and teaching it would mean writing the missing rule in the test instead of
    // the product. The reproduction below is deterministic and direct.
  },
];

// Which registered defect a set of property violations reproduces, if any.
function knownIssueFor(violations) {
  return KNOWN_ISSUES.find((issue) => typeof issue.fingerprint === "function" && issue.fingerprint(violations)) || null;
}

const BY_ID = new Map(KNOWN_ISSUES.map((issue) => [issue.id, issue]));

// Registers a reproduction that MUST fail. Same signature as test(), except that the body
// failing is the pass condition.
function expectedFailure(id, body) {
  const issue = BY_ID.get(id);
  if (!issue) {
    throw new Error(`known-issues: "${id}" has no entry in KNOWN_ISSUES — add one before registering a reproduction`);
  }
  const headline = issue.summary.length > 70 ? `${issue.summary.slice(0, 67).trimEnd()}…` : issue.summary;
  test(`${id} (known defect, expected to fail): ${headline}`, async () => {
    let passed = false;
    try {
      await body();
      passed = true;
    } catch {
      // Failing is the expected outcome. Nothing to report: the summary above already says
      // what is wrong, and the backlog entry says the rest.
    }
    assert.equal(
      passed,
      false,
      `${id} no longer reproduces — the defect appears to be FIXED.\n` +
        `Remove its entry from test/known-issues.js, turn this reproduction into an ordinary ` +
        `test, and close ${id} in the internal RCC backlog.`
    );
  });
}

module.exports = { KNOWN_ISSUES, expectedFailure, knownIssueFor };
