// Positions the comfort-band label above a scale bar.
//
// The same problem the optimal label has below the bar, with a simpler answer: nothing
// else shares this row, so the only thing the label has to stay clear of is the row's
// own two edges. A percentage alone cannot do that — the percentage places the label's
// CENTRE, while half its text width is measured in pixels, so a band pressed towards
// either end of the axis carries the label past the edge. Nothing clips an individual
// carousel slide, so it then paints across the view beside it.
//
// The label is never lifted onto a second line the way the daily-range labels are: in
// the worst case it sits flush against one end of the row, and if even the short form
// fills the whole row it truncates. It stays above the bar in every case.
//
// The desired position is derived fresh from the geometry each time and never read back
// from this function's own previous output, so repeated calls converge instead of
// drifting — the same requirement resolveOptimalLabelPosition() documents.

import { clamp } from "../../core/numbers.js";
import { measuredWidth } from "../primitives/dom.js";
import { resolveLabelForm } from "./label-form.js";

export function resolveComfortLabelPosition(containerEl, content) {
  if (!containerEl || !content?.comfortLabel) return;
  const row = containerEl.querySelector(".rtc-scale-comfort-row");
  const label = containerEl.querySelector(".rtc-scale-comfort-label");
  // A hidden label has no box to measure and no position worth computing; the band it
  // describes is off the axis entirely (see scaleGeometry()).
  if (!row || !label || label.hidden) return;

  // A previous call may have capped the width below. Clearing it first is what makes
  // this idempotent: without it a second call would measure the already-shrunk box,
  // conclude it now fits, and let the text spring back.
  label.style.maxWidth = "";

  // The row is both the anchor and the boundary, and it can be both because the row and
  // the bar are items of the same single-column grid (.rtc-scale-view) and therefore
  // exactly as wide as each other. A percentage of the axis is a percentage of the row.
  const rowWidth = measuredWidth(row);
  if (!rowWidth) return;

  // Three steps, in order of how much they cost the reader: the long form if it fits at
  // all, the short form if it does not, and only then the clamp and the ellipsis. Which
  // form is showing is decided here rather than in patch(), because it depends on the
  // rendered width of exactly this text — the same ownership the optimal label has.
  const naturalWidth = resolveLabelForm(label, content.comfortLabel.long, content.comfortLabel.short, (width) => width <= rowWidth);
  if (naturalWidth > rowWidth) label.style.maxWidth = `${rowWidth}px`;
  const width = Math.min(naturalWidth, rowWidth);

  const desiredPx = (rowWidth * content.comfortLabel.center) / 100;
  label.style.left = `${clamp(desiredPx, width / 2, rowWidth - width / 2)}px`;
}
