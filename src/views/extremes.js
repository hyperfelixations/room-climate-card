// Role-keyed coldest/warmest slots preserve focused nodes as room identities change.
// Template-literal indentation is shipped markup and baseline-pinned.

import { patchMetricCardPair, renderMetricCards } from "../render/primitives/metric-card.js";

const CONTAINER_SELECTOR = ".rtc-extremes-view";

export const extremesView = {
  key: "extremes",

  render(context, viewModel) {
    return `
        <div class="rtc-extremes-view">
          ${renderMetricCards(viewModel.views.byKey.extremes.cards)}
        </div>
      `;
  },

  patch(context, root, viewModel) {
    const content = viewModel.views.byKey.extremes;
    if (!content) return;
    patchMetricCardPair(root.querySelector(CONTAINER_SELECTOR), content.cards, () => renderMetricCards(content.cards));
  },
};
