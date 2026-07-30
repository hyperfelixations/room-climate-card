// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The main scale view's own layout and its comfort pill.

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

        .rtc-scale-comfort-label {
          position: absolute;
          top: 0;
          transform: translateX(-50%);
        }

`;
