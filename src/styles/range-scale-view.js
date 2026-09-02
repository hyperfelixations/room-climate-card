// SHIPPED STYLESHEET SLICE: daily-range scale labels and lifted row.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const RANGE_SCALE_VIEW_CSS = `        /* Shared scale geometry with current/min/max labels resolved by JS. */
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
          /* JS supplies center pixels: current stays fixed on its marker; only min/max
             drift for collisions. Ellipsis engages only with an explicit max-width. */
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Lift only colliding historical labels; fixed row height preserves bar geometry. */
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
          /* Lifted short labels may paint glyph ink beyond their tight line box; allow
             free paint without changing position, row height or bar geometry. */
          overflow: visible;
          text-overflow: clip;
        }

`;
