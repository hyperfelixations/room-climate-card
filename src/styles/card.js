// SHIPPED STYLESHEET SLICE: card surface, content root and top accent.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.
// The surface is selected by type, so an `ha-card` rule a frontend module such as card-mod
// appends after this sheet wins at equal specificity. The card border and the horizontal
// padding come from room-chip-metrics.js; room-chip-fit.js derives the automatic chip columns
// from them.

import { CARD_BORDER_PX, ROOM_CHIP_REGIMES, roomChipLengths } from "../presentation/view-model/room-chip-metrics.js";
import { px } from "./css-units.js";

export function cardCss(size) {
  const { shell } = size;
  const wide = roomChipLengths(ROOM_CHIP_REGIMES.wide, size);
  return `        ha-card {
          container: rtc-card / inline-size;
          border-radius: var(--rtc-radius);
          padding: 0;
          overflow: hidden;
          background: linear-gradient(135deg, var(--rtc-top-overlay), transparent), var(--ha-card-background, var(--card-background-color));
          border: ${px(CARD_BORDER_PX)} solid var(--rtc-card-border);
          box-shadow: var(--ha-card-box-shadow, 0 ${px(8, shell)} ${px(26, shell)} rgba(0,0,0,0.18));
        }

        .rtc-root {
          position: relative;
          padding: ${px(15, shell)} ${px(wide.cardPaddingX)} ${px(16, shell)};
          display: grid;
          gap: ${px(11, shell)};
        }

        /* What is left when the show: block has hidden every part, and what a failed render
           shows. Each line is the card's only content, so it reads in the title colour. */
        .rtc-nothing-shown,
        .rtc-render-failed {
          text-align: center;
          padding: ${px(6, shell)} 0;
          font-size: ${px(13, shell)};
          font-weight: 700;
          line-height: 1.3;
          color: var(--primary-text-color);
        }

        .rtc-top-line {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: ${px(3, shell)};
          background: linear-gradient(90deg, var(--tone-color), transparent);
        }

        .rtc-root[data-accent-line="bottom"] .rtc-top-line {
          top: auto;
          bottom: 0;
        }

`;
}
