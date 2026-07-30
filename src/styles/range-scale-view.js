// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The daily-range scale view: its three top labels and the lifted-label row.

export const RANGE_SCALE_VIEW_CSS = `        /* "rangeScale" view (optional, requested via views:
           [{type:"range_scale"}]): same overall
           layout as .rtc-scale-view, but its top row holds three labels
           (current/min/max) above their markers instead of one centered
           "Komfort" pill — positions set/corrected in JS, see
           _renderRangeScaleView()/_resolveRangeScaleLabels(). */
        .rtc-range-scale-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          align-content: center;
          gap: 4px;
          padding: 0 1px;
        }

        .rtc-range-scale-top-row {
          position: relative;
          height: 12px;
          font-size: 10px;
          font-weight: 800;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-range-scale-label-current,
        .rtc-range-scale-label-min,
        .rtc-range-scale-label-max {
          position: absolute;
          top: 0;
          /* JS sets style.left to a resolved center px value (see
             _resolveRangeScaleLabels()), which this transform then centers
             on. current is a FIXED pivot — always exactly centered on the
             .rtc-marker-avg current-value marker, never repositioned by
             collision avoidance. Only min/max drift off-center from their
             own marker, and only when they'd otherwise overlap current or
             each other. Ellipsis only actually engages when
             _resolveRangeScaleLabels()/_layoutSideLabelGroup() sets an
             explicit max-width (a side group doesn't fit even at natural
             width, or — rarely — current alone is wider than the whole bar)
             — harmless no-op otherwise. */
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* When one historical label cannot fit between the fixed current
           pivot and its outer edge, only that colliding label moves to the
           upper line. Current and any non-colliding historical label share
           the lower line. The row height itself stays 12px, so the scale
           bar's grid position never changes. */
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-current,
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-min,
        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-max {
          top: 4px;
          line-height: 12px;
        }

        .rtc-range-scale-top-row.rtc-range-scale-has-upper
          .rtc-range-scale-label-upper {
          top: -8px;
          line-height: 12px;
          /* The generic label rule clips horizontally for the genuine
             narrow-bar ellipsis fallback. A lifted min/max label instead
             sits partly outside its normal line box; Home Assistant's real
             font rasterization can paint glyph ink beyond that tight box
             (most visibly the i-dot in "min"). Let the short historical
             label paint freely in both axes so neither min nor max can
             self-clip. Position, row height, and therefore the bar stay
             byte-for-byte unchanged. */
          overflow: visible;
          text-overflow: clip;
        }

`;
