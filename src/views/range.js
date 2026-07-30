// The daily-range view: two metric cards for today's minimum and maximum.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literal is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { patchMetricCardPair, renderMetricCards } from "../render/primitives/metric-card.js";

const CONTAINER_SELECTOR = ".rtc-range-view";

export const rangeView = {
  key: "range",

  render(context, viewModel) {
    return `
        <div class="rtc-range-view">
          ${renderMetricCards(viewModel.views.byKey.range.cards)}
        </div>
      `;
  },

  patch(context, root, viewModel) {
    const content = viewModel.views.byKey.range;
    if (!content) return;
    patchMetricCardPair(root.querySelector(CONTAINER_SELECTOR), content.cards, () => renderMetricCards(content.cards));
  },
};
