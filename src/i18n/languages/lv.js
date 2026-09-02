// Latvian UI strings. Same key set as en.js (reference + per-key fallback), checked
// at load by ../integrity.js. Value shapes and plural rules: interne Doku §5.

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
  "availability.entityMissing": (v) => `Entītija ${v.entity} nav atrasta.`,
  "availability.entitiesMissing": (v) => `Nav atrastas ${v.count} konfigurētās telpu entītijas: ${v.entities}.`,
  "availability.valueUnavailable": "Vērtība pašlaik nav pieejama.",
  "availability.noUsableRooms": "Pašlaik nav izmantojama neviena konfigurētā telpas vērtība.",
  "availability.incompatible": "Konfigurētie avoti izmanto nesaderīgus mērījumu veidus vai mērvienības.",
  "availability.valueNotNumeric": "Entītija nesniedz skaitli.",
  "availability.valueImpossible": "Entītija sniedz fiziski neiespējamu vērtību.",
  "availability.unitAmbiguous": (v) => `${v.entity} nepieciešama device_class: šo mērvienību izmanto vairāki mērījumu veidi, un karte nemin.`,
  "availability.unidentified": (v) => `${v.entity} nenorāda, ko tā mēra. Pievieno device_class vai mērvienību, ko karte pazīst.`,
  "availability.unitUnreadable": (v) => `${v.entity} sniedz mērvienību, ko karte šim mērījumu veidam nevar nolasīt.`,
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
  "subtitle.missingRooms": (v) =>
    ` ${v.count} ${selectPlural("lv", v.count, { zero: "telpu", one: "telpa", other: "telpas" })} nav ${selectPlural("lv", v.count, { zero: "atrastas", one: "atrasta", other: "atrastas" })}.`,

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

};
