// Polish UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

import { getPluralCategory, selectPlural } from "../formatters.js";

export const pl = {
  "title.temperature": "Temperatura",
  "title.humidity": "Wilgotność",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Bardzo gorąco",
  "level.hot": "Gorąco",
  "level.veryWarm": "Bardzo ciepło",
  "level.warm": "Ciepło",
  "level.slightlyWarm": "Lekko ciepło",
  "level.optimal": "Optymalnie",
  "level.slightlyCool": "Lekko chłodno",
  "level.fresh": "Rześko",
  "level.cool": "Chłodno",
  "level.cold": "Zimno",
  "level.veryCold": "Bardzo zimno",

  "level.criticallyHumid": "Krytycznie wilgotno",
  "level.tooHumid": "Zbyt wilgotno",
  "level.veryHumid": "Bardzo wilgotno",
  "level.humid": "Wilgotno",
  "level.slightlyHumid": "Lekko wilgotno",
  "level.slightlyDry": "Lekko sucho",
  "level.dry": "Sucho",
  "level.veryDry": "Bardzo sucho",
  "level.tooDry": "Zbyt sucho",
  "level.criticallyDry": "Krytycznie sucho",

  "level.critical": "Krytycznie",
  "level.veryHigh": "Bardzo wysoki poziom",
  "level.high": "Wysoki poziom",
  "level.elevated": "Podwyższony poziom",
  "level.slightlyElevated": "Lekko podwyższony poziom",
  "level.invalidReading": "Nieprawidłowa wartość",

  // Predicative/adverbial fragments remain valid after Polish
  // numeral-governed noun forms in the surrounding sentence.
  "adjective.warm": "jest ciepło",
  "adjective.cool": "jest chłodno",
  "adjective.humid": "jest wilgotno",
  "adjective.dry": "jest sucho",
  "adjective.elevated": "wartości są podwyższone",
  "adjective.low": "wartości są niskie",

  "value.homeAverage": "Średnia dla domu",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · obliczona na podstawie wartości z pomieszczeń`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · obliczona na podstawie wartości z pomieszczeń`,
  "value.ariaOpen": "Otwórz wartość średnią",
  "status.noData": "Brak danych",
  "availability.entityMissing": (v) => `Nie znaleziono encji ${v.entity}.`,
  "availability.entitiesMissing": (v) => `Nie znaleziono skonfigurowanych encji pomieszczeń (${v.count}): ${v.entities}.`,
  "availability.valueUnavailable": "Wartość jest obecnie niedostępna.",
  "availability.noUsableRooms": "Żadna skonfigurowana wartość pomieszczenia nie jest obecnie użyteczna.",
  "availability.incompatible": "Skonfigurowane źródła używają niezgodnych typów pomiaru lub jednostek.",
  "availability.roomNoData": (v) => `${v.name}: brak danych. Otwórz szczegóły.`,
  "availability.valueNoData": (v) => `${v.label}: brak danych`,

  "subtitle.aboveComfort": (v) => `Średnia o ${v.diff} powyżej zakresu komfortu · w ${v.count} z ${v.total} ${v.total === 1 ? "pomieszczenia" : "pomieszczeń"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Średnia o ${v.diff} powyżej zakresu komfortu.`,
  "subtitle.belowComfort": (v) => `Średnia o ${v.diff} poniżej zakresu komfortu · w ${v.count} z ${v.total} ${v.total === 1 ? "pomieszczenia" : "pomieszczeń"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Średnia o ${v.diff} poniżej zakresu komfortu.`,
  "subtitle.inComfortIssue": (v) => `Średnia w zakresie komfortu · najbardziej wyróżnia się ${v.name}.`,
  "subtitle.inComfortAllGood": "Średnia w zakresie komfortu · wszystkie pomieszczenia są w zakresie docelowym.",
  "subtitle.inComfort": "Średnia w zakresie komfortu.",
  "subtitle.missingRooms": (v) =>
    ` ${v.count} ${selectPlural("pl", v.count, { one: "pokój", few: "pokoje", many: "pokoi", other: "pokoju" })} nie ${selectPlural("pl", v.count, { one: "został znaleziony", few: "zostały znalezione", many: "zostało znalezionych", other: "zostało znalezionych" })}.`,

  "footer.comfort": (v) => `Komfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Rozrzut ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "rosnący",
  "trend.direction.stable": "stabilny",
  "trend.direction.falling": "spadający",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} komfort`,
  "scale.comfortLabelShort": (v) => `${v.range} komfort`,
  // Keep the full adjective as the primary value, consistent with the
  // "${range} <descriptor>" pattern. The layout resolver substitutes the
  // short form only when the rendered width requires it.
  "scale.optimalLabel": (v) => `${v.range} optymalny`,
  "scale.optimalLabelShort": (v) => `${v.range} opt.`,

  "rangeScale.currentLabel": "teraz",
  "rangeScale.currentLabelShort": "teraz",
  "rangeScale.minLabel": "min.",
  "rangeScale.maxLabel": "maks.",
  "rangeScale.footer": (v) => `Dzisiejszy zakres ${v.span} · Min. ${v.min} (${v.minTime}) · Maks. ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Dzisiejszy zakres ${v.span} · Min. ${v.min} · Maks. ${v.max}`,

  "card.coldestRoom": "Najchłodniejszy pokój",
  "card.warmestRoom": "Najcieplejszy pokój",
  "card.driestRoom": "Najbardziej suche pomieszczenie",
  "card.mostHumidRoom": "Najbardziej wilgotne pomieszczenie",
  "card.lowestRoom": "Pomieszczenie z najniższą wartością",
  "card.highestRoom": "Pomieszczenie z najwyższą wartością",
  "card.dailyMinimum": "Minimum dzienne",
  "card.dailyMaximum": "Maksimum dzienne",
  "card.ariaOpen": (v) => `Otwórz ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Otwórz ${v.name}`,

  "rotator.hint": "Przesuń, aby zmienić widok",

  "views.none": "Brak dostępnego widoku.",

};
