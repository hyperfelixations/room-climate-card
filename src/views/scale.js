// Draw/patch the view-model-complete dynamic scale without interpreting its semantics.
// Template-literal indentation is shipped markup and baseline-pinned.

import { escapeHtml } from "../core/text.js";
import { patchMarker, renderMarker } from "../render/primitives/marker.js";
import { patchScaleBar, renderScaleBar } from "../render/primitives/scale-bar.js";
import { resolveComfortLabelPosition } from "../render/layout/comfort-label.js";
import { resolveOptimalLabelPosition } from "../render/layout/optimal-label.js";

const VIEW_CLASS = "rtc-scale-view";
const CONTAINER_SELECTOR = `.${VIEW_CLASS}`;

function renderMarkers(content) {
  const extremaHtml = content.markers.extremes
    ? `
            ${renderMarker(content.markers.extremes.cold, { classNames: "rtc-marker rtc-marker-cold", useShift: true })}
            ${renderMarker(content.markers.extremes.warm, { classNames: "rtc-marker rtc-marker-warm", useShift: true })}
          `
    : "";
  const roomsHtml = content.markers.rooms
    .map(
      (marker) => `
            ${renderMarker(marker, {
              classNames: "rtc-marker rtc-marker-room",
              extraAttributes: ` data-room-marker-index="${marker.index}"`,
            })}
          `
    )
    .join("");
  const averageClass = content.emphasizeAverage ? " rtc-marker-emphasized" : "";

  return `
            ${extremaHtml}
            ${roomsHtml}
            ${renderMarker(content.markers.average, { classNames: `rtc-marker rtc-marker-avg${averageClass}` })}
      `;
}

function renderTopRow(content) {
  // Long form/percentage are initial approximations until measured layout runs.
  const comfortLabelHtml = content.comfortLabel
    ? `<span class="rtc-scale-comfort-label" style="left:${content.comfortLabel.center}%"${content.comfortLabel.visible ? "" : " hidden"}>${escapeHtml(content.comfortLabel.long)}</span>`
    : "";
  return `
          <div class="rtc-scale-comfort-row">
            ${comfortLabelHtml}
          </div>
      `;
}

// Reconcile non-interactive room markers by stable YAML index as availability changes.
function patchRoomMarkers(context, containerEl, content) {
  const bar = containerEl.querySelector(".rtc-scale-bar");
  if (!bar) return;
  const existing = new Map(
    [...bar.querySelectorAll(".rtc-marker-room")].map((element) => [Number(element.dataset.roomMarkerIndex), element])
  );
  const averageMarkerEl = bar.querySelector(".rtc-marker-avg");
  for (const marker of content.markers.rooms) {
    let markerEl = existing.get(marker.index);
    if (!markerEl) {
      markerEl = context.createElement("div");
      markerEl.className = "rtc-marker rtc-marker-room";
      markerEl.dataset.roomMarkerIndex = String(marker.index);
      bar.insertBefore(markerEl, averageMarkerEl);
    }
    patchMarker(markerEl, marker);
    existing.delete(marker.index);
  }
  for (const stale of existing.values()) stale.remove();
}

export const scaleView = {
  key: "scale",

  // Sign optional nodes patch() cannot create/remove. Room markers stay out because their
  // keyed reconciler owns their lifecycle without rebuilding/resetting the carousel.
  structureSignature(content) {
    return [
      content.showComfortBand ? "c" : "-", // .rtc-comfort-band
      content.comfortLabel ? "C" : "-", //    .rtc-scale-comfort-label
      content.showOptimalBand ? "o" : "-", // .rtc-optimal-band
      content.optimalLabel ? "O" : "-", //    .rtc-scale-label-center
      content.footerText === null ? "-" : "f", // .rtc-scale-footer
      content.markers.extremes ? "x" : "-", // .rtc-marker-cold + .rtc-marker-warm
    ].join("");
  },

  // Context is unused by string renderers but belongs to the uniform registry contract.
  render(context, viewModel) {
    const content = viewModel.views.byKey.scale;
    return renderScaleBar({
      content,
      viewClass: VIEW_CLASS,
      topRowHtml: renderTopRow(content),
      markersHtml: renderMarkers(content),
    });
  },

  patch(context, root, viewModel) {
    const content = viewModel.views.byKey.scale;
    if (!content) return;
    const containerEl = root.querySelector(CONTAINER_SELECTOR);
    patchScaleBar(containerEl, content);
    resolveOptimalLabelPosition(containerEl, content);
    if (!containerEl) return;

    // Set visibility first; measured layout exclusively owns comfort-label form/position.
    const comfortLabelEl = containerEl.querySelector(".rtc-scale-comfort-label");
    if (comfortLabelEl && content.comfortLabel) {
      comfortLabelEl.hidden = !content.comfortLabel.visible;
    }
    resolveComfortLabelPosition(containerEl, content);

    // Extrema markers exist only in room mode.
    if (content.markers.extremes) {
      patchMarker(containerEl.querySelector(".rtc-marker-cold"), content.markers.extremes.cold, { useShift: true });
      patchMarker(containerEl.querySelector(".rtc-marker-warm"), content.markers.extremes.warm, { useShift: true });
    }
    patchRoomMarkers(context, containerEl, content);
    const averageMarkerEl = containerEl.querySelector(".rtc-marker-avg");
    if (averageMarkerEl) {
      patchMarker(averageMarkerEl, content.markers.average);
      averageMarkerEl.classList.toggle("rtc-marker-emphasized", content.emphasizeAverage);
    }
  },

  // Re-derive upper/lower labels on render, resize and fonts-ready.
  resolveLayout(context, root, viewModel) {
    const content = viewModel.views.byKey.scale;
    if (!content) return;
    const containerEl = root.querySelector(CONTAINER_SELECTOR);
    resolveComfortLabelPosition(containerEl, content);
    resolveOptimalLabelPosition(containerEl, content);
  },
};
