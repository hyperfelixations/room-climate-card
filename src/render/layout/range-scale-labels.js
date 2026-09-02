// Position daily-range labels around a fixed `current` pivot; only historical min/max drift.
// Moving the live label away from its marker would misattribute it to a neighbouring marker.

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
  // Reset previous caps before measuring natural widths; measure-before-shrink is idempotent.
  for (const element of [currentEl, ...sideElements]) element.style.maxWidth = "";

  // Step 1: fix current's centre after long/short selection. Its reserved span must leave
  // room for both side labels in the worst case where both fall on one side; side-label
  // collisions remain layoutSideLabelGroup()'s concern. Lazy measurement avoids needless reflow.
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

  // Step 2: assign sides around the fixed pivot. Compare formatted sortKey only for equality;
  // parsing grouped display text (for example "1,200") produces NaN. Raw values order non-ties,
  // naturally placing both historical labels together when current lies outside their range.
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

  // Step 3: lift only the side item nearest current until each lower group fits. Upper labels
  // use the full width; lower groups keep independent packing. Geometry never changes the scale.
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
