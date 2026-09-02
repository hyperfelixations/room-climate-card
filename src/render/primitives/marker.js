// Scale marker; only near-identical extrema use calc(percent + pixel nudge).
// Ordinary markers retain the shipped plain-percentage style.

import { escapeHtml } from "../../core/text.js";

export function markerStyle(marker, { useShift = false } = {}) {
  const left = useShift ? `calc(${marker.position}% + ${marker.shiftPx}px)` : `${marker.position}%`;
  return `left:${left};--marker-color:${marker.color};--marker-shadow:${marker.shadow};`;
}

// Preserve shipped attribute order for room marker indexes.
export function renderMarker(marker, { classNames, extraAttributes = "", useShift = false }) {
  return `<div class="${classNames}"${extraAttributes} style="${markerStyle(marker, { useShift })}" title="${escapeHtml(marker.title)}"></div>`;
}

export function patchMarker(element, marker, { useShift = false } = {}) {
  if (!element) return;
  element.setAttribute("style", markerStyle(marker, { useShift }));
  element.setAttribute("title", marker.title);
}
