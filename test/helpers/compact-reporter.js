// Custom node:test reporter (Node 24 reporter API — an async generator over the test event
// stream).
//
// THE GOAL IS ASYMMETRIC, and deliberately so. A green run should cost almost nothing to
// read: one summary block instead of one line per test, which the built-in "spec" and "tap"
// reporters always print. A FAILING run should cost nothing to diagnose: everything a person
// needs to find the problem, in the output, without re-running anything.
//
// The earlier version got the first half right and the second half only partly. It printed
// the test name, its location and the error message — but not which suite the test was in,
// not the stack, not the cause of a wrapped error, not the structured expected/actual that
// node:assert already computes, and it discarded anything the test wrote to stderr. All of
// that had to be recovered by re-running with `npm run test:unit:verbose`, which is exactly
// the round trip a reporter exists to avoid.
//
// Nothing here can hide a failure: the process exit code comes from the runner, not from
// this file. What it can do is make the failure legible, and that is the whole job.
//
// See "test:unit" vs "test:unit:verbose" in package.json.

"use strict";

const MAX_STACK_FRAMES = 12;

// node:test hands the suite path down as `nesting` plus the parent's name in the event
// stream. Tracking the enclosing names lets a failure say "carousel › resume timer › …"
// rather than leaving a bare test name to be searched for.
function indentOf(text, prefix) {
  return String(text)
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

// A stack is useful and also the longest thing in the output. Node's own frames are noise
// for a test failure — what matters is where in the SUITE it happened — so they are dropped
// and the rest is capped.
function usefulStack(stack) {
  if (typeof stack !== "string") return "";
  const frames = stack
    .split("\n")
    .filter((line) => /^\s*at /.test(line))
    .filter((line) => !/\bnode:internal\b/.test(line))
    .slice(0, MAX_STACK_FRAMES);
  return frames.join("\n");
}

// assert/strict attaches `expected`, `actual` and `operator`. Printing them separately is
// what turns "Values have same structure but are not reference-equal" into something a
// person can act on.
function comparison(error) {
  if (
    !error ||
    !Object.prototype.hasOwnProperty.call(error, "expected") ||
    !Object.prototype.hasOwnProperty.call(error, "actual")
  ) return "";
  const show = (value) => {
    try {
      return typeof value === "string" ? JSON.stringify(value) : require("node:util").inspect(value, { depth: 4 });
    } catch {
      return String(value);
    }
  };
  return `expected: ${show(error.expected)}\nactual:   ${show(error.actual)}` +
    (error.operator ? `\noperator: ${error.operator}` : "");
}

module.exports = async function* compactReporter(source) {
  // Anything the run wrote to stderr. The card warns about bad configuration through
  // console.warn, so a failing configuration test has usually printed the reason — and the
  // previous reporter dropped all of it.
  //
  // COLLECTED FOR THE WHOLE RUN AND PRINTED AT THE END, rather than attached to the test that
  // produced it. That is not a simplification: node:test forwards a child process's stderr
  // asynchronously, so `test:stderr` routinely arrives AFTER the `test:fail` of the test that
  // wrote it. Attaching it per test looked tidier and silently printed nothing.
  //
  // Only shown when something failed. On a green run it is noise, and keeping the green path
  // cheap to read is half the point of this reporter.
  const stderrLines = [];
  const tests = new Map();
  let failures = 0;

  const keyOf = (file, testId) => `${file || "<unknown>"}\0${testId}`;
  const fullName = (data) => {
    if (data.testId === undefined) return data.name;
    const names = [];
    let current = tests.get(keyOf(data.file, data.testId));
    const seen = new Set();
    while (current && !seen.has(current.testId)) {
      seen.add(current.testId);
      names.unshift(current.name);
      if (current.parentId === undefined) break;
      current = tests.get(keyOf(current.file || data.file, current.parentId));
    }
    if (!names.length || names[names.length - 1] !== data.name) names.push(data.name);
    return names.join(" › ");
  };

  for await (const event of source) {
    switch (event.type) {
      case "test:start":
        if (event.data.testId !== undefined) {
          tests.set(keyOf(event.data.file, event.data.testId), {
            name: event.data.name,
            file: event.data.file,
            testId: event.data.testId,
            parentId: event.data.parentId,
          });
        }
        break;

      case "test:stderr":
        stderrLines.push(String(event.data.message).trimEnd());
        break;

      case "test:fail": {
        failures += 1;
        const { name, file, line, column, details } = event.data;
        const where = file ? ` (${file}:${line}:${column})` : "";
        yield `FAIL ${fullName(event.data)}${where}\n`;

        const error = details && details.error;
        if (error) {
          yield indentOf(error.message || String(error), "  ") + "\n";

          const diff = comparison(error);
          if (diff) yield indentOf(diff, "  ") + "\n";

          // A wrapped error keeps the real reason in `cause`, and losing it turns a precise
          // failure into a vague one.
          if (error.cause) {
            const causeText = error.cause instanceof Error ? error.cause.stack || error.cause.message : String(error.cause);
            yield indentOf(`caused by: ${causeText}`, "  ") + "\n";
          }

          const stack = usefulStack(error.stack);
          if (stack) yield indentOf(stack, "  ") + "\n";
        }
        break;
      }

      // `test:diagnostic` events at nesting 0 are the same summary lines (`tests N`,
      // `pass N`, `fail N`, `duration_ms N`, …) the default reporter already prints at the
      // end of a run — passed through verbatim, no manual counting needed.
      case "test:diagnostic":
        if (!event.data.nesting) yield `${event.data.message}\n`;
        break;

      default:
        break;
    }
  }

  if (failures > 0 && stderrLines.length) {
    yield `\nstderr from the run (${stderrLines.length} line(s)) — shown because something failed:\n`;
    yield indentOf(stderrLines.join("\n"), "  ") + "\n";
  }
};

module.exports.comparison = comparison;
module.exports.usefulStack = usefulStack;
