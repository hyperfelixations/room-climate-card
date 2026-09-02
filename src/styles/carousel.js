// SHIPPED STYLESHEET SLICE: carousel rotator, track and view slots.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export function carouselCss({ trackAnimationCss, viewCount, viewWidthPct }) {
  return `        .rtc-rotator-solo {
          min-width: 0;
          height: 70px;
          /* Extend paint upward for RangeScale's upper label while clipping horizontally;
             the directional clip does not alter layout or bar geometry. */
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
          /* Requested-but-unavailable views use the existing 70px solo box for a
             centered localized hint. */
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
