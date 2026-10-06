// Daily-range min/max cards; template-literal indentation is shipped markup and baseline-pinned.

import { patchMetricCardPair, renderMetricCards } from "../render/primitives/metric-card.js";

const CONTAINER_SELECTOR = ".rtc-range-view";

export const rangeView = {
  key: "range",

  render(context, content) {
    return `
        <div class="rtc-range-view">
          ${renderMetricCards(content.cards)}
        </div>
      `;
  },

  patch(context, viewEl, content) {
    patchMetricCardPair(viewEl.querySelector(CONTAINER_SELECTOR), content.cards, () => renderMetricCards(content.cards));
  },
};
