// SHIPPED STYLESHEET SLICE: daily-range and extreme-value metric cards.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

import { px } from "./css-units.js";

export function cardsCss({ panel }) {
  return `        .rtc-range-view {
          height: var(--rtc-view-height);
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: ${px(8, panel)};
          padding: 0 ${px(1, panel)};
        }

        .rtc-extreme-card {
          position: relative;
          min-width: 0;
          height: var(--rtc-view-height);
          box-sizing: border-box;
          border-radius: ${px(14, panel)};
          padding: ${px(8, panel)} ${px(9, panel)} ${px(7, panel)};
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr;
          grid-template-rows: auto auto 1fr;
          column-gap: 0;
          row-gap: ${px(1, panel)};
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
          height: ${px(2, panel)};
          background: linear-gradient(90deg, var(--extreme-color), transparent);
          box-shadow: 0 0 ${px(10, panel)} var(--extreme-line-shadow);
          opacity: .98;
        }

        .rtc-extreme-label {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          font-size: ${px(10, panel)};
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
          font-size: ${px(13, panel)};
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
          font-size: ${px(25, panel)};
          font-weight: 950;
          line-height: .88;
          color: var(--extreme-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          letter-spacing: -.02em;
          min-width: 0;
        }

        .rtc-extreme-value-unit {
          font-size: ${px(10, panel)};
          font-weight: 850;
          letter-spacing: 0;
        }

`;
}
