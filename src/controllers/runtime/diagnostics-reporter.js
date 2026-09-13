// Writes the warnings the card shows to the browser console as well, once per change of the
// set: the card renders on every state update, and an unchanged set must not repeat. The
// sentences come from `describe`, so the console never says more than the card. See internal
// dev doc §4 "Diagnosevertrag".

import { CARD_NAME } from "../../core/card-metadata.js";

export function createDiagnosticsReporter({ platform, describe }) {
  let lastWarningsKey = null;
  return {
    // The key is kept for an empty set too, so invalid -> valid -> the same invalid
    // configuration warns again on the third step.
    reportWarnings(messages) {
      const lines = messages.map(describe);
      const key = JSON.stringify(lines);
      if (key === lastWarningsKey) return;
      lastWarningsKey = key;
      for (const line of lines) platform.log("warn", `${CARD_NAME}: ${line}`);
    },
  };
}
