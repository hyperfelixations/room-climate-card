// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The container queries, plus the width-based fallback for browsers without container support.

export const RESPONSIVE_CSS = `        @container rtc-card (max-width: 460px) {
          .rtc-root { padding: 14px; }
          .rtc-main-panel { grid-template-columns: minmax(82px, 96px) minmax(0, 1fr); }
          .rtc-avg-value { font-size: 29px; }
          .rtc-room-grid { gap: 5px; }
          .rtc-room-row { gap: 5px; }
          .rtc-room-chip {
            padding-left: 5px;
            padding-right: 5px;
            overflow: hidden;
          }
          .rtc-room-value {
            font-size: 14px;
            gap: 0;
            letter-spacing: 0;
            min-width: 0;
          }
          .rtc-room-value-unit {
            font-size: 7.5px;
            line-height: 1;
            transform: translateY(-1px);
          }
          .rtc-room-short { font-size: 10px; }
          .rtc-extremes-view,
          .rtc-range-view { gap: 6px; }
          .rtc-extreme-card {
            height: 70px;
            padding: 8px 7px 7px;
          }
          .rtc-extreme-label {
            grid-column: 1;
            grid-row: 1;
            font-size: 9.5px;
            white-space: nowrap;
          }
          .rtc-extreme-name {
            font-size: 12.5px;
          }
          .rtc-extreme-value {
            font-size: 22px;
          }
          .rtc-extreme-value-unit { font-size: 9px; }
        }

        @container rtc-card (max-width: 360px) {
          .rtc-main-panel {
            grid-template-columns: minmax(78px, 90px) minmax(0, 1fr);
          }
          .rtc-rotator,
          .rtc-rotator-solo,
          .rtc-track,
          .rtc-scale-view,
          .rtc-range-scale-view,
          .rtc-extremes-view,
          .rtc-range-view {
            height: 74px;
          }
          .rtc-extreme-card {
            height: 74px;
            padding-left: 6px;
            padding-right: 6px;
          }
          .rtc-extreme-label {
            font-size: 9px;
          }
          .rtc-extreme-name {
            font-size: 12px;
          }
          .rtc-extreme-value {
            font-size: 21px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (max-width: 600px) {
            .rtc-root { padding: 14px; }
            .rtc-main-panel { grid-template-columns: minmax(82px, 96px) minmax(0, 1fr); }
            .rtc-avg-value { font-size: 29px; }
            .rtc-room-grid { gap: 5px; }
            .rtc-room-row { gap: 5px; }
            .rtc-room-chip {
              padding-left: 5px;
              padding-right: 5px;
              overflow: hidden;
            }
            .rtc-room-value {
              font-size: 14px;
              gap: 0;
              letter-spacing: 0;
              min-width: 0;
            }
            .rtc-room-value-unit {
              font-size: 7.5px;
              line-height: 1;
              transform: translateY(-1px);
            }
            .rtc-room-short { font-size: 10px; }
            .rtc-extremes-view,
            .rtc-range-view { gap: 6px; }
            .rtc-extreme-card {
              height: 70px;
              padding: 8px 7px 7px;
            }
            .rtc-extreme-label {
              font-size: 9.5px;
              white-space: nowrap;
            }
            .rtc-extreme-name {
              font-size: 12.5px;
            }
            .rtc-extreme-value {
              font-size: 22px;
            }
            .rtc-extreme-value-unit { font-size: 9px; }
          }

          @media (max-width: 380px) {
            .rtc-main-panel {
              grid-template-columns: minmax(78px, 90px) minmax(0, 1fr);
            }
            .rtc-rotator,
            .rtc-rotator-solo,
            .rtc-track,
            .rtc-scale-view,
            .rtc-range-scale-view,
            .rtc-extremes-view,
            .rtc-range-view {
              height: 74px;
            }
            .rtc-extreme-card {
              height: 74px;
              padding-left: 6px;
              padding-right: 6px;
            }
            .rtc-extreme-label {
              font-size: 9px;
            }
            .rtc-extreme-name {
              font-size: 12px;
            }
            .rtc-extreme-value {
              font-size: 21px;
            }
          }
        }

`;
