// German UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const de = {
  "title.temperature": "Temperatur",
  "title.humidity": "Luftfeuchtigkeit",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Sehr heiß",
  "level.hot": "Heiß",
  "level.veryWarm": "Sehr warm",
  "level.warm": "Warm",
  "level.slightlyWarm": "Leicht warm",
  "level.optimal": "Optimal",
  "level.slightlyCool": "Leicht kühl",
  "level.fresh": "Frisch",
  "level.cool": "Kühl",
  "level.cold": "Kalt",
  "level.veryCold": "Sehr kalt",

  "level.criticallyHumid": "Kritisch feucht",
  "level.tooHumid": "Zu feucht",
  "level.veryHumid": "Sehr feucht",
  "level.humid": "Feucht",
  "level.slightlyHumid": "Leicht feucht",
  "level.slightlyDry": "Leicht trocken",
  "level.dry": "Trocken",
  "level.veryDry": "Sehr trocken",
  "level.tooDry": "Zu trocken",
  "level.criticallyDry": "Kritisch trocken",

  "level.critical": "Kritisch",
  "level.veryHigh": "Sehr hoch",
  "level.high": "Hoch",
  "level.elevated": "Erhöht",
  "level.slightlyElevated": "Leicht erhöht",
  "level.invalidReading": "Ungültig",

  "adjective.warm": "warm",
  "adjective.cool": "kühl",
  "adjective.humid": "feucht",
  "adjective.dry": "trocken",
  "adjective.elevated": "erhöht",
  "adjective.low": "niedrig",

  "value.homeAverage": "Ø Wohnung",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · aus Raumwerten berechnet`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · aus Raumwerten berechnet`,
  "value.ariaOpen": "Durchschnitt öffnen",
  "status.noData": "Keine Daten",
  "availability.entityMissing": (v) => `Entität ${v.entity} nicht gefunden.`,
  "availability.entitiesMissing": (v) => `${v.count} konfigurierte Raum-Entität${v.count === 1 ? " wurde" : "en wurden"} nicht gefunden: ${v.entities}.`,
  "availability.valueUnavailable": "Der Wert ist derzeit nicht verfügbar.",
  "availability.noUsableRooms": "Derzeit ist kein konfigurierter Raumwert nutzbar.",
  "availability.incompatible": "Konfigurierte Quellen verwenden inkompatible Messarten oder Einheiten.",
  "availability.roomNoData": (v) => `${v.name}: keine Daten. Details öffnen.`,
  "availability.valueNoData": (v) => `${v.label}: keine Daten`,

  "subtitle.aboveComfort": (v) => `Ø ${v.diff} über Komfort · ${v.count}/${v.total} ${v.total === 1 ? "Raum" : "Räume"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} über Komfort.`,
  "subtitle.belowComfort": (v) => `Ø ${v.diff} unter Komfort · ${v.count}/${v.total} ${v.total === 1 ? "Raum" : "Räume"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} unter Komfort.`,
  "subtitle.inComfortIssue": (v) => `Ø im Komfort · ${v.name} fällt am stärksten auf.`,
  "subtitle.inComfortAllGood": "Ø im Komfort · alle Räume liegen im Zielkorridor.",
  "subtitle.inComfort": "Ø im Komfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "Raum" : "Räume"} ohne Daten.`,

  "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Spanne ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "steigend",
  "trend.direction.stable": "stabil",
  "trend.direction.falling": "fallend",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} Komfort`,
  "scale.comfortLabelShort": (v) => `${v.range} Komfort`,
  "scale.optimalLabel": (v) => `${v.range} Optimal`,
  "scale.optimalLabelShort": (v) => `${v.range} Optimal`,

  "rangeScale.currentLabel": "jetzt",
  "rangeScale.currentLabelShort": "jetzt",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Tagesspanne ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Tagesspanne ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Kältester Raum",
  "card.warmestRoom": "Wärmster Raum",
  "card.driestRoom": "Trockenster Raum",
  "card.mostHumidRoom": "Feuchtester Raum",
  "card.lowestRoom": "Niedrigster Raum",
  "card.highestRoom": "Höchster Raum",
  "card.dailyMinimum": "Tagesminimum",
  "card.dailyMaximum": "Tagesmaximum",
  "card.ariaOpen": (v) => `${v.label}: ${v.name} öffnen`,

  "room.ariaOpen": (v) => `${v.name} öffnen`,

  "rotator.hint": "Wischen, um zwischen den Ansichten zu wechseln",

  "views.none": "Keine Ansicht verfügbar.",

};
