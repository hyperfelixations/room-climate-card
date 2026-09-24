"use strict";

// The shipped artifact as the artifact tests must judge it. `npm run coverage` builds dist/ with
// one inline source map appended as its last line (rollup.config.mjs, ROOM_CLIMATE_CARD_COVERAGE)
// and runs the Node layers with ROOM_CLIMATE_CARD_COVERAGE_ARTIFACT=1; only then is exactly that
// line removed, and anything else about it is an error. See internal dev doc §4 "Coverage in vier Schichten".

const COVERAGE_MAP_TRAILER = "//# sourceMappingURL=data:application/json;charset=utf-8;base64,";

function shippedSource(source, coverageBuild) {
  if (!coverageBuild) return source;
  const occurrences = source.split(COVERAGE_MAP_TRAILER).length - 1;
  if (occurrences === 0) throw new Error("coverage build: the artifact carries no inline source map");
  if (occurrences > 1) throw new Error("coverage build: the artifact carries more than one inline source map");
  const start = source.indexOf(COVERAGE_MAP_TRAILER);
  if (source.slice(start).replace(/\n$/, "").includes("\n")) {
    throw new Error("coverage build: the inline source map is not the last line of the artifact");
  }
  return source.slice(0, start);
}

module.exports = { shippedSource, COVERAGE_MAP_TRAILER };
