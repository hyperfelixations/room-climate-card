// Assemble 13 contiguous slices with no separator; their order and owned blank lines are normative.
// Only carousel keyframes/animation/view count/view width, the view-area height and the size
// factors vary; the shadow root keeps one inspectable <style>.
// Contract: see internal dev doc §5 "Build, Rollup und Release-Asset" and "Kartengröße".

import { UNSCALED_SIZE } from "../core/size.js";
import { tokensCss } from "./tokens.js";
import { cardCss } from "./card.js";
import { headerCss } from "./header.js";
import { averageCss } from "./average.js";
import { carouselCss } from "./carousel.js";
import { scaleViewCss } from "./scale-view.js";
import { rangeScaleViewCss } from "./range-scale-view.js";
import { scaleBarCss } from "./scale-bar.js";
import { cardsCss } from "./cards.js";
import { roomsCss } from "./rooms.js";
import { availabilityCss } from "./availability.js";
import { responsiveCss } from "./responsive.js";
import { MOTION_CSS } from "./motion.js";

export function buildStyles({ keyframes, trackAnimationCss, viewCount, viewWidthPct, viewHeight, size = UNSCALED_SIZE }) {
  return [
    tokensCss({ keyframes, viewHeight }, size),
    cardCss(size),
    headerCss(size),
    averageCss(size),
    carouselCss({ trackAnimationCss, viewCount, viewWidthPct }, size),
    scaleViewCss(size),
    rangeScaleViewCss(size),
    scaleBarCss(size),
    cardsCss(size),
    roomsCss(size),
    availabilityCss(size),
    responsiveCss(size),
    MOTION_CSS,
  ].join("");
}
