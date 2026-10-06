// Role-keyed coldest/warmest slots preserve focused nodes as room identities change.
// Template-literal indentation is shipped markup and baseline-pinned.

import { patchMetricCardPair, renderMetricCards } from "../render/primitives/metric-card.js";

const CONTAINER_SELECTOR = ".rtc-extremes-view";

export const extremesView = {
  key: "extremes",

  render(context, content) {
    return `
        <div class="rtc-extremes-view">
          ${renderMetricCards(content.cards)}
        </div>
      `;
  },

  patch(context, viewEl, content) {
    patchMetricCardPair(viewEl.querySelector(CONTAINER_SELECTOR), content.cards, () => renderMetricCards(content.cards));
  },
};
