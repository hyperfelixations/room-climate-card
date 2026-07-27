// Custom node:test reporter (Node 24 reporter API — an async generator over
// the test event stream). Default goal: keep the token cost of a green run
// tiny (one summary block instead of one line per test, which the built-in
// "spec"/"tap" reporters always print) while staying exactly as strict on
// failure (full name/location/message for every failing test, nothing
// swallowed). See "test:unit" vs "test:unit:verbose" in package.json.
//
// `test:diagnostic` events at nesting 0 are the same summary lines
// (`tests N`, `pass N`, `fail N`, `duration_ms N`, ...) the default reporter
// already prints at the end of a run — passed through verbatim, no manual
// counting needed.
module.exports = async function* compactReporter(source) {
  for await (const event of source) {
    if (event.type === "test:fail") {
      const { name, file, line, column, details } = event.data;
      const loc = file ? ` (${file}:${line}:${column})` : "";
      yield `FAIL ${name}${loc}\n`;
      const err = details && details.error;
      if (err) {
        yield `  ${String(err.message || err).split("\n").join("\n  ")}\n`;
      }
    } else if (event.type === "test:diagnostic" && !event.data.nesting) {
      yield `${event.data.message}\n`;
    }
  }
};
