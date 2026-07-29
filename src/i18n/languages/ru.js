// Russian UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

import { getPluralCategory, selectPlural } from "../formatters.js";

export const ru = {
  "title.temperature": "Температура",
  "title.humidity": "Влажность",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Очень жарко",
  "level.hot": "Жарко",
  "level.veryWarm": "Очень тепло",
  "level.warm": "Тепло",
  "level.slightlyWarm": "Слегка тепло",
  "level.optimal": "Оптимально",
  "level.slightlyCool": "Слегка прохладно",
  "level.fresh": "Свежо",
  "level.cool": "Прохладно",
  "level.cold": "Холодно",
  "level.veryCold": "Очень холодно",

  "level.criticallyHumid": "Критически влажно",
  "level.tooHumid": "Слишком влажно",
  "level.veryHumid": "Очень влажно",
  "level.humid": "Влажно",
  "level.slightlyHumid": "Слегка влажно",
  "level.slightlyDry": "Слегка сухо",
  "level.dry": "Сухо",
  "level.veryDry": "Очень сухо",
  "level.tooDry": "Слишком сухо",
  "level.criticallyDry": "Критически сухо",

  "level.critical": "Критично",
  "level.veryHigh": "Очень высокий уровень",
  "level.high": "Высокий уровень",
  "level.elevated": "Повышенный уровень",
  "level.slightlyElevated": "Слегка повышенный уровень",
  "level.invalidReading": "Недопустимое значение",

  // Adverbial/predicative fragments avoid forcing an adjective to
  // agree with Russian numeral-governed room noun forms.
  "adjective.warm": "тепло",
  "adjective.cool": "прохладно",
  "adjective.humid": "влажно",
  "adjective.dry": "сухо",
  "adjective.elevated": "уровень повышен",
  "adjective.low": "уровень низкий",

  "avg.label": "Среднее по дому",
  "avg.tooltip": (v) => `${v.label}: ${v.value}`,
  "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · рассчитано по значениям комнат`,
  "avg.ariaOpen": "Открыть среднее значение",

  "subtitle.aboveComfort": (v) => `Среднее на ${v.diff} выше комфортного диапазона · в ${v.count} ${selectPlural("ru", v.count, { one: "комнате", few: "комнатах", many: "комнатах", other: "комнатах" })} из ${v.total} ${selectPlural("ru", v.total, { one: "комнаты", few: "комнат", many: "комнат", other: "комнат" })} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Среднее на ${v.diff} выше комфортного диапазона.`,
  "subtitle.belowComfort": (v) => `Среднее на ${v.diff} ниже комфортного диапазона · в ${v.count} ${selectPlural("ru", v.count, { one: "комнате", few: "комнатах", many: "комнатах", other: "комнатах" })} из ${v.total} ${selectPlural("ru", v.total, { one: "комнаты", few: "комнат", many: "комнат", other: "комнат" })} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Среднее на ${v.diff} ниже комфортного диапазона.`,
  "subtitle.inComfortIssue": (v) => `Среднее в комфортном диапазоне · сильнее всего выделяется ${v.name}.`,
  "subtitle.inComfortAllGood": "Среднее в комфортном диапазоне · все комнаты находятся в целевом диапазоне.",
  "subtitle.inComfort": "Среднее в комфортном диапазоне.",
  "subtitle.missingRooms": (v) => ` ${v.count} ${selectPlural("ru", v.count, { one: "комната", few: "комнаты", many: "комнат", other: "комнаты" })} без данных.`,

  "footer.comfort": (v) => `Комфорт ${v.count}/${v.total}`,
  "footer.spread": (v) => `Разброс ${v.value}`,
  "footer.trend": (v) => `Тренд ${v.value}`,
  "trend.direction.rising": "растёт",
  "trend.direction.stable": "стабильно",
  "trend.direction.falling": "снижается",
  "trend.aria": (v) => `Тренд ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} комфорт`,
  "scale.comfortLabelShort": (v) => `${v.range} комфорт`,
  "scale.optimalLabel": (v) => `${v.range} оптимум`,
  "scale.optimalLabelShort": (v) => `${v.range} оптимум`,

  "rangeScale.currentLabel": "сейчас",
  "rangeScale.currentLabelShort": "сейчас",
  "rangeScale.minLabel": "мин.",
  "rangeScale.maxLabel": "макс.",
  "rangeScale.footer": (v) => `Диапазон за сегодня ${v.span} · Мин. ${v.min} (${v.minTime}) · Макс. ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Диапазон за сегодня ${v.span} · Мин. ${v.min} · Макс. ${v.max}`,

  "card.coldestRoom": "Самая холодная комната",
  "card.warmestRoom": "Самая тёплая комната",
  "card.driestRoom": "Самая сухая комната",
  "card.mostHumidRoom": "Самая влажная комната",
  "card.lowestRoom": "Комната с самым низким значением",
  "card.highestRoom": "Комната с самым высоким значением",
  "card.dailyMinimum": "Минимум за день",
  "card.dailyMaximum": "Максимум за день",
  "card.ariaOpen": (v) => `Открыть «${v.label}»: ${v.name}`,

  "room.ariaOpen": (v) => `Открыть ${v.name}`,

  "rotator.hint": "Проведите по экрану, чтобы сменить вид",

  "views.none": "Нет доступных представлений.",

  "empty.title": "Нет доступных данных.",
  "empty.hintNoRooms": "Настроенная сущность среднего значения не передаёт числовое значение.",
  "empty.hintMissingRooms": (v) => {
    const category = getPluralCategory("ru", v.count);
    if (category === "one") return `${v.count} настроенная сущность отсутствует или не передаёт числовое значение.`;
    if (category === "few") return `${v.count} настроенные сущности отсутствуют или не передают числовое значение.`;
    return `${v.count} настроенных сущностей отсутствуют или не передают числовое значение.`;
  },
  "empty.hintNoRoomData": "Ни одна настроенная сущность комнаты не передаёт числовое значение.",
};
