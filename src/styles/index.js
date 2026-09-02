// Assemble 13 contiguous slices with no separator; their order and owned blank lines are normative.
// Only carousel keyframes/animation/view count/view width vary; the shadow root keeps one inspectable <style>.
// Contract: internal documentation §5 “Build/Rollup/HACS-Auslieferung”.

import { tokensCss } from "./tokens.js";
import { CARD_CSS } from "./card.js";
import { HEADER_CSS } from "./header.js";
import { AVERAGE_CSS } from "./average.js";
import { carouselCss } from "./carousel.js";
import { SCALE_VIEW_CSS } from "./scale-view.js";
import { RANGE_SCALE_VIEW_CSS } from "./range-scale-view.js";
import { SCALE_BAR_CSS } from "./scale-bar.js";
import { CARDS_CSS } from "./cards.js";
import { ROOMS_CSS } from "./rooms.js";
import { AVAILABILITY_CSS } from "./availability.js";
import { RESPONSIVE_CSS } from "./responsive.js";
import { MOTION_CSS } from "./motion.js";

export function buildStyles({ keyframes, trackAnimationCss, viewCount, viewWidthPct }) {
  return [
    tokensCss({ keyframes }),
    CARD_CSS,
    HEADER_CSS,
    AVERAGE_CSS,
    carouselCss({ trackAnimationCss, viewCount, viewWidthPct }),
    SCALE_VIEW_CSS,
    RANGE_SCALE_VIEW_CSS,
    SCALE_BAR_CSS,
    CARDS_CSS,
    ROOMS_CSS,
    AVAILABILITY_CSS,
    RESPONSIVE_CSS,
    MOTION_CSS,
  ].join("");
}
