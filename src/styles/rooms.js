// SHIPPED STYLESHEET SLICE: room rows, chips, labels, marks and values.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const ROOMS_CSS = `        .rtc-room-grid {
          /* Flex stacks per-row grids because native grid cannot vary column count by row. */
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

        /* Reserve full width for validated two-uppercase-letter labels beside the fixed mark.
           Presence-only selector matches toggleAttribute() semantics. */
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
