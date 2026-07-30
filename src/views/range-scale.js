// The daily-range scale view.
//
// The same bar as the main scale view, with today's minimum and maximum as markers
// instead of the coldest and warmest room, and a top row of three labels above their
// own markers instead of a single comfort pill. The cold and warm marker classes are
// reused for min and max: identical shape and CSS, a different meaning in this view.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literals is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../core/text.js";
import { patchMarker, renderMarker } from "../render/primitives/marker.js";
import { patchScaleBar, renderScaleBar } from "../render/primitives/scale-bar.js";
import { resolveOptimalLabelPosition } from "../render/layout/optimal-label.js";
import { resolveRangeScaleLabels } from "../render/layout/range-scale-labels.js";

const VIEW_CLASS = "rtc-range-scale-view";
const CONTAINER_SELECTOR = `.${VIEW_CLASS}`;

// The initial percentage lefts. The layout pass converts them to pixels once it can
// measure the rendered widths; until then the percentage is the honest approximation.
const SIDE_LABEL_CLASS = { min: "rtc-range-scale-label-min", max: "rtc-range-scale-label-max" };

function renderTopRow(content) {
  const current = content.topLabels.current;
  const sidesHtml = content.topLabels.sides
    .map(
      (side) =>
        `<span class="${SIDE_LABEL_CLASS[side.role]}" style="left:${side.position}%">${escapeHtml(side.text)}</span>`
    )
    .join("\n            ");
  return `
          <div class="rtc-range-scale-top-row">
            <span class="rtc-range-scale-label-current" style="left:${current.position}%">${escapeHtml(current.long)}</span>
            ${sidesHtml}
          </div>
      `;
}

function renderMarkers(content) {
  return `
            ${renderMarker(content.markers.min, { classNames: "rtc-marker rtc-marker-cold" })}
            ${renderMarker(content.markers.max, { classNames: "rtc-marker rtc-marker-warm" })}
            ${renderMarker(content.markers.average, { classNames: "rtc-marker rtc-marker-avg" })}
      `;
}

export const rangeScaleView = {
  key: "range_scale",

  // The optional nodes of this view's markup (see scaleView.structureSignature()).
  // The three top labels and the three markers are always emitted here, so only the
  // two bands, the optimal label and the footer can appear or disappear.
  structureSignature(content) {
    return [
      content.showComfortBand ? "c" : "-", // .rtc-comfort-band
      content.showOptimalBand ? "o" : "-", // .rtc-optimal-band
      content.optimalLabel ? "O" : "-", //    .rtc-scale-label-center
      content.footerText === null ? "-" : "f", // .rtc-scale-footer
    ].join("");
  },

  render(context, viewModel) {
    const content = viewModel.views.byKey.range_scale;
    return renderScaleBar({
      content,
      viewClass: VIEW_CLASS,
      topRowHtml: renderTopRow(content),
      markersHtml: renderMarkers(content),
    });
  },

  patch(context, root, viewModel) {
    const content = viewModel.views.byKey.range_scale;
    if (!content) return;
    const containerEl = root.querySelector(CONTAINER_SELECTOR);
    if (!containerEl) return;
    patchScaleBar(containerEl, content);
    resolveOptimalLabelPosition(containerEl, content);

    const currentLabelEl = containerEl.querySelector(".rtc-range-scale-label-current");
    if (currentLabelEl) currentLabelEl.style.left = `${content.topLabels.current.position}%`;
    for (const side of content.topLabels.sides) {
      const sideEl = containerEl.querySelector(`.${SIDE_LABEL_CLASS[side.role]}`);
      if (sideEl) sideEl.style.left = `${side.position}%`;
    }

    patchMarker(containerEl.querySelector(".rtc-marker-cold"), content.markers.min);
    patchMarker(containerEl.querySelector(".rtc-marker-warm"), content.markers.max);
    patchMarker(containerEl.querySelector(".rtc-marker-avg"), content.markers.average);

    resolveRangeScaleLabels(containerEl, content);
  },

  resolveLayout(context, root, viewModel) {
    const content = viewModel.views.byKey.range_scale;
    if (!content) return;
    const containerEl = root.querySelector(CONTAINER_SELECTOR);
    if (!containerEl) return;
    // This view has two label groups to resolve: the shared optimal label under the
    // bar, and its own three top labels. Resolving only the second would leave the
    // first at its unresolved initial percentage through the first render, a resize
    // and font-ready, catching up only on the next data update.
    resolveOptimalLabelPosition(containerEl, content);
    resolveRangeScaleLabels(containerEl, content);
  },
};
