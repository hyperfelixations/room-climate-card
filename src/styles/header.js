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
          color: var(--tone-ink);
        }

        /* A header that is missing a part needs the column it is missing to be missing too.
           A grid column holding nothing is still a column: it brings its 11px gap, and the
           title would start 11px from the left edge instead of at it.

           One override per subset, and none for the full set — the ordinary card carries no
           data-parts attribute at all and therefore meets none of these rules. The pill is
           pushed to the right edge only where it lands in a stretching track; where it sits
           in a content-sized track at the end of the row it is already there. */
        .rtc-root[data-parts="icon title"] .rtc-header {
          grid-template-columns: auto 1fr;
        }

        .rtc-root[data-parts="icon pill"] .rtc-header {
          grid-template-columns: auto 1fr;
        }

        .rtc-root[data-parts="title pill"] .rtc-header {
          grid-template-columns: 1fr auto;
        }

        .rtc-root[data-parts="icon"] .rtc-header {
          grid-template-columns: auto;
        }

        .rtc-root[data-parts="title"] .rtc-header {
          grid-template-columns: 1fr;
        }

        .rtc-root[data-parts="pill"] .rtc-header {
          grid-template-columns: 1fr;
        }

        .rtc-root[data-parts="icon pill"] .rtc-status-pill,
        .rtc-root[data-parts="pill"] .rtc-status-pill {
          justify-self: end;
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

        /* title: clip — the mirror image of the subtitle's override below. The title wraps
           by default and the subtitle clips by default, so each rule states the departure
           from its own line's habit and neither touches the ordinary card. */
        .rtc-root[data-title="clip"] .rtc-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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

        /* subtitle: wrap — the line runs onto as many lines as it needs and the card
           grows under it. Written as an override rather than as two variants of the rule
           above, so the default is literally unchanged.

           overflow-wrap: anywhere is not decoration: the no-data explanations name entity
           ids, and an id is one unbreakable token that would otherwise run out of the
           card sideways instead of wrapping. */
        .rtc-root[data-subtitle="wrap"] .rtc-subtitle {
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          overflow-wrap: anywhere;
        }

        .rtc-status-pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          color: var(--tone-ink);
          background: var(--tone-soft);
          border: 1px solid var(--tone-border);
        }

        /* The two columns negotiate their own widths. The first is the headline value,
           the second the view beside it.

           minmax(<floor>, auto) means "as wide as the value needs, never narrower than
           <floor>". The floor is the width this column used to be capped at, so every
           reading that fits today produces exactly the column it produces today and the
           view keeps every pixel it has. Only a value that would have painted across the
           view — four-digit CO2, three-digit PM2.5, a negative two-digit temperature —
           makes the column grow, and only by what it is short.

           minmax(40%, 1fr) is the other side of that bargain: the view yields width, but
           never falls below 40% of the panel. Without that one implausible reading could
           take the view away altogether. The rotator carries min-width:0, so in the rare
           container that has no definite width of its own the percentage resolves to zero
           and the pair behaves exactly as it did before. */
        .rtc-main-panel {
          display: grid;
          grid-template-columns: minmax(106px, auto) minmax(40%, 1fr);
          gap: 8px;
          align-items: center;
          border-radius: 17px;
          padding: 9px 10px;
          background: var(--rtc-panel);
          border: 1px solid var(--rtc-hairline);
        }

`;
