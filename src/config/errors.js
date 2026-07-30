// Configuration errors that name the offending path.
//
// Every rejected configuration produces a message beginning with "Invalid
// configuration: ", because Home Assistant surfaces whatever setConfig() throws
// directly in the dashboard and that prefix is what tells the user it is their
// YAML rather than a card bug. The exact wording is a user-facing contract and
// is quoted in the public README's troubleshooting section.
//
// The handful of top-level messages that read as a full sentence on their own
// ("card configuration must be an object.", "rooms must be an array.") are
// thrown at their own call site rather than through a second helper here: they
// carry no path, so a shared wrapper would only obscure where they come from.

const PREFIX = "Invalid configuration: ";

export function pathError(path, message) {
  throw new Error(`${PREFIX}${path} ${message}.`);
}
