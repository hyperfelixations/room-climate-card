// Custom node:test reporter (Node 24 reporter API — an async generator over the event
// stream). Asymmetric on purpose: a green run prints one summary block; a failing run
// prints everything needed to diagnose without re-running — suite lineage, stack, wrapped
// `cause`, the structured expected/actual, and stderr. It cannot hide a failure — the exit
// code comes from the runner. See "test:node" vs "test:node:verbose" in package.json.

"use strict";

const MAX_STACK_FRAMES = 12;

function indentOf(text, prefix) {
  return String(text)
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

// Drops node:internal frames (noise for a test failure) and caps the rest.
function usefulStack(stack) {
  if (typeof stack !== "string") return "";
  const frames = stack
    .split("\n")
    .filter((line) => /^\s*at /.test(line))
    .filter((line) => !/\bnode:internal\b/.test(line))
    .slice(0, MAX_STACK_FRAMES);
  return frames.join("\n");
}

// assert/strict attaches `expected`, `actual` and `operator`; printed separately so a
// structural mismatch is actionable.
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
  // Everything the run wrote to stderr, collected for the whole run and printed at the end
  // (only on failure). Per-test attachment does not work: node:test forwards a child's
  // stderr asynchronously, so `test:stderr` routinely arrives after that test's `test:fail`.
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

          // A wrapped error keeps the real reason in `cause`.
          if (error.cause) {
            const causeText = error.cause instanceof Error ? error.cause.stack || error.cause.message : String(error.cause);
            yield indentOf(`caused by: ${causeText}`, "  ") + "\n";
          }

          const stack = usefulStack(error.stack);
          if (stack) yield indentOf(stack, "  ") + "\n";
        }
        break;
      }

      // `test:diagnostic` at nesting 0 carries the end-of-run summary lines; passed through
      // verbatim, no manual counting.
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
