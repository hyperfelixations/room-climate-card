// The main scale view.
//
// A dynamic axis with a comfort band, an optimal band and one to N markers. This
// module knows how those are drawn and patched; it decides nothing about what they
// mean. Every string, colour, percentage and pixel offset it interpolates is already
// finished on the view model.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literals is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../core/text.js";
import { patchMarker, renderMarker } from "../render/primitives/marker.js";
import { patchScaleBar, renderScaleBar } from "../render/primitives/scale-bar.js";
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
  const comfortLabelHtml = content.comfortLabel
    ? `<span class="rtc-scale-comfort-label" style="left:${content.comfortLabel.center}%"${content.comfortLabel.visible ? "" : " hidden"}>${escapeHtml(content.comfortLabel.text)}</span>`
    : "";
  return `
          <div class="rtc-scale-comfort-row">
            ${comfortLabelHtml}
          </div>
      `;
}

// `markers: all` is a keyed, data-driven marker set. Room availability can change
// while the view itself stays mounted, so the markers are patched by the room's
// original YAML index rather than by assuming the initial count is stable. These
// markers are non-interactive, so adding and removing them cannot disturb focus.
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

  // Which parts of this view's markup are OPTIONAL and NOT reconciled by patch().
  //
  // A patcher can only change nodes that exist, so a change here means the view has to
  // be rebuilt rather than patched. The list enumerates the optional NODES rather than
  // the conditions behind them — two of them happen to share a condition today, and
  // listing them separately means a later divergence between a band and its label is
  // already covered without editing this function.
  //
  // The room markers are deliberately absent: patchRoomMarkers() creates and removes
  // them itself, so listing them would cost a full rebuild — and a reset carousel —
  // every time a single room came or went.
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

  // The string renderers ignore the context — they produce markup, not nodes. The
  // parameter is part of the registry's uniform contract.
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

    const comfortLabelEl = containerEl.querySelector(".rtc-scale-comfort-label");
    if (comfortLabelEl && content.comfortLabel) {
      comfortLabelEl.style.left = `${content.comfortLabel.center}%`;
      comfortLabelEl.textContent = content.comfortLabel.text;
      comfortLabelEl.hidden = !content.comfortLabel.visible;
    }

    // The extrema markers only exist in room mode; the guards simply no-op otherwise.
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

  resolveLayout(context, root, viewModel) {
    const content = viewModel.views.byKey.scale;
    if (!content) return;
    resolveOptimalLabelPosition(root.querySelector(CONTAINER_SELECTOR), content);
  },
};
