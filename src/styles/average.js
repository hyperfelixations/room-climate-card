// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The average: its button and disabled shapes, the value, the unit and the trend arrow.

export const AVERAGE_CSS = `        button {
          appearance: none;
          -webkit-appearance: none;
          font: inherit;
          color: inherit;
          border: 0;
          margin: 0;
          text-align: left;
        }

        .rtc-avg-button {
          position: relative;
          display: block;
          width: 100%;
          min-width: 0;
          border-radius: 13px;
          cursor: pointer;
          background: transparent;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-avg-button-disabled {
          cursor: default;
        }

        .rtc-avg-button:focus-visible,
        .rtc-room-chip:focus-visible,
        .rtc-extreme-card:focus-visible {
          outline: 2px solid var(--tone-color);
          outline-offset: 2px;
        }

        .rtc-avg-label {
          display: block;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: .075em;
          text-transform: uppercase;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        .rtc-avg-value {
          display: block;
          margin-top: 4px;
          font-size: 33px;
          font-weight: 950;
          line-height: .95;
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .rtc-avg-unit-wrap {
          display: inline-block;
        }

        .rtc-avg-unit-gap {
          font-size: 14px;
        }

        .rtc-avg-unit-core {
          display: inline;
        }

        .rtc-avg-button.rtc-has-trend .rtc-avg-unit-core {
          display: inline-grid;
          grid-template-rows: minmax(0, 1fr) auto;
          justify-items: center;
          align-items: center;
          height: .95em;
          vertical-align: bottom;
        }

        .rtc-avg-value-unit {
          display: inline;
          font-size: 14px;
          font-weight: 750;
          line-height: 1;
          color: var(--rtc-faint);
        }

        .rtc-avg-trend-arrow {
          display: block;
          align-self: end;
          width: 10px;
          height: 10px;
          color: var(--rtc-muted);
          transform: translateY(-1px);
        }

        .rtc-avg-trend-arrow-svg {
          display: block;
          width: 10px;
          height: 10px;
          overflow: visible;
          stroke-width: 1.2;
          stroke-linecap: round;
          stroke-linejoin: round;
          transform: rotate(0deg);
          transform-origin: center;
        }

        .rtc-avg-button[data-trend-direction="stable"] .rtc-avg-trend-arrow-svg {
          transform: rotate(45deg);
        }

        .rtc-avg-button[data-trend-direction="falling"] .rtc-avg-trend-arrow-svg {
          transform: rotate(90deg);
        }

        .rtc-avg-trend-arrow[hidden] {
          display: none;
        }

        .rtc-rotator,
`;
