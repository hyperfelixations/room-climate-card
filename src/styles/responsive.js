// SHIPPED STYLESHEET SLICE: container queries and width-based fallback.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.
// The narrow chip lengths and the container breakpoint come from room-chip-metrics.js.

import { NARROW_CONTAINER_MAX_PX, ROOM_CHIP_REGIMES } from "../presentation/view-model/room-chip-metrics.js";
import { px } from "./css-units.js";

const { narrow } = ROOM_CHIP_REGIMES;

export const RESPONSIVE_CSS = `        @container rtc-card (max-width: ${px(NARROW_CONTAINER_MAX_PX)}) {
          .rtc-root { padding: ${px(narrow.cardPaddingX)}; }
          .rtc-main-panel { grid-template-columns: minmax(96px, auto) minmax(40%, 1fr); }
          .rtc-avg-value { font-size: 29px; }
          .rtc-room-grid { gap: ${px(narrow.gridGap)}; }
          .rtc-room-row { gap: ${px(narrow.gridGap)}; }
          .rtc-room-chip {
            padding-left: ${px(narrow.chipPaddingX)};
            padding-right: ${px(narrow.chipPaddingX)};
            overflow: hidden;
          }
          .rtc-room-value {
            font-size: ${px(narrow.valueFont)};
            gap: ${px(narrow.valueGap)};
            letter-spacing: 0;
            min-width: 0;
          }
          .rtc-room-value-unit {
            font-size: ${px(narrow.unitFont)};
            line-height: 1;
            transform: translateY(-1px);
          }
          .rtc-room-short { font-size: ${px(narrow.labelFont)}; }
          .rtc-extremes-view,
          .rtc-range-view { gap: 6px; }
          .rtc-extreme-card {
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
            grid-template-columns: minmax(90px, auto) minmax(40%, 1fr);
          }
          .rtc-root {
            --rtc-view-height: var(--rtc-view-height-narrow);
          }
          .rtc-extreme-card {
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
            .rtc-root { padding: ${px(narrow.cardPaddingX)}; }
            .rtc-main-panel { grid-template-columns: minmax(96px, auto) minmax(40%, 1fr); }
            .rtc-avg-value { font-size: 29px; }
            .rtc-room-grid { gap: ${px(narrow.gridGap)}; }
            .rtc-room-row { gap: ${px(narrow.gridGap)}; }
            .rtc-room-chip {
              padding-left: ${px(narrow.chipPaddingX)};
              padding-right: ${px(narrow.chipPaddingX)};
              overflow: hidden;
            }
            .rtc-room-value {
              font-size: ${px(narrow.valueFont)};
              gap: ${px(narrow.valueGap)};
              letter-spacing: 0;
              min-width: 0;
            }
            .rtc-room-value-unit {
              font-size: ${px(narrow.unitFont)};
              line-height: 1;
              transform: translateY(-1px);
            }
            .rtc-room-short { font-size: ${px(narrow.labelFont)}; }
            .rtc-extremes-view,
            .rtc-range-view { gap: 6px; }
            .rtc-extreme-card {
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
              grid-template-columns: minmax(90px, auto) minmax(40%, 1fr);
            }
            .rtc-root {
              --rtc-view-height: var(--rtc-view-height-narrow);
            }
            .rtc-extreme-card {
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
