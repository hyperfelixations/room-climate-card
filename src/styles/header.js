// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The header row: icon badge, title block, status pill — and the main panel it sits above.

export const HEADER_CSS = `        .rtc-header {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 11px;
          align-items: center;
          min-width: 0;
        }

        .rtc-icon-badge {
          width: 39px;
          height: 39px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-icon-badge ha-icon {
          width: 22px;
          height: 22px;
          color: var(--tone-color);
        }

        .rtc-title-block {
          min-width: 0;
        }

        .rtc-title {
          font-size: 21px;
          font-weight: 920;
          line-height: 1.05;
          color: var(--primary-text-color);
        }

        .rtc-subtitle {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 650;
          line-height: 1.25;
          color: var(--rtc-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .rtc-status-pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          color: var(--tone-color);
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        .rtc-main-panel {
          display: grid;
          grid-template-columns: minmax(94px, 106px) minmax(0, 1fr);
          gap: 8px;
          align-items: center;
          border-radius: 17px;
          padding: 9px 10px;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

`;
