// Positions the three top labels of the daily-range scale bar.
//
// The policy, and why it is not a symmetric declutter: `current` is a FIXED pivot,
// never repositioned. Only min and max are ever allowed to drift from their own
// anchors to avoid overlapping a neighbour.
//
// An earlier version modelled all three labels as equally free-floating items in one
// shared forward/backward declutter group. That shared group also included an
// edge-clamp step — shift the WHOLE group if any member ran past the bar's edge —
// which could silently drag `current` away from its own marker even without a direct
// collision, for instance when min or max naturally anchored right at 0% or 100% of a
// wide value range. `current` has no visual identity distinct from the marker directly
// above it, so a drifted `current` label reads as belonging to whichever marker it
// ends up nearest, typically max. `current` is the primary live value; min and max are
// historical context values that can absorb a shift without creating a misleading
// reading.

import { clamp } from "../../core/numbers.js";
import { measuredWidth } from "../primitives/dom.js";
import { resolveLabelForm } from "./label-form.js";
import { LABEL_GAP_PX, layoutSideLabelGroup } from "./side-labels.js";

const SIDE_LABEL_SELECTOR = {
  min: ".rtc-range-scale-label-min",
  max: ".rtc-range-scale-label-max",
};

export function resolveRangeScaleLabels(containerEl, content) {
  if (!containerEl || !content) return;
  const bar = containerEl.querySelector(".rtc-scale-bar");
  const currentEl = containerEl.querySelector(".rtc-range-scale-label-current");
  const topRow = containerEl.querySelector(".rtc-range-scale-top-row");
  if (!bar || !currentEl || !topRow) return;
  const sideElements = content.topLabels.sides.map((side) => containerEl.querySelector(SIDE_LABEL_SELECTOR[side.role]));
  if (sideElements.some((element) => !element)) return;
  const barWidth = measuredWidth(bar);
  if (!barWidth) return;

  const gap = LABEL_GAP_PX;
  // Reset any previous shrink before measuring natural widths — otherwise a
  // still-applied maxWidth from an earlier narrow-bar pass would be measured as if it
  // were the label's natural size, the same measure-before-shrink idempotency the
  // optimal label depends on.
  for (const element of [currentEl, ...sideElements]) element.style.maxWidth = "";

  // Step 1: fix current's own centre. The long/short choice happens first, because
  // current reserves [currentLeft - gap, currentRight + gap] exclusively for itself
  // and a long current label eating too much of the bar can starve min and max of
  // room. "Fits" is deliberately the WORST case — min and max both landing on the same
  // side, which happens when the average sits outside [min, max] — so current's
  // reserved width plus the standard gaps must still leave room for BOTH side labels'
  // natural widths stacked together, even though they usually split across both sides
  // and have far more room than that. This is never a consequence of an actual
  // min-versus-max collision; that stays layoutSideLabelGroup()'s job via its own
  // ellipsis fallback. The side labels are measured lazily inside the closure, so the
  // many languages whose short form equals the long form never pay for the extra
  // reflows at all.
  let currentWidth = resolveLabelForm(
    currentEl,
    content.topLabels.current.long,
    content.topLabels.current.short,
    (width) => barWidth - width - 2 * gap >= measuredWidth(sideElements[0]) + gap + measuredWidth(sideElements[1])
  );
  if (currentWidth > barWidth) {
    currentEl.style.maxWidth = `${barWidth}px`;
    currentWidth = measuredWidth(currentEl);
  }
  const currentAnchor = (barWidth * content.topLabels.current.position) / 100;
  const currentCenter = clamp(currentAnchor, currentWidth / 2, barWidth - currentWidth / 2);
  const currentLeft = currentCenter - currentWidth / 2;
  const currentRight = currentCenter + currentWidth / 2;
  currentEl.style.left = `${currentCenter}px`;

  // Step 2: assign min and max to a side of the fixed pivot.
  //
  // The tie-detection key (sortKey) is compared for EQUALITY only and never parsed
  // back into a number: a grouped display value such as "1,200" is not valid numeric
  // input, and an earlier version that re-parsed it compared as NaN, which made the
  // tie-break fall through to "right" for every value above 999. Actual ordering when
  // not tied uses the raw numeric value.
  //
  // This is also what makes "current outside [min, max]" — which happens when the
  // range entity updates less often than the primary — fall out naturally: if both min
  // and max are numerically below (or both above) current, both land on the same side
  // and are packed there, preserving their own min-before-max order. No separate
  // branch is needed.
  const currentKey = content.topLabels.current.sortKey;
  const currentValue = content.topLabels.current.value;
  const sideItems = content.topLabels.sides.map((side, index) => ({
    el: sideElements[index],
    anchor: (barWidth * side.position) / 100,
    value: side.value,
    semanticRank: side.semanticRank,
    side:
      side.sortKey !== currentKey
        ? side.value < currentValue
          ? "left"
          : "right"
        : side.semanticRank < 1
          ? "left"
          : "right",
    width: measuredWidth(sideElements[index]),
  }));
  const leftItems = sideItems.filter((item) => item.side === "left").sort((a, b) => a.value - b.value);
  const rightItems = sideItems.filter((item) => item.side === "right").sort((a, b) => a.value - b.value);

  // Step 3: keep as many historical labels as possible on current's own line. If a side
  // group does not fit naturally between the fixed pivot and its outer edge, lift ONLY
  // the item nearest current (last on the left, first on the right), then re-check —
  // targeting the actual collision instead of also moving the unrelated label on the
  // opposite side. Lifted items are laid out over the full bar width; the ones that
  // stay keep the independent per-side packing. No label geometry ever feeds back into
  // the value-derived scale, and current never moves horizontally.
  const fitsNaturally = (items, edgeMin, edgeMax) =>
    items.length === 0 ||
    items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1) <= edgeMax - edgeMin;
  const liftUntilFit = (items, edgeMin, edgeMax, side) => {
    const lower = [...items];
    const upper = [];
    while (lower.length && !fitsNaturally(lower, edgeMin, edgeMax)) {
      upper.push(side === "left" ? lower.pop() : lower.shift());
    }
    return { lower, upper };
  };
  const leftLayout = liftUntilFit(leftItems, 0, currentLeft - gap, "left");
  const rightLayout = liftUntilFit(rightItems, currentRight + gap, barWidth, "right");
  const upperItems = [...leftLayout.upper, ...rightLayout.upper].sort(
    (a, b) => a.value - b.value || a.semanticRank - b.semanticRank
  );

  topRow.classList.toggle("rtc-range-scale-has-upper", upperItems.length > 0);
  for (const item of sideItems) {
    item.el.classList.toggle("rtc-range-scale-label-upper", upperItems.includes(item));
  }
  layoutSideLabelGroup(leftLayout.lower, 0, currentLeft - gap, gap);
  layoutSideLabelGroup(rightLayout.lower, currentRight + gap, barWidth, gap);
  layoutSideLabelGroup(upperItems, 0, barWidth, gap);

  for (const item of sideItems) {
    item.el.style.left = `${item.left + item.width / 2}px`;
  }
}
