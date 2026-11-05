// SHIPPED STYLESHEET SLICE: room rows, chips, labels, marks and values.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.
// The lengths the automatic column count is derived from come from room-chip-metrics.js.

import { ROOM_CHIP_REGIMES, ROOM_CHIP_SHAPE } from "../presentation/view-model/room-chip-metrics.js";
import { em, px } from "./css-units.js";

const { wide } = ROOM_CHIP_REGIMES;

export const ROOMS_CSS = `        .rtc-room-grid {
          /* Flex stacks per-row grids because native grid cannot vary column count by row. */
          display: flex;
          flex-direction: column;
          gap: ${px(wide.gridGap)};
        }

        .rtc-room-row {
          display: grid;
          /* grid-template-columns is set inline (repeat(rowSize, ...)) to match that row's chip count. */
          gap: ${px(wide.gridGap)};
        }

        .rtc-room-chip {
          min-width: 0;
          border-radius: 13px;
          padding: 7px ${px(wide.chipPaddingX)} 8px;
          background: var(--room-bg);
          border: ${px(ROOM_CHIP_SHAPE.border)} solid var(--room-border);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-room-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: ${px(ROOM_CHIP_SHAPE.labelGap)};
          min-width: 0;
        }

        .rtc-room-short {
          font-size: ${px(wide.labelFont)};
          font-weight: 900;
          letter-spacing: ${em(ROOM_CHIP_SHAPE.labelLetterSpacing)};
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* Reserve full width for validated two-uppercase-letter labels beside the fixed mark.
           Presence-only selector matches toggleAttribute() semantics. */
        .rtc-room-short[data-short-guaranteed] {
          flex: 0 0 auto;
          min-width: max-content;
          overflow: visible;
          text-overflow: clip;
        }

        .rtc-room-mark {
          flex: 0 0 ${px(ROOM_CHIP_SHAPE.mark)};
          width: ${px(ROOM_CHIP_SHAPE.mark)};
          height: ${px(ROOM_CHIP_SHAPE.mark)};
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 900;
          line-height: 1;
          color: var(--room-color);
          background: var(--room-mark-bg);
        }

        .rtc-room-value {
          display: flex;
          align-items: baseline;
          gap: ${px(wide.valueGap)};
          margin-top: 5px;
          font-size: ${px(wide.valueFont)};
          font-weight: 920;
          line-height: 1;
          color: var(--primary-text-color);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .rtc-room-value-unit {
          flex: 0 0 auto;
          font-size: ${px(wide.unitFont)};
          font-weight: 750;
          color: var(--rtc-faint);
        }

`;
