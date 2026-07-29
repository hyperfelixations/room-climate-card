// Swedish UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const sv = {
  "title.temperature": "Temperatur",
  "title.humidity": "Luftfuktighet",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Mycket hett",
  "level.hot": "Hett",
  "level.veryWarm": "Mycket varmt",
  "level.warm": "Varmt",
  "level.slightlyWarm": "Lite varmt",
  "level.optimal": "Optimalt",
  "level.slightlyCool": "Lite svalt",
  "level.fresh": "Friskt",
  "level.cool": "Svalt",
  "level.cold": "Kallt",
  "level.veryCold": "Mycket kallt",

  "level.criticallyHumid": "Kritiskt fuktigt",
  "level.tooHumid": "För fuktigt",
  "level.veryHumid": "Mycket fuktigt",
  "level.humid": "Fuktigt",
  "level.slightlyHumid": "Lite fuktigt",
  "level.slightlyDry": "Lite torrt",
  "level.dry": "Torrt",
  "level.veryDry": "Mycket torrt",
  "level.tooDry": "För torrt",
  "level.criticallyDry": "Kritiskt torrt",

  "level.critical": "Kritiskt",
  "level.veryHigh": "Mycket högt",
  "level.high": "Högt",
  "level.elevated": "Förhöjt",
  "level.slightlyElevated": "Lite förhöjt",
  "level.invalidReading": "Ogiltigt",

  // Predicative fragment ("2/4 rum är varma"); Swedish predicative
  // adjectives DO inflect for number (unlike German/English/Dutch) —
  // these are the plural forms, the only ones this key is ever used with
  // (subtitle.*Comfort's rooms branch is only reachable once hasRoomsView
  // requires >= 2 rooms, see _computeData()). Note "rum" itself is
  // plural-invariant ("ett rum" / "flera rum"), unlike English
  // "room"/"rooms" — see the ternaries below, which are correctly
  // same-value-both-branches for the noun, not a bug.
  "adjective.warm": "varma",
  "adjective.cool": "svala",
  "adjective.humid": "fuktiga",
  "adjective.dry": "torra",
  "adjective.elevated": "förhöjda",
  "adjective.low": "låga",

  "avg.label": "Ø hem",
  "avg.tooltip": (v) => `${v.label}: ${v.value}`,
  "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · beräknat utifrån rumsvärden`,
  "avg.ariaOpen": "Öppna medelvärde",

  "subtitle.aboveComfort": (v) => `Ø ${v.diff} över komfort · ${v.count}/${v.total} ${v.total === 1 ? "rum" : "rum"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Ø ${v.diff} över komfort.`,
  "subtitle.belowComfort": (v) => `Ø ${v.diff} under komfort · ${v.count}/${v.total} ${v.total === 1 ? "rum" : "rum"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Ø ${v.diff} under komfort.`,
  "subtitle.inComfortIssue": (v) => `Ø inom komfort · ${v.name} sticker ut mest.`,
  "subtitle.inComfortAllGood": "Ø inom komfort · alla rum ligger inom målintervallet.",
  "subtitle.inComfort": "Ø inom komfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} rum utan data.`,

  "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Spridning ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "stigande",
  "trend.direction.stable": "stabil",
  "trend.direction.falling": "fallande",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} komfort`,
  "scale.comfortLabelShort": (v) => `${v.range} komfort`,
  "scale.optimalLabel": (v) => `${v.range} optimalt`,
  "scale.optimalLabelShort": (v) => `${v.range} optimalt`,

  "rangeScale.currentLabel": "nu",
  "rangeScale.currentLabelShort": "nu",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Dagens intervall ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Dagens intervall ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Kallaste rummet",
  "card.warmestRoom": "Varmaste rummet",
  "card.driestRoom": "Torraste rummet",
  "card.mostHumidRoom": "Fuktigaste rummet",
  "card.lowestRoom": "Lägsta rummet",
  "card.highestRoom": "Högsta rummet",
  "card.dailyMinimum": "Dagens minimum",
  "card.dailyMaximum": "Dagens maximum",
  "card.ariaOpen": (v) => `Öppna ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Öppna ${v.name}`,

  "rotator.hint": "Svep för att växla mellan vyer",

  "views.none": "Ingen vy tillgänglig.",

  "empty.title": "Inga data tillgängliga.",
  "empty.hintNoRooms": "Den konfigurerade medelvärdesenheten rapporterar inget tal.",
  "empty.hintMissingRooms": (v) => `${v.count} konfigurerad${v.count === 1 ? "" : "e"} enhet${v.count === 1 ? " saknas" : "er saknas"} eller rapporterar inget tal.`,
  "empty.hintNoRoomData": "Ingen konfigurerad rumsenhet rapporterar ett tal.",
};
