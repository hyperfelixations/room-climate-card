// Ukrainian UI strings.
//
// Key set must stay identical to en.js. Ukrainian has one/few/many plural
// categories, so count-dependent room nouns use the shared CLDR helper.

import { selectPlural } from "../formatters.js";

export const uk = {
  "title.temperature": "Температура",
  "title.humidity": "Вологість",
  "title.co2": "CO₂",
  "title.pm25": "PM2.5",

  "level.veryHot": "Дуже спекотно",
  "level.hot": "Спекотно",
  "level.veryWarm": "Дуже тепло",
  "level.warm": "Тепло",
  "level.slightlyWarm": "Трохи тепло",
  "level.optimal": "Оптимально",
  "level.slightlyCool": "Трохи прохолодно",
  "level.fresh": "Свіжо",
  "level.cool": "Прохолодно",
  "level.cold": "Холодно",
  "level.veryCold": "Дуже холодно",

  "level.criticallyHumid": "Критично висока вологість",
  "level.tooHumid": "Надто висока вологість",
  "level.veryHumid": "Дуже волого",
  "level.humid": "Волого",
  "level.slightlyHumid": "Трохи волого",
  "level.slightlyDry": "Трохи сухо",
  "level.dry": "Сухо",
  "level.veryDry": "Дуже сухо",
  "level.tooDry": "Надто сухо",
  "level.criticallyDry": "Критично низька вологість",

  "level.critical": "Критично",
  "level.veryHigh": "Дуже високий",
  "level.high": "Високий",
  "level.elevated": "Підвищений",
  "level.slightlyElevated": "Трохи підвищений",
  "level.invalidReading": "Недійсне значення",

  "adjective.warm": "тепло",
  "adjective.cool": "прохолодно",
  "adjective.humid": "волого",
  "adjective.dry": "сухо",
  "adjective.elevated": "підвищений",
  "adjective.low": "низький",

  "value.homeAverage": "Середнє по дому",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · розраховано за значеннями кімнат`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · розраховано за значеннями кімнат`,
  "value.ariaOpen": "Відкрити середнє значення",
  "status.noData": "Немає даних",

  "availability.entityMissing": (v) => `Сутність ${v.entity} не знайдена.`,
  "availability.entitiesMissing": (v) =>
    `${selectPlural("uk", v.count, { one: "Налаштовану сутність кімнати не знайдено", few: "Налаштовані сутності кімнат не знайдено", many: "Налаштовані сутності кімнат не знайдено", other: "Налаштованої сутності кімнати не знайдено" })} (${v.count}): ${v.entities}.`,
  "availability.valueUnavailable": "Значення наразі недоступне.",
  "availability.noUsableRooms": "Наразі немає доступних значень для налаштованих кімнат.",
  "availability.incompatible": "Налаштовані джерела використовують несумісні типи вимірювань або одиниці.",
  "availability.valueNotNumeric": "Сутність не передає число.",
  "availability.valueImpossible": "Сутність передає фізично неможливе значення.",
  "availability.unitAmbiguous": (v) => `Для ${v.entity} потрібен device_class: цю одиницю використовують кілька типів вимірювань, і картка не вгадує.`,
  "availability.unidentified": (v) => `${v.entity} не повідомляє, що вимірює. Додайте device_class або одиницю, відому картці.`,
  "availability.unitUnreadable": (v) => `${v.entity} передає одиницю, яку картка не може прочитати для цього типу вимірювання.`,
  "availability.roomNoData": (v) => `${v.name}: немає даних. Відкрийте деталі.`,
  "availability.valueNoData": (v) => `${v.label}: немає даних`,

  "subtitle.aboveComfort": (v) => `Середнє на ${v.diff} вище комфортного рівня · ${v.count}/${v.total} ${selectPlural("uk", v.total, { one: "кімната", few: "кімнати", many: "кімнат", other: "кімнати" })}: ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Середнє на ${v.diff} вище комфортного рівня.`,
  "subtitle.belowComfort": (v) => `Середнє на ${v.diff} нижче комфортного рівня · ${v.count}/${v.total} ${selectPlural("uk", v.total, { one: "кімната", few: "кімнати", many: "кімнат", other: "кімнати" })}: ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Середнє на ${v.diff} нижче комфортного рівня.`,
  "subtitle.inComfortIssue": (v) => `Середнє в межах комфорту · найбільше вирізняється: ${v.name}.`,
  "subtitle.inComfortAllGood": "Середнє в межах комфорту · у всіх кімнатах показники в цільовому діапазоні.",
  "subtitle.inComfort": "Середнє в межах комфорту.",
  "subtitle.missingRooms": (v) =>
    ` ${v.count} ${selectPlural("uk", v.count, { one: "налаштована кімната не знайдена", few: "налаштовані кімнати не знайдені", many: "налаштованих кімнат не знайдено", other: "налаштованої кімнати не знайдено" })}.`,

  "footer.comfort": (v) => `Комфорт ${v.count}/${v.total}`,
  "footer.spread": (v) => `Розкид ${v.value}`,
  "footer.trend": (v) => `Тренд ${v.value}`,
  "trend.direction.rising": "зростає",
  "trend.direction.stable": "стабільний",
  "trend.direction.falling": "знижується",
  "trend.aria": (v) => `Тренд ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} комфорт`,
  "scale.comfortLabelShort": (v) => `${v.range} комфорт`,
  "scale.optimalLabel": (v) => `${v.range} оптимально`,
  "scale.optimalLabelShort": (v) => `${v.range} оптимально`,

  "rangeScale.currentLabel": "зараз",
  "rangeScale.currentLabelShort": "зараз",
  "rangeScale.minLabel": "мін.",
  "rangeScale.maxLabel": "макс.",
  "rangeScale.footer": (v) => `Діапазон за сьогодні ${v.span} · Мін. ${v.min}${v.minTime} · Макс. ${v.max}${v.maxTime}`,
  "rangeScale.footerTime": (v) => ` (${v.time})`,
  "rangeScale.footerCompact": (v) => `Діапазон за сьогодні ${v.span} · Мін. ${v.min} · Макс. ${v.max}`,

  "card.coldestRoom": "Найхолодніша кімната",
  "card.warmestRoom": "Найтепліша кімната",
  "card.driestRoom": "Найсухіша кімната",
  "card.mostHumidRoom": "Найвологіша кімната",
  "card.lowestRoom": "Найнижче значення",
  "card.highestRoom": "Найвище значення",
  "card.dailyMinimum": "Мінімум за день",
  "card.dailyMaximum": "Максимум за день",
  "card.ariaOpen": (v) => `Відкрити ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Відкрити ${v.name}`,

  "rotator.hint": "Проведіть пальцем, щоб перемикати вигляд",

  "views.none": "Немає доступного вигляду.",
};
