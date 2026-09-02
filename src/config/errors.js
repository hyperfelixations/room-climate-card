// Configuration errors that name the offending path. Every rejected configuration
// throws a message starting with "Invalid configuration: " — Home Assistant shows it
// verbatim in the dashboard, so the wording is a user-facing contract (quoted in the
// README troubleshooting section). Path-less full-sentence messages are thrown at
// their own call site instead.

const PREFIX = "Invalid configuration: ";

export function pathError(path, message) {
  throw new Error(`${PREFIX}${path} ${message}.`);
}
