// Why a configuration cannot be used at all, as data: a code and its parameters, carried by the
// error setConfig() throws. Its message is the English sentence; the element words it in the
// card's language before Home Assistant shows it. The catalog is closed; every other invalid
// value is a warning (core/diagnostics.js). See internal dev doc §3 "Konfigurationsvertrag".

const MESSAGES = {
  "config.not_object": () => "the card configuration must be a YAML object.",
  "config.unknown_key": ({ key, suggestion }) => `${key} is not an option of this card.${suggestion ? ` Did you mean ${suggestion}?` : ""}`,
  "config.no_source": () => "set entity, or add at least one entry under rooms.",
  "config.must_be_entity_id": ({ key }) => `${key} must be an entity id.`,
  "config.must_be_list": ({ key }) => `${key} must be a list.`,
  "config.must_be_object": ({ key }) => `${key} must be an object.`,
  "config.duplicate_room": ({ entity }) => `${entity} is used by more than one room.`,
};

export const CONFIG_ERROR_CODES = Object.freeze(Object.keys(MESSAGES));

// `message` replaces the English sentence with the same refusal worded in another language.
export class ConfigError extends Error {
  constructor(code, params = {}, message = `Invalid configuration: ${MESSAGES[code](params)}`) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.params = params;
  }
}

// A value that one rule of a definition object refuses (a custom profile, a written-out
// palette). It never leaves config/: the option that holds the value answers with a warning and
// its default.
export class ConfigValueError extends Error {
  constructor(path, value) {
    super(`${path}: invalid value`);
    this.name = "ConfigValueError";
    this.path = path;
    this.value = value;
  }
}

export function rejectConfiguration(code, params = {}) {
  throw new ConfigError(code, params);
}

export function rejectValue(path, value) {
  throw new ConfigValueError(path, value);
}
