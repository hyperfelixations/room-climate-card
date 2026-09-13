// Writes what the card shows as a warning, and a render that failed, to the browser console:
// each once per change, because the card renders on every state update and an unchanged
// report must not repeat. Warning sentences come from `describe`, so the console never says
// more than the card. See internal dev doc §4 "Diagnosevertrag".

import { CARD_NAME } from "../../core/card-metadata.js";

export function createDiagnosticsReporter({ platform, describe }) {
  let lastWarningsKey = null;
  let lastFailureKey = null;
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

    // Keyed on the error itself, not its stack: one cause reached from several entry points
    // is still one report. A successful render re-arms it.
    reportRenderFailure(error) {
      const key = `${error?.name}: ${error?.message ?? error}`;
      if (key === lastFailureKey) return;
      lastFailureKey = key;
      platform.log("error", `${CARD_NAME}: render failed`, error);
    },

    reportRenderSuccess() {
      lastFailureKey = null;
    },
  };
}
