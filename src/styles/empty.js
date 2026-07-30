// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The empty state.

export const EMPTY_CSS = `        .rtc-empty {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .rtc-empty-icon {
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

        .rtc-empty-icon ha-icon {
          width: 22px;
          height: 22px;
          color: var(--secondary-text-color);
        }

        .rtc-empty-copy {
          min-width: 0;
        }

        .rtc-empty-title {
          font-size: 21px;
          font-weight: 900;
          color: var(--primary-text-color);
          line-height: 1.05;
        }

        .rtc-empty-subtitle {
          margin-top: 4px;
          font-size: 12px;
          color: var(--secondary-text-color);
          line-height: 1.3;
        }

`;
