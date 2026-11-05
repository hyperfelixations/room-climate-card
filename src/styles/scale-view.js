// SHIPPED STYLESHEET SLICE: main scale layout and comfort label.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

import { px } from "./css-units.js";

export function scaleViewCss({ panel }) {
  return `        .rtc-scale-view {
          height: var(--rtc-view-height);
          box-sizing: border-box;
          display: grid;
          align-content: center;
          gap: ${px(4, panel)};
          padding: 0 ${px(1, panel)};
        }

        .rtc-scale-comfort-row {
          position: relative;
          height: ${px(12, panel)};
          font-size: ${px(10, panel)};
          font-weight: 800;
          color: var(--rtc-faint);
          white-space: nowrap;
        }

        /* Measured layout replaces the initial offset and caps text only when the row
           cannot contain its natural width. */
        .rtc-scale-comfort-label {
          position: absolute;
          top: 0;
          transform: translateX(-50%);
          overflow: hidden;
          text-overflow: ellipsis;
        }

`;
}
