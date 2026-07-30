// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The room chip grid: rows, chips, labels, marks and values.

export const ROOMS_CSS = `        .rtc-room-grid {
          /* One .rtc-room-row per row (see _roomGridRows()) — a plain flex
             column, since native CSS grid can't vary column count per row
             within a single grid. gap here is the vertical row gap. */
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .rtc-room-row {
          display: grid;
          /* grid-template-columns is set inline (repeat(rowSize, ...)) to match that row's chip count. */
          gap: 6px;
        }

        .rtc-room-chip {
          min-width: 0;
          border-radius: 13px;
          padding: 7px 7px 8px;
          background: var(--room-bg);
          border: 1px solid var(--room-border);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }

        .rtc-room-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          min-width: 0;
        }

        .rtc-room-short {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .04em;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* Guarantees full visibility for an exactly-two-uppercase-letter
           label (see TWO_UPPER_LETTER_RE / validRooms.shortGuaranteed) --
           overflow:visible alone would not be enough, since .rtc-room-chip
           itself clips at narrow widths (see the 460px/600px breakpoints
           below) and .rtc-room-short competes for space in .rtc-room-top
           with the fixed 15px .rtc-room-mark and its 4px gap. Presence-only
           attribute selector: _patchRoomChip() sets/clears this via
           toggleAttribute(), which does not guarantee the "true" value. */
        .rtc-room-short[data-short-guaranteed] {
          flex: 0 0 auto;
          min-width: max-content;
          overflow: visible;
          text-overflow: clip;
        }

        .rtc-room-mark {
          flex: 0 0 15px;
          width: 15px;
          height: 15px;
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
          gap: 1px;
          margin-top: 5px;
          font-size: 17px;
          font-weight: 920;
          line-height: 1;
          color: var(--primary-text-color);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .rtc-room-value-unit {
          flex: 0 0 auto;
          font-size: 10px;
          font-weight: 750;
          color: var(--rtc-faint);
        }

`;
