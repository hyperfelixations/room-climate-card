// A marker on a scale bar: a coloured pin at a percentage of the bar's width.
//
// Two style forms exist, and the difference is not cosmetic. The two extrema markers
// can be nudged apart by a few pixels when their values are nearly identical, so
// their offset is a calc() of a percentage plus a pixel shift. Every other marker
// sits exactly where its value puts it and uses the plain percentage — emitting a
// calc() with "+ 0px" for those would change the shipped markup for no reason.

import { escapeHtml } from "../../core/text.js";

export function markerStyle(marker, { useShift = false } = {}) {
  const left = useShift ? `calc(${marker.position}% + ${marker.shiftPx}px)` : `${marker.position}%`;
  return `left:${left};--marker-color:${marker.color};--marker-shadow:${marker.shadow};`;
}

// `extraAttributes` is inserted between the class and the style attribute, which is
// where the room markers' data-room-marker-index sits in the shipped markup.
export function renderMarker(marker, { classNames, extraAttributes = "", useShift = false }) {
  return `<div class="${classNames}"${extraAttributes} style="${markerStyle(marker, { useShift })}" title="${escapeHtml(marker.title)}"></div>`;
}

export function patchMarker(element, marker, { useShift = false } = {}) {
  if (!element) return;
  element.setAttribute("style", markerStyle(marker, { useShift }));
  element.setAttribute("title", marker.title);
}
