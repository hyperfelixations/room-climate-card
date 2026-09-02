// Keep the comfort label above its bar and inside the row, shortening then truncating if needed.
// Recompute from fresh geometry so repeated layout passes remain idempotent.

import { clamp } from "../../core/numbers.js";
import { measuredWidth } from "../primitives/dom.js";
import { resolveLabelForm } from "./label-form.js";

export function resolveComfortLabelPosition(containerEl, content) {
  if (!containerEl || !content?.comfortLabel) return;
  const row = containerEl.querySelector(".rtc-scale-comfort-row");
  const label = containerEl.querySelector(".rtc-scale-comfort-label");
  // A hidden label describes an off-axis band and has no measurable box.
  if (!row || !label || label.hidden) return;

  // Reset before measuring; otherwise an earlier cap makes repeated passes oscillate.
  label.style.maxWidth = "";

  // Row and bar share one grid column, so the row is both anchor and boundary.
  const rowWidth = measuredWidth(row);
  if (!rowWidth) return;

  // Prefer long, then short, then width clamp/ellipsis; rendered width owns this choice.
  const naturalWidth = resolveLabelForm(label, content.comfortLabel.long, content.comfortLabel.short, (width) => width <= rowWidth);
  if (naturalWidth > rowWidth) label.style.maxWidth = `${rowWidth}px`;
  const width = Math.min(naturalWidth, rowWidth);

  const desiredPx = (rowWidth * content.comfortLabel.center) / 100;
  label.style.left = `${clamp(desiredPx, width / 2, rowWidth - width / 2)}px`;
}
