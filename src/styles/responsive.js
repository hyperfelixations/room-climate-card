// SHIPPED STYLESHEET SLICE: container queries and width-based fallback.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.
// The narrow chip lengths and the container breakpoint come from room-chip-metrics.js.

import { NARROW_CONTAINER_MAX_PX, ROOM_CHIP_REGIMES, roomChipLengths } from "../presentation/view-model/room-chip-metrics.js";
import { HEADLINE_FONT_PX } from "../presentation/view-model/card-size.js";
import { px } from "./css-units.js";

export function responsiveCss(size) {
  const { shell, panel, roomValue } = size;
  const narrow = roomChipLengths(ROOM_CHIP_REGIMES.narrow, size);
  return `        @container rtc-card (max-width: ${px(NARROW_CONTAINER_MAX_PX, shell)}) {
          .rtc-root { padding: ${px(narrow.cardPaddingX)}; }
          .rtc-main-panel { grid-template-columns: minmax(${px(96, panel)}, auto) minmax(40%, 1fr); }
          .rtc-avg-value { font-size: ${px(HEADLINE_FONT_PX.narrow, panel)}; }
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
            transform: translateY(${px(-1, roomValue)});
          }
          .rtc-room-short { font-size: ${px(narrow.labelFont)}; }
          .rtc-extremes-view,
          .rtc-range-view { gap: ${px(6, panel)}; }
          .rtc-extreme-card {
            padding: ${px(8, panel)} ${px(7, panel)} ${px(7, panel)};
          }
          .rtc-extreme-label {
            grid-column: 1;
            grid-row: 1;
            font-size: ${px(9.5, panel)};
            white-space: nowrap;
          }
          .rtc-extreme-name {
            font-size: ${px(12.5, panel)};
          }
          .rtc-extreme-value {
            font-size: ${px(22, panel)};
          }
          .rtc-extreme-value-unit { font-size: ${px(9, panel)}; }
        }

        @container rtc-card (max-width: ${px(360, shell)}) {
          .rtc-main-panel {
            grid-template-columns: minmax(${px(90, panel)}, auto) minmax(40%, 1fr);
          }
          .rtc-root {
            --rtc-view-height: var(--rtc-view-height-narrow);
          }
          .rtc-extreme-card {
            padding-left: ${px(6, panel)};
            padding-right: ${px(6, panel)};
          }
          .rtc-extreme-label {
            font-size: ${px(9, panel)};
          }
          .rtc-extreme-name {
            font-size: ${px(12, panel)};
          }
          .rtc-extreme-value {
            font-size: ${px(21, panel)};
          }
        }

        @supports not (container-type: inline-size) {
          @media (max-width: ${px(600, shell)}) {
            .rtc-root { padding: ${px(narrow.cardPaddingX)}; }
            .rtc-main-panel { grid-template-columns: minmax(${px(96, panel)}, auto) minmax(40%, 1fr); }
            .rtc-avg-value { font-size: ${px(HEADLINE_FONT_PX.narrow, panel)}; }
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
              transform: translateY(${px(-1, roomValue)});
            }
            .rtc-room-short { font-size: ${px(narrow.labelFont)}; }
            .rtc-extremes-view,
            .rtc-range-view { gap: ${px(6, panel)}; }
            .rtc-extreme-card {
              padding: ${px(8, panel)} ${px(7, panel)} ${px(7, panel)};
            }
            .rtc-extreme-label {
              font-size: ${px(9.5, panel)};
              white-space: nowrap;
            }
            .rtc-extreme-name {
              font-size: ${px(12.5, panel)};
            }
            .rtc-extreme-value {
              font-size: ${px(22, panel)};
            }
            .rtc-extreme-value-unit { font-size: ${px(9, panel)}; }
          }

          @media (max-width: ${px(380, shell)}) {
            .rtc-main-panel {
              grid-template-columns: minmax(${px(90, panel)}, auto) minmax(40%, 1fr);
            }
            .rtc-root {
              --rtc-view-height: var(--rtc-view-height-narrow);
            }
            .rtc-extreme-card {
              padding-left: ${px(6, panel)};
              padding-right: ${px(6, panel)};
            }
            .rtc-extreme-label {
              font-size: ${px(9, panel)};
            }
            .rtc-extreme-name {
              font-size: ${px(12, panel)};
            }
            .rtc-extreme-value {
              font-size: ${px(21, panel)};
            }
          }
        }

`;
}
