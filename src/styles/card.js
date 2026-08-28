// PART OF THE SHIPPED STYLESHEET.
//
// Every byte below — including the indentation, the blank lines and the comments —
// reaches the browser verbatim and is pinned by test/baseline/styles/full.css. This
// file is a contiguous slice of one stylesheet, not a self-contained block: the
// sections are concatenated in the order styles/index.js lists them, and reordering,
// reindenting or reformatting any of them changes the shipped CSS.

// The card surface, its content root and the accent line across the top.

export const CARD_CSS = `        .rtc-card {
          container: rtc-card / inline-size;
          border-radius: var(--rtc-radius);
          padding: 0;
          overflow: hidden;
          background: linear-gradient(135deg, var(--rtc-top-overlay), transparent), var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--rtc-card-border);
          box-shadow: var(--ha-card-box-shadow, 0 8px 26px rgba(0,0,0,0.18));
        }

        .rtc-root {
          position: relative;
          padding: 15px 16px 16px;
          display: grid;
          gap: 11px;
        }

        /* What is left when the show: block has hidden every part. An empty card looks
           broken; this says which switches produced it, in the same centred, muted voice
           the card uses for its other "nothing here" line (.rtc-no-views). */
        .rtc-nothing-shown {
          text-align: center;
          padding: 6px 0;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
          color: var(--secondary-text-color);
        }

        .rtc-top-line {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 3px;
          background: linear-gradient(90deg, var(--tone-color), transparent);
        }

`;
