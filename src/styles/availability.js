// SHIPPED STYLESHEET SLICE: availability state for the normal card shell.
// Slice order is normative; CSS comments inside template literals are baseline-pinned bytes.

export const AVAILABILITY_CSS = `        .rtc-root[data-state="no-data"] .rtc-main-panel {
          grid-template-columns: minmax(94px, 106px);
        }

        .rtc-root[data-state="no-data"] .rtc-avg-value,
        .rtc-avg-button.rtc-unavailable .rtc-avg-value {
          color: var(--rtc-muted);
        }

        .rtc-room-chip.rtc-room-unavailable .rtc-room-value,
        .rtc-room-chip.rtc-room-unavailable .rtc-room-mark {
          color: var(--rtc-muted);
        }

`;
