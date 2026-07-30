// The card's complete stylesheet, assembled from its sections.
//
// The sections are contiguous slices of one original stylesheet and are joined with
// NOTHING between them: each slice already carries the blank line that separated it
// from the next. That is what makes this composition byte-identical to the single
// template it replaced, and why the order below is normative rather than cosmetic.
//
// Only four values vary per render, and all four come from the carousel: the
// generated auto-slide keyframes, the track's animation declarations, how many views
// are mounted, and how wide one view is inside the track. Everything else is static.
//
// Deliberately NOT adoptedStyleSheets: the card ships one <style> element inside its
// shadow root, which is what the DOM characterization baselines capture and what makes
// the stylesheet inspectable in the browser's element panel.

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
import { EMPTY_CSS } from "./empty.js";
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
    EMPTY_CSS,
    RESPONSIVE_CSS,
    MOTION_CSS,
  ].join("");
}
