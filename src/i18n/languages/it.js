// Italian UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const it = {
  "title.temperature": "Temperatura",
  "title.humidity": "Umidità",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Molto caldo",
  "level.hot": "Caldo",
  "level.veryWarm": "Piuttosto caldo",
  "level.warm": "Tiepido",
  "level.slightlyWarm": "Leggermente tiepido",
  "level.optimal": "Ottimale",
  "level.slightlyCool": "Leggermente fresco",
  "level.fresh": "Fresco",
  "level.cool": "Piuttosto fresco",
  "level.cold": "Freddo",
  "level.veryCold": "Molto freddo",

  "level.criticallyHumid": "Estremamente umido",
  "level.tooHumid": "Troppo umido",
  "level.veryHumid": "Molto umido",
  "level.humid": "Umido",
  "level.slightlyHumid": "Leggermente umido",
  "level.slightlyDry": "Leggermente secco",
  "level.dry": "Secco",
  "level.veryDry": "Molto secco",
  "level.tooDry": "Troppo secco",
  "level.criticallyDry": "Estremamente secco",

  "level.critical": "Critico",
  "level.veryHigh": "Molto alto",
  "level.high": "Alto",
  "level.elevated": "Moderatamente alto",
  "level.slightlyElevated": "Leggermente alto",
  "level.invalidReading": "Non valido",

  // Predicative fragment ("2/4 stanze calde"); "stanza"/"stanze" is
  // feminine, so these are feminine-plural forms — the only form this
  // key is actually used with (subtitle.*Comfort's rooms branch is only
  // reachable once rooms.comparable requires >= 2 rooms, see buildCardDomainModel()).
  "adjective.warm": "calde",
  "adjective.cool": "fresche",
  "adjective.humid": "umide",
  "adjective.dry": "secche",
  "adjective.elevated": "alte",
  "adjective.low": "basse",

  "value.homeAverage": "Media casa",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · calcolato dai valori delle stanze`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · calcolato dai valori delle stanze`,
  "value.ariaOpen": "Apri la media",
  "status.noData": "Nessun dato",
  "availability.entityMissing": (v) => `Entità ${v.entity} non trovata.`,
  "availability.entitiesMissing": (v) => `${v.count} ${v.count === 1 ? "entità stanza configurata non è stata trovata" : "entità stanza configurate non sono state trovate"}: ${v.entities}.`,
  "availability.valueUnavailable": "Il valore non è attualmente disponibile.",
  "availability.noUsableRooms": "Nessun valore stanza configurato è attualmente utilizzabile.",
  "availability.incompatible": "Le sorgenti configurate usano tipi di misura o unità incompatibili.",
  "availability.roomNoData": (v) => `${v.name}: nessun dato. Apri i dettagli.`,
  "availability.valueNoData": (v) => `${v.label}: nessun dato`,

  "subtitle.aboveComfort": (v) => `Media ${v.diff} sopra il comfort · ${v.count}/${v.total} ${v.total === 1 ? "stanza" : "stanze"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Media ${v.diff} sopra il comfort.`,
  "subtitle.belowComfort": (v) => `Media ${v.diff} sotto il comfort · ${v.count}/${v.total} ${v.total === 1 ? "stanza" : "stanze"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Media ${v.diff} sotto il comfort.`,
  "subtitle.inComfortIssue": (v) => `Media nel comfort · ${v.name} spicca maggiormente.`,
  "subtitle.inComfortAllGood": "Media nel comfort · tutte le stanze rientrano nell'intervallo obiettivo.",
  "subtitle.inComfort": "Media nel comfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "stanza" : "stanze"} senza dati.`,

  "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Scarto ${v.value}`,
  "footer.trend": (v) => `Tendenza ${v.value}`,
  "trend.direction.rising": "in aumento",
  "trend.direction.stable": "stabile",
  "trend.direction.falling": "in calo",
  "trend.aria": (v) => `Tendenza ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} comfort`,
  "scale.comfortLabelShort": (v) => `${v.range} comfort`,
  "scale.optimalLabel": (v) => `${v.range} ottimale`,
  "scale.optimalLabelShort": (v) => `${v.range} ottimale`,

  "rangeScale.currentLabel": "ora",
  "rangeScale.currentLabelShort": "ora",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Intervallo di oggi ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Intervallo di oggi ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Stanza più fredda",
  "card.warmestRoom": "Stanza più calda",
  "card.driestRoom": "Stanza più secca",
  "card.mostHumidRoom": "Stanza più umida",
  "card.lowestRoom": "Stanza più bassa",
  "card.highestRoom": "Stanza più alta",
  "card.dailyMinimum": "Minimo giornaliero",
  "card.dailyMaximum": "Massimo giornaliero",
  "card.ariaOpen": (v) => `Apri ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Apri ${v.name}`,

  "rotator.hint": "Scorri per cambiare vista",

  "views.none": "Nessuna vista disponibile.",

};
