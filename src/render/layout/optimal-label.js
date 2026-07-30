// Positions the optimal-band label under a scale bar.
//
// The label is centred on a percentage, but text width is fixed in pixels while the
// bar's rendered width varies with the card and the viewport — a percentage alone
// cannot guarantee it will not visually collide with the min/max edge labels in the
// same row. That is most acute for CO2 and PM2.5, whose optimal band starts at the
// bar's left edge.
//
// The desired position is always derived fresh from the geometry — the one
// authoritative source — never read back from this function's own previous (already
// pixel-valued) output, so repeated calls cannot drift.
//
// Scoped to the view's own container rather than the whole root: both scale-shaped
// views can be mounted at once and share the same inner class names, so a root-wide
// query would only ever find the first.

import { clamp } from "../../core/numbers.js";
import { measuredWidth } from "../primitives/dom.js";
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
  centerEl.style.maxWidth = "";

  const barWidth = measuredWidth(bar);
  if (!barWidth) return;
  const minWidth = measuredWidth(minEl);
  const maxWidth = measuredWidth(maxEl);
  const gap = LABEL_GAP_PX;

  // "Fits" is the exact same lowLimit <= highLimit criterion computed below, just
  // evaluated for whichever candidate form actually measures at that width.
  const centerWidth = resolveLabelForm(
    centerEl,
    content.optimalLabel.long,
    content.optimalLabel.short,
    (width) => minWidth + gap + width / 2 <= barWidth - maxWidth - gap - width / 2
  );

  const desiredPx = (barWidth * content.optimalLabel.center) / 100;
  const lowLimit = minWidth + gap + centerWidth / 2;
  const highLimit = barWidth - maxWidth - gap - centerWidth / 2;
  // With no room anywhere even for the short form (a very narrow bar, a very long
  // label), centring is the fairest fallback — better than pinning fully against one
  // side. The label's own width is then also capped to the space actually available,
  // so it visibly truncates instead of overlapping its neighbours: the centring
  // fallback alone only prevents anchoring off-centre, not overlap caused by the
  // label's own width. Since the label is centred at barWidth/2, the space available
  // to it is bounded by whichever side is tighter, applied on BOTH sides — not by
  // minWidth + maxWidth combined, which would only be safe for an asymmetric split a
  // centred box cannot have.
  const fits = lowLimit <= highLimit;
  const targetPx = fits ? clamp(desiredPx, lowLimit, highLimit) : barWidth / 2;
  centerEl.style.left = `${targetPx}px`;
  centerEl.style.maxWidth = fits ? "" : `${Math.max(0, barWidth - 2 * Math.max(minWidth, maxWidth) - gap * 2)}px`;
}
