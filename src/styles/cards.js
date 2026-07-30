// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The metric cards used by the daily-range and extreme-value views.

export const CARDS_CSS = `        .rtc-range-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          padding: 0 1px;
        }

        .rtc-extreme-card {
          position: relative;
          min-width: 0;
          height: 70px;
          box-sizing: border-box;
          border-radius: 14px;
          padding: 8px 9px 7px;
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto 1fr;
          column-gap: 0;
          row-gap: 1px;
          background: linear-gradient(135deg, var(--extreme-bg), transparent 72%);
          border: 1px solid var(--extreme-border);
          box-shadow: inset 0 1px 0 color-mix(in srgb, var(--extreme-color) 16%, transparent);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-extreme-line {
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, var(--extreme-color), transparent);
          box-shadow: 0 0 10px var(--extreme-line-shadow);
          opacity: .98;
        }

        .rtc-extreme-label {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0;
          color: var(--extreme-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.05;
          opacity: .94;
        }

        .rtc-extreme-name {
          grid-column: 1;
          grid-row: 2;
          align-self: start;
          min-width: 0;
          max-width: 100%;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.05;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-extreme-value {
          grid-column: 1;
          grid-row: 3;
          align-self: end;
          justify-self: end;
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          font-size: 25px;
          font-weight: 950;
          line-height: .88;
          color: var(--extreme-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          letter-spacing: -.02em;
          min-width: 0;
        }

        .rtc-extreme-value-unit {
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0;
        }

`;
