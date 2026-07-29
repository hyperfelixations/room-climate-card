// Norwegian Bokmål UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const nb = {
  "title.temperature": "Temperatur",
  "title.humidity": "Luftfuktighet",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Svært hett",
  "level.hot": "Hett",
  "level.veryWarm": "Svært varmt",
  "level.warm": "Varmt",
  "level.slightlyWarm": "Lett varmt",
  "level.optimal": "Optimalt",
  "level.slightlyCool": "Lett kjølig",
  "level.fresh": "Friskt",
  "level.cool": "Kjølig",
  "level.cold": "Kaldt",
  "level.veryCold": "Svært kaldt",

  "level.criticallyHumid": "Kritisk fuktig",
  "level.tooHumid": "For fuktig",
  "level.veryHumid": "Svært fuktig",
  "level.humid": "Fuktig",
  "level.slightlyHumid": "Lett fuktig",
  "level.slightlyDry": "Lett tørt",
  "level.dry": "Tørt",
  "level.veryDry": "Svært tørt",
  "level.tooDry": "For tørt",
  "level.criticallyDry": "Kritisk tørt",

  "level.critical": "Kritisk",
  "level.veryHigh": "Svært høyt",
  "level.high": "Høyt",
  "level.elevated": "Forhøyet",
  "level.slightlyElevated": "Lett forhøyet",
  "level.invalidReading": "Ugyldig",

  // Predicative fragment ("2/4 rom er varme"); Norwegian predicative
  // adjectives DO inflect for number (unlike German/English/Dutch) — these
  // are the plural forms, the only ones this key is ever used with
  // (subtitle.*Comfort's rooms branch is only reachable once hasRoomsView
  // requires >= 2 rooms, see _computeData()). Note "rom" itself is
  // plural-invariant ("et rom" / "flere rom"), unlike English
  // "room"/"rooms" — see the ternaries below, which are correctly
  // same-value-both-branches for the noun, not a bug.
  "adjective.warm": "varme",
  "adjective.cool": "kjølige",
  "adjective.humid": "fuktige",
  "adjective.dry": "tørre",
  "adjective.elevated": "forhøyede",
  "adjective.low": "lave",

  "avg.label": "Ø bolig",
  "avg.tooltip": (v) => `${v.label}: ${v.value}`,
  "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · beregnet ut fra romverdier`,
  "avg.ariaOpen": "Åpne gjennomsnitt",

  "subtitle.aboveComfort": (v) => `Ø ${v.diff} over komfort · ${v.count}/${v.total} ${v.total === 1 ? "rom" : "rom"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} over komfort.`,
  "subtitle.belowComfort": (v) => `Ø ${v.diff} under komfort · ${v.count}/${v.total} ${v.total === 1 ? "rom" : "rom"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} under komfort.`,
  "subtitle.inComfortIssue": (v) => `Ø innenfor komfort · ${v.name} skiller seg mest ut.`,
  "subtitle.inComfortAllGood": "Ø innenfor komfort · alle rom er innenfor målområdet.",
  "subtitle.inComfort": "Ø innenfor komfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} rom uten data.`,

  "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Spredning ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "stigende",
  "trend.direction.stable": "stabil",
  "trend.direction.falling": "fallende",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} komfort`,
  "scale.comfortLabelShort": (v) => `${v.range} komfort`,
  "scale.optimalLabel": (v) => `${v.range} optimalt`,
  "scale.optimalLabelShort": (v) => `${v.range} optimalt`,

  "rangeScale.currentLabel": "nå",
  "rangeScale.currentLabelShort": "nå",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "maks",
  "rangeScale.footer": (v) => `Dagens spenn ${v.span} · Min ${v.min} (${v.minTime}) · Maks ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Dagens spenn ${v.span} · Min ${v.min} · Maks ${v.max}`,

  "card.coldestRoom": "Kaldeste rommet",
  "card.warmestRoom": "Varmeste rommet",
  "card.driestRoom": "Tørreste rommet",
  "card.mostHumidRoom": "Fuktigste rommet",
  "card.lowestRoom": "Laveste rommet",
  "card.highestRoom": "Høyeste rommet",
  "card.dailyMinimum": "Dagens minimum",
  "card.dailyMaximum": "Dagens maksimum",
  "card.ariaOpen": (v) => `Åpne ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Åpne ${v.name}`,

  "rotator.hint": "Sveip for å bytte mellom visninger",

  "views.none": "Ingen visning tilgjengelig.",

  "empty.title": "Ingen data tilgjengelig.",
  "empty.hintNoRooms": "Den konfigurerte gjennomsnittsenheten rapporterer ikke et tall.",
  "empty.hintMissingRooms": (v) => `${v.count} konfigurert${v.count === 1 ? "" : "e"} enhet${v.count === 1 ? "" : "er"} mangler eller rapporterer ikke et tall.`,
  "empty.hintNoRoomData": "Ingen konfigurert rom-enhet rapporterer et tall.",
};
