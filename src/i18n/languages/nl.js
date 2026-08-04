// Dutch UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const nl = {
  "title.temperature": "Temperatuur",
  "title.humidity": "Luchtvochtigheid",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Zeer heet",
  "level.hot": "Heet",
  "level.veryWarm": "Erg warm",
  "level.warm": "Warm",
  "level.slightlyWarm": "Licht warm",
  "level.optimal": "Optimaal",
  "level.slightlyCool": "Licht koel",
  "level.fresh": "Fris",
  "level.cool": "Koel",
  "level.cold": "Koud",
  "level.veryCold": "Zeer koud",

  "level.criticallyHumid": "Extreem vochtig",
  "level.tooHumid": "Te vochtig",
  "level.veryHumid": "Zeer vochtig",
  "level.humid": "Vochtig",
  "level.slightlyHumid": "Licht vochtig",
  "level.slightlyDry": "Licht droog",
  "level.dry": "Droog",
  "level.veryDry": "Zeer droog",
  "level.tooDry": "Te droog",
  "level.criticallyDry": "Extreem droog",

  "level.critical": "Kritiek",
  "level.veryHigh": "Zeer hoog",
  "level.high": "Hoog",
  "level.elevated": "Matig verhoogd",
  "level.slightlyElevated": "Licht verhoogd",
  "level.invalidReading": "Ongeldig",

  // Predicative fragment ("2/4 kamers warm"); Dutch adjectives here stay
  // invariant regardless of count, unlike the FR/IT feminine-plural
  // forms below (see the note there).
  "adjective.warm": "warm",
  "adjective.cool": "koel",
  "adjective.humid": "vochtig",
  "adjective.dry": "droog",
  "adjective.elevated": "verhoogd",
  "adjective.low": "laag",

  "value.homeAverage": "Ø Woning",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · berekend uit kamerwaarden`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · berekend uit kamerwaarden`,
  "value.ariaOpen": "Gemiddelde openen",
  "status.noData": "Geen gegevens",
  "availability.entityMissing": (v) => `Entiteit ${v.entity} niet gevonden.`,
  "availability.entitiesMissing": (v) => `${v.count} geconfigureerde ruimte-entiteit${v.count === 1 ? " is" : "en zijn"} niet gevonden: ${v.entities}.`,
  "availability.valueUnavailable": "De waarde is momenteel niet beschikbaar.",
  "availability.noUsableRooms": "Geen geconfigureerde ruimtewaarde is momenteel bruikbaar.",
  "availability.incompatible": "Geconfigureerde bronnen gebruiken incompatibele meettypen of eenheden.",
  "availability.roomNoData": (v) => `${v.name}: geen gegevens. Details openen.`,
  "availability.valueNoData": (v) => `${v.label}: geen gegevens`,

  "subtitle.aboveComfort": (v) => `Ø ${v.diff} boven comfort · ${v.count}/${v.total} ${v.total === 1 ? "kamer" : "kamers"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} boven comfort.`,
  "subtitle.belowComfort": (v) => `Ø ${v.diff} onder comfort · ${v.count}/${v.total} ${v.total === 1 ? "kamer" : "kamers"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} onder comfort.`,
  "subtitle.inComfortIssue": (v) => `Ø in comfort · ${v.name} valt het meest op.`,
  "subtitle.inComfortAllGood": "Ø in comfort · alle kamers liggen binnen het streefbereik.",
  "subtitle.inComfort": "Ø in comfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} geconfigureerde ${v.count === 1 ? "kamer is" : "kamers zijn"} niet gevonden.`,

  "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Spreiding ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "stijgend",
  "trend.direction.stable": "stabiel",
  "trend.direction.falling": "dalend",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} comfort`,
  "scale.comfortLabelShort": (v) => `${v.range} comfort`,
  "scale.optimalLabel": (v) => `${v.range} optimaal`,
  "scale.optimalLabelShort": (v) => `${v.range} optimaal`,

  "rangeScale.currentLabel": "nu",
  "rangeScale.currentLabelShort": "nu",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Dagbereik ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Dagbereik ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Koudste kamer",
  "card.warmestRoom": "Warmste kamer",
  "card.driestRoom": "Droogste kamer",
  "card.mostHumidRoom": "Vochtigste kamer",
  "card.lowestRoom": "Laagste kamer",
  "card.highestRoom": "Hoogste kamer",
  "card.dailyMinimum": "Dagminimum",
  "card.dailyMaximum": "Dagmaximum",
  "card.ariaOpen": (v) => `${v.label} openen: ${v.name}`,

  "room.ariaOpen": (v) => `${v.name} openen`,

  "rotator.hint": "Swipe om tussen weergaven te wisselen",

  "views.none": "Geen weergave beschikbaar.",

};
