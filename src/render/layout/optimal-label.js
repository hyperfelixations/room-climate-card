// Positions the optimal-band label under a scale bar.
//
// The label is centred on a percentage, but text width is fixed in pixels while the
// bar's rendered width varies with the card and the viewport — a percentage alone
// cannot guarantee it will not visually collide with the min/max edge labels in the
// same row. That is most acute for the one-sided metrics (CO2, particulates, CO), whose optimal
// band starts at the bar's left edge.
//
// The desired position is always derived fresh from the geometry — the one
// authoritative source — never read back from this function's own previous (already
// pixel-valued) output, so repeated calls cannot drift.
//
// Scoped to the view's own container rather than the whole root: both scale-shaped
// views can be mounted at once and share the same inner class names, so a root-wide
// query would only ever find the first.

import { clamp } from "../../core/numbers.js";
import { measuredWidth, setStyleProperty } from "../primitives/dom.js";
import { resolveLabelForm } from "./label-form.js";
import { LABEL_GAP_PX } from "./side-labels.js";

export function resolveOptimalLabelPosition(containerEl, content) {
  if (!containerEl || !content?.optimalLabel) return;
  const bar = containerEl.querySelector(".rtc-scale-bar");
  const minEl = containerEl.querySelector(".rtc-scale-label-min");
  const centerEl = containerEl.querySelector(".rtc-scale-label-center");
  const maxEl = containerEl.querySelector(".rtc-scale-label-max");
  if (!bar || !minEl || !centerEl || !maxEl) return;

  // A previous call may have constrained centerEl's width (see maxWidth below).
  // Clearing it first guarantees this call measures the natural, unconstrained width.
  // Without it, a second call shortly after the first would measure the already-shrunk
  // box, wrongly conclude it now fits, clear maxWidth again, and let the text spring
  // back — an infinite narrow/widen loop between repeated calls, which the resize
  // observer can legitimately trigger.
  setStyleProperty(centerEl, "max-width", "");

  const barWidth = measuredWidth(bar);
  if (!barWidth) return;
  const minWidth = measuredWidth(minEl);
  const maxWidth = measuredWidth(maxEl);
  const gap = LABEL_GAP_PX;

  // "Fits" is the exact same lowLimit <= highLimit criterion computed below, just
  // evaluated for whichever candidate form actually measures at that width.
  const { long, short, compact } = content.optimalLabel;
  const centerWidth = resolveLabelForm(
    centerEl,
    [long, short, compact],
    (width) => minWidth + gap + width / 2 <= barWidth - maxWidth - gap - width / 2
  );

  const desiredPx = (barWidth * content.optimalLabel.center) / 100;
  const lowLimit = minWidth + gap + centerWidth / 2;
  const highLimit = barWidth - maxWidth - gap - centerWidth / 2;
  // `fits`: a non-overlapping position exists at the label's natural width, so it is
  // clamped onto its band between the two edge labels. Otherwise the label is capped
  // to the free span between those labels and fills it exactly — gap-clear of both,
  // truncating in place — rather than detaching to the bar's midpoint.
  const fits = lowLimit <= highLimit;
  if (fits) {
    setStyleProperty(centerEl, "left", `${clamp(desiredPx, lowLimit, highLimit)}px`);
    setStyleProperty(centerEl, "max-width", "");
  } else {
    const spanWidth = Math.max(0, barWidth - minWidth - maxWidth - 2 * gap);
    setStyleProperty(centerEl, "left", `${minWidth + gap + spanWidth / 2}px`);
    setStyleProperty(centerEl, "max-width", `${spanWidth}px`);
  }
}
