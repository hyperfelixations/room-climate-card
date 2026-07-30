// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The view carousel: the rotator, the track and one view's slot in it.

export function carouselCss({ trackAnimationCss, viewCount, viewWidthPct }) {
  return `        .rtc-rotator-solo {
          min-width: 0;
          height: 70px;
          /* Keep the carousel clipped horizontally, but extend its paint
             viewport upward for RangeScale's collision-only upper label.
             overflow:hidden and paint containment both clipped at the
             border box, which cut the label under Home Assistant's real
             font metrics. The directional clip changes paint only: layout,
             row heights, and the scale-bar position remain untouched. */
          overflow: visible;
          clip-path: inset(-10px 0 0 0);
          border-radius: 14px;
          contain: layout style;
        }

        .rtc-rotator {
          /* Only the swipeable rotator needs pan-y so vertical scroll still reaches the browser. */
          touch-action: pan-y;
        }

        .rtc-no-views {
          /* _renderNoActiveViews(): a requested-but-unavailable view (e.g.
             range_scale with no valid range_entity) falls back to this
             localized one-line hint instead of the usual view content.
             Previously unstyled — it inherited plain block/left/top text
             instead of matching the rest of the card's centered, muted
             typography. Same box as .rtc-rotator-solo above (this class is
             always combined with it, never alone), so centering here only
             needs flex on that existing 70px-tall box. */
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
          color: var(--secondary-text-color);
        }

        .rtc-track {
          /* Width is views.length*100% so all views sit correctly side by side. */
          display: flex;
          width: ${Math.max(1, viewCount) * 100}%;
          height: 70px;
          align-items: stretch;
          ${trackAnimationCss}
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          will-change: transform;
        }

        .rtc-track.rtc-manual {
          animation: none !important;
        }

        .rtc-view {
          /* Width is 100/views.length % of the track's own width. */
          flex: 0 0 ${viewWidthPct}%;
          width: ${viewWidthPct}%;
          min-width: 0;
          box-sizing: border-box;
        }

`;
}
