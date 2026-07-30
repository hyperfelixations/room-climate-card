// The extreme-value view: two metric cards for the coldest and the warmest room.
//
// The two slots are role-keyed, not entity-keyed: when a different room becomes the
// coldest, the same card node is patched with the new room's data rather than being
// replaced. A focused card therefore never loses focus just because the room behind
// it changed.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literal is shipped markup
// and is captured verbatim by the DOM characterization baselines.

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
