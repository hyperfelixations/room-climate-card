// The scale's min and max labels share the row under the bar and never cover each other: the
// full form while both fit side by side with the gap, then the compact form, then capped with
// an ellipsis. A label that fits in half the row keeps its width and the other gets the rest.
// Runs before the optimal label, which is placed between the two.

import { measuredWidth, setStyleProperty, setText } from "../primitives/dom.js";
import { LABEL_GAP_PX } from "./side-labels.js";

export function resolveEdgeLabels(containerEl, content) {
  if (!containerEl || !content?.boundaryLabels) return;
  const bar = containerEl.querySelector(".rtc-scale-bar");
  const minEl = containerEl.querySelector(".rtc-scale-label-min");
  const maxEl = containerEl.querySelector(".rtc-scale-label-max");
  if (!bar || !minEl || !maxEl) return;

  // Reset before measuring; otherwise an earlier cap makes repeated passes oscillate.
  setStyleProperty(minEl, "max-width", "");
  setStyleProperty(maxEl, "max-width", "");
  const barWidth = measuredWidth(bar);
  if (!barWidth) return;
  const available = barWidth - LABEL_GAP_PX;
  const fits = () => measuredWidth(minEl) + measuredWidth(maxEl) <= available;

  setText(minEl, content.boundaryLabels.min);
  setText(maxEl, content.boundaryLabels.max);
  if (fits()) return;
  const compact = content.compactBoundaryLabels;
  if (compact?.min || compact?.max) {
    setText(minEl, compact.min ?? content.boundaryLabels.min);
    setText(maxEl, compact.max ?? content.boundaryLabels.max);
    if (fits()) return;
  }

  const minWidth = measuredWidth(minEl);
  const maxWidth = measuredWidth(maxEl);
  const half = Math.max(0, available / 2);
  let minCap = half;
  let maxCap = half;
  if (minWidth <= half) maxCap = available - minWidth;
  else if (maxWidth <= half) minCap = available - maxWidth;
  if (minWidth > minCap) setStyleProperty(minEl, "max-width", `${Math.max(0, minCap)}px`);
  if (maxWidth > maxCap) setStyleProperty(maxEl, "max-width", `${Math.max(0, maxCap)}px`);
}
