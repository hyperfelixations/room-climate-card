// Positions a small group of labels inside a horizontal span without overlaps.
//
// A deterministic four-step declutter: anchor each item on its own value, push
// forwards to clear the previous one, clamp the group back inside the right edge,
// then push backwards and clamp inside the left edge. The result depends only on the
// inputs, so repeated calls converge instead of drifting.
//
// Mutates each item's .left and .width in place and does not touch the DOM except to
// cap a width that cannot fit — the caller applies el.style.left once, after every
// group has been laid out.

import { measuredWidth } from "../primitives/dom.js";

export function layoutSideLabelGroup(items, edgeMin, edgeMax, gap) {
  if (items.length === 0) return;
  const available = edgeMax - edgeMin;
  const requiredWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
  if (requiredWidth > available) {
    const maxWidthEach = Math.max(0, (available - gap * (items.length - 1)) / items.length);
    for (const item of items) {
      item.el.style.maxWidth = `${maxWidthEach}px`;
      item.width = Math.min(item.width, measuredWidth(item.el));
    }
  }

  for (const item of items) item.left = item.anchor - item.width / 2;

  for (let i = 1; i < items.length; i++) {
    items[i].left = Math.max(items[i].left, items[i - 1].left + items[i - 1].width + gap);
  }
  const overflow = items[items.length - 1].left + items[items.length - 1].width - edgeMax;
  if (overflow > 0) {
    for (const item of items) item.left -= overflow;
  }
  for (let i = items.length - 2; i >= 0; i--) {
    items[i].left = Math.min(items[i].left, items[i + 1].left - gap - items[i].width);
  }
  const underflow = Math.min(0, items[0].left - edgeMin);
  if (underflow < 0) {
    for (const item of items) item.left -= underflow;
  }
}

// The minimum visual gap between two adjacent labels, in CSS pixels. Shared by every
// layout pass so the spacing is consistent across the two scale-shaped views.
export const LABEL_GAP_PX = 4;
