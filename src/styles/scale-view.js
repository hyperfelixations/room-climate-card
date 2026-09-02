// SHIPPED STYLESHEET SLICE: main scale layout and comfort label.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const SCALE_VIEW_CSS = `        .rtc-scale-view {
          height: 70px;
          box-sizing: border-box;
          display: grid;
          align-content: center;
          gap: 4px;
          padding: 0 1px;
        }

        .rtc-scale-comfort-row {
          position: relative;
          height: 12px;
          font-size: 10px;
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
