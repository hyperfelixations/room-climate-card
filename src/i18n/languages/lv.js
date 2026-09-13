// Latvian UI strings. Same key set as en.js (reference + per-key fallback), checked
// at load by ../integrity.js. Value shapes and plural rules: see internal dev doc §5 "i18n und sprachabhängige Formatierung".

import { getPluralCategory, selectPlural } from "../formatters.js";

export const lv = {
  "title.temperature": "Temperatūra",
  "title.humidity": "Mitrums",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Ļoti karsts",
  "level.hot": "Karsts",
  "level.veryWarm": "Ļoti silts",
  "level.warm": "Silts",
  "level.slightlyWarm": "Nedaudz silts",
  "level.optimal": "Optimāls",
  "level.slightlyCool": "Nedaudz vēss",
  "level.fresh": "Svaigs",
  "level.cool": "Vēss",
  "level.cold": "Auksts",
  "level.veryCold": "Ļoti auksts",

  "level.criticallyHumid": "Kritiski mitrs",
  "level.tooHumid": "Pārāk mitrs",
  "level.veryHumid": "Ļoti mitrs",
  "level.humid": "Mitrs",
  "level.slightlyHumid": "Nedaudz mitrs",
  "level.slightlyDry": "Nedaudz sauss",
  "level.dry": "Sauss",
  "level.veryDry": "Ļoti sauss",
  "level.tooDry": "Pārāk sauss",
  "level.criticallyDry": "Kritiski sauss",

  "level.critical": "Kritisks",
  "level.veryHigh": "Ļoti augsts",
  "level.high": "Augsts",
  "level.elevated": "Paaugstināts",
  "level.slightlyElevated": "Nedaudz paaugstināts",
  "level.invalidReading": "Nederīgs",

  // Predicative fragment ("2/4 telpas ir siltas"); "telpa" (room) is
  // feminine, so these are feminine-plural forms — the only form this
  // key is actually used with (subtitle.*Comfort's rooms branch is only
  // reachable once rooms.comparable requires >= 2 rooms, see buildCardDomainModel()).
  "adjective.warm": "siltas",
  "adjective.cool": "vēsas",
  "adjective.humid": "mitras",
  "adjective.dry": "sausas",
  "adjective.elevated": "paaugstinātas",
  "adjective.low": "zemas",

  "value.homeAverage": "Ø māja",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · aprēķināts no telpu vērtībām`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · aprēķināts no telpu vērtībām`,
  "value.ariaOpen": "Atvērt vidējo vērtību",
  "status.noData": "Nav datu",
  "availability.valueUnavailable": "Vērtība pašlaik nav pieejama.",
  "availability.noUsableRooms": "Pašlaik nav izmantojama neviena konfigurētā telpas vērtība.",
  "availability.valueNotNumeric": "Entītija nesniedz skaitli.",
  "availability.valueImpossible": "Entītija sniedz fiziski neiespējamu vērtību.",
  "availability.roomNoData": (v) => `${v.name}: nav datu. Atvērt informāciju.`,
  "availability.valueNoData": (v) => `${v.label}: nav datu`,

  // Latvian cardinal numbers have a three-way CLDR plural split (zero:
  // n%10=0 or n%100 in 11..19; one: n%10=1 and n%100!=11; other:
  // everything else) — e.g. "1 telpa" / "2 telpas" / "11 telpu" / "21
  // telpa". Unlike the two-way (one/other) languages above, v.total >= 2
  // does NOT collapse this to a single safe form (10, 11, 20, 21 are all
  // >= 2 but land in different categories), so this uses selectPlural()
  // for the noun instead of a plain ternary — same reasoning as the
  // existing ru/pl blocks.
  "subtitle.aboveComfort": (v) => `Vidēji ${v.diff} virs komforta zonas · ${v.count}/${v.total} ${selectPlural("lv", v.total, { zero: "telpu", one: "telpa", other: "telpas" })} ir ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Vidēji ${v.diff} virs komforta zonas.`,
  "subtitle.belowComfort": (v) => `Vidēji ${v.diff} zem komforta zonas · ${v.count}/${v.total} ${selectPlural("lv", v.total, { zero: "telpu", one: "telpa", other: "telpas" })} ir ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Vidēji ${v.diff} zem komforta zonas.`,
  "subtitle.inComfortIssue": (v) => `Vidēji komforta zonā · ${v.name} izceļas visvairāk.`,
  "subtitle.inComfortAllGood": "Vidēji komforta zonā · visas telpas ir mērķa diapazonā.",
  "subtitle.inComfort": "Vidēji komforta zonā.",

  "footer.comfort": (v) => `Komforts ${v.count}/${v.total}`,
  "footer.spread": (v) => `Izkliede ${v.value}`,
  "footer.trend": (v) => `Tendence ${v.value}`,
  "trend.direction.rising": "pieaugoša",
  "trend.direction.stable": "stabila",
  "trend.direction.falling": "krītoša",
  "trend.aria": (v) => `Tendence ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} komforts`,
  "scale.comfortLabelShort": (v) => `${v.range} komforts`,
  "scale.optimalLabel": (v) => `${v.range} optimāli`,
  "scale.optimalLabelShort": (v) => `${v.range} optimāli`,
  "scale.bandRangeSigned": (v) => `${v.min} līdz ${v.max}`,

  "rangeScale.currentLabel": "tagad",
  "rangeScale.currentLabelShort": "tagad",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "maks",
  "rangeScale.footer": (v) => `Šodienas diapazons ${v.span} · Min ${v.min}${v.minTime} · Maks ${v.max}${v.maxTime}`,
  "rangeScale.footerTime": (v) => ` (${v.time})`,
  "rangeScale.footerCompact": (v) => `Šodienas diapazons ${v.span} · Min ${v.min} · Maks ${v.max}`,

  "card.coldestRoom": "Aukstākā telpa",
  "card.warmestRoom": "Siltākā telpa",
  "card.driestRoom": "Sausākā telpa",
  "card.mostHumidRoom": "Mitrākā telpa",
  "card.lowestRoom": "Zemākā telpa",
  "card.highestRoom": "Augstākā telpa",
  "card.dailyMinimum": "Dienas minimums",
  "card.dailyMaximum": "Dienas maksimums",
  "card.ariaOpen": (v) => `Atvērt ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Atvērt ${v.name}`,

  "rotator.hint": "Velciet, lai pārslēgtu skatus",

  "layout.nothingShown": "Visas šīs kartes daļas ir paslēptas ar show:.",
  "views.none": "Nav pieejams neviens skats.",

  "warning.label": "Brīdinājums",
  "warning.several": (v) =>
    `${v.count} ${selectPlural("lv", v.count, { zero: "problēmu", one: "problēma", other: "problēmas" })} ar šo karti. Sīkāk pārlūka konsolē.`,
  "warning.invalidValue": (v) => `${v.key} vērtība ${v.value} nav derīga. ${v.instead}`,
  "warning.foreignKey": (v) => `${v.key} nav šīs kartes opcija. Šī atslēga tiek ignorēta.`,
  "warning.mixedMeasurements": "Telpas mēra dažādus lielumus. Iestati entity vai saskaņo device_class.",
  "fallback.value": (v) => `Tiek izmantota noklusējuma vērtība: ${v.value}.`,
  "fallback.automatic": "Tiek izmantots automātiskais iestatījums.",
  "fallback.ignored": "Tā tiek ignorēta.",
  "fallback.firstView": "Karte sāk ar pirmo pieejamo skatu.",
  "fallback.defaults": "Tiek izmantotas noklusējuma vērtības.",
  "fallback.cardAction": "Tiek izmantota kartes darbība.",
  "fallback.option": (v) => `Opcijai ${v.key} tiek izmantota vērtība ${v.value}.`,
  "warning.deprecated": (v) => `${v.written} ir novecojis un tiks noņemts. Izmanto ${v.replacement}.`,
  "warning.entityNotFound": (v) => `${v.entity} Home Assistant neeksistē.`,
  "warning.unitAmbiguous": (v) => `${v.entity} vajag device_class; mērvienība atbilst vairākiem mērījumu veidiem.`,
  "warning.unidentified": (v) => `${v.entity} nav ne device_class, ne kartei zināmas mērvienības.`,
  "warning.unitUnreadable": (v) => `${v.entity} sniedz mērvienību, ko karte šeit nevar nolasīt.`,
  "warning.otherMeasurement": (v) => `${v.entity} mēra ko citu un tiek ignorēta.`,
  "hint.roomsUnavailable": (v) =>
    `${v.count} ${selectPlural("lv", v.count, { zero: "telpu pašlaik nav pieejamas", one: "telpa pašlaik nav pieejama", other: "telpas pašlaik nav pieejamas" })}.`,
  "hint.primaryUnavailable": "Galvenais sensors pašlaik nav pieejams; vidējā vērtība no telpām.",
  "hint.rangeUnavailable": "Šodienas diapazons pašlaik nav pieejams.",
  "hint.trendUnavailable": "Tendence pašlaik nav pieejama.",
  "hint.several": (v) =>
    `${v.count} ${selectPlural("lv", v.count, { zero: "avotu pašlaik nav pieejami", one: "avots pašlaik nav pieejams", other: "avoti pašlaik nav pieejami" })}.`,
  "value.empty": "(tukšs)",
  "warning.profileUnavailable": (v) => `${v.profile} nav klasifikācijas profils mērījumam „${v.measurement}”. ${v.instead}`,
  "warning.profileUnitMismatch": (v) => `classification.unit ${v.unit} neatbilst mērījumam „${v.measurement}”. ${v.instead}`,
  "warning.profileNotRepresentable": (v) => `Pielāgoto profilu nevar attēlot vienībā ${v.unit}. ${v.instead}`,
  "error.renderFailed": "Karti neizdevās uzzīmēt. Sīkāk pārlūka konsolē.",
  "error.notObject": "Nederīga konfigurācija: kartes konfigurācijai jābūt YAML objektam.",
  "error.unknownKey": (v) => `Nederīga konfigurācija: ${v.key} nav šīs kartes opcija.`,
  "error.unknownKeySuggestion": (v) => `Nederīga konfigurācija: ${v.key} nav šīs kartes opcija. Vai domāji ${v.suggestion}?`,
  "error.noSource": "Nederīga konfigurācija: iestati entity vai pievieno vismaz vienu ierakstu sadaļā rooms.",
  "error.mustBeEntityId": (v) => `Nederīga konfigurācija: ${v.key} jābūt entītijas ID.`,
  "error.mustBeList": (v) => `Nederīga konfigurācija: ${v.key} jābūt sarakstam.`,
  "error.mustBeObject": (v) => `Nederīga konfigurācija: ${v.key} jābūt objektam.`,
  "error.duplicateRoom": (v) => `Nederīga konfigurācija: ${v.entity} izmanto vairāk nekā viena telpa.`,

};
