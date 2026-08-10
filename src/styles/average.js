// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The average: its button and disabled shapes, the value, the unit and the trend arrow.

export const AVERAGE_CSS = `        /* padding belongs here for the same reason every other line does: appearance:none
           removes the widget look, not the UA box. Chrome gives a button 1px 6px, other
           engines give it something else, and whatever is left over ends up deciding how
           the card is spaced. Zero here, and every button states its own. */
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

        /* The headline is a <button> when the value belongs to one entity and a <div>
           when it is a consensus (see render/primitives/average.js). Both carry THIS
           class, so stating the indentation here is what makes the two shapes the same
           box — the card no longer moves when a main entity drops out and the consensus
           takes over, and it no longer depends on which engine is rendering it. */
        .rtc-avg-button {
          position: relative;
          display: block;
          width: 100%;
          min-width: 0;
          padding: 1px 6px;
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

        /* Clipped like every other single-line label on the card (see the header
           subtitle, the room-chip label and the extreme cards). The caption sits in a
           narrow column, so a long one paints straight across the view beside it. Until
           2.37.0 the text here was always a short translated constant and the overflow
           was unreachable; a single-room card now captions itself with the room's own
           name, which the user writes and which can be any length.

           contain:inline-size is what keeps that decision intact now that the column
           sizes itself to its content: overflow:hidden clips the PAINT but leaves the
           intrinsic width alone, so a long caption would otherwise drag the column open
           to its full length and take the space away from the view. The caption is
           declared not to have a say in how wide its own column is; the value does. */
        .rtc-avg-label {
          contain: inline-size;
          display: block;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: .075em;
          text-transform: uppercase;
          color: var(--rtc-faint);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* The clip is the backstop, not the mechanism: the column grows to fit this text
           (see .rtc-main-panel), so in normal use there is nothing to clip. It matters
           once the column has grown as far as the view's own floor permits — a reading
           past that point is a broken sensor, and an ellipsis on the value is a better
           answer than paint across the view beside it. */
        .rtc-avg-value {
          display: block;
          margin-top: 4px;
          font-size: 33px;
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
