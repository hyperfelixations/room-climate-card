// SHIPPED STYLESHEET SLICE: average button/value/unit/trend states.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

import { px } from "./css-units.js";

export function averageCss({ panel }) {
  return `        /* appearance:none removes widget styling, not engine-specific UA padding. */
        button {
          appearance: none;
          -webkit-appearance: none;
          font: inherit;
          color: inherit;
          border: 0;
          margin: 0;
          padding: 0;
          text-align: left;
        }

        /* Entity-button and consensus-div headlines share this engine-independent box. */
        .rtc-avg-button {
          position: relative;
          display: block;
          width: 100%;
          min-width: 0;
          padding: ${px(1, panel)} ${px(6, panel)};
          border-radius: ${px(13, panel)};
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

        /* contain:inline-size prevents a long caption's intrinsic width from widening
           its column; overflow then clips only the paint. */
        .rtc-avg-label {
          contain: inline-size;
          display: block;
          font-size: ${px(10, panel)};
          font-weight: 850;
          letter-spacing: .075em;
          text-transform: uppercase;
          color: var(--rtc-faint);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Ellipsis is the backstop after the value column reaches the view's floor. */
        .rtc-avg-value {
          display: block;
          margin-top: ${px(4, panel)};
          font-size: ${px(33, panel)};
          font-weight: 950;
          line-height: .95;
          color: var(--primary-text-color);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-avg-unit-wrap {
          display: inline-block;
        }

        .rtc-avg-unit-gap {
          font-size: ${px(14, panel)};
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
          font-size: ${px(14, panel)};
          font-weight: 750;
          line-height: 1;
          color: var(--rtc-faint);
        }

        .rtc-avg-trend-arrow {
          display: block;
          align-self: end;
          width: ${px(10, panel)};
          height: ${px(10, panel)};
          color: var(--rtc-muted);
          transform: translateY(${px(-1, panel)});
        }

        .rtc-avg-trend-arrow-svg {
          display: block;
          width: ${px(10, panel)};
          height: ${px(10, panel)};
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
}
