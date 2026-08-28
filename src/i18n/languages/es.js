// Spanish UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const es = {
  "title.temperature": "Temperatura",
  "title.humidity": "Humedad",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Muy caluroso",
  "level.hot": "Caluroso",
  "level.veryWarm": "Muy cálido",
  "level.warm": "Cálido",
  "level.slightlyWarm": "Ligeramente cálido",
  "level.optimal": "Óptimo",
  "level.slightlyCool": "Ligeramente fresco",
  "level.fresh": "Fresco",
  "level.cool": "Frío moderado",
  "level.cold": "Frío",
  "level.veryCold": "Muy frío",

  "level.criticallyHumid": "Humedad crítica",
  "level.tooHumid": "Demasiado húmedo",
  "level.veryHumid": "Muy húmedo",
  "level.humid": "Húmedo",
  "level.slightlyHumid": "Ligeramente húmedo",
  "level.slightlyDry": "Ligeramente seco",
  "level.dry": "Seco",
  "level.veryDry": "Muy seco",
  "level.tooDry": "Demasiado seco",
  "level.criticallyDry": "Sequedad crítica",

  "level.critical": "Crítico",
  "level.veryHigh": "Muy alto",
  "level.high": "Alto",
  "level.elevated": "Elevado",
  "level.slightlyElevated": "Ligeramente elevado",
  "level.invalidReading": "No válido",

  // Predicative fragments agree with feminine plural "habitaciones";
  // elevated/low use a semantic value phrase rather than describing
  // the rooms themselves as physically high or low.
  "adjective.warm": "cálidas",
  "adjective.cool": "frescas",
  "adjective.humid": "húmedas",
  "adjective.dry": "secas",
  "adjective.elevated": "con valores elevados",
  "adjective.low": "con valores bajos",

  "value.homeAverage": "Media del hogar",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculada a partir de los valores de las habitaciones`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · calculada a partir de los valores de las habitaciones`,
  "value.ariaOpen": "Abrir la media",
  "status.noData": "Sin datos",
  "availability.entityMissing": (v) => `No se encontró la entidad ${v.entity}.`,
  "availability.entitiesMissing": (v) => `No se ${v.count === 1 ? "encontró" : "encontraron"} ${v.count} ${v.count === 1 ? "entidad de habitación configurada" : "entidades de habitación configuradas"}: ${v.entities}.`,
  "availability.valueUnavailable": "El valor no está disponible en este momento.",
  "availability.noUsableRooms": "Ningún valor de habitación configurado se puede usar en este momento.",
  "availability.incompatible": "Las fuentes configuradas usan tipos de medida o unidades incompatibles.",
  "availability.valueNotNumeric": "La entidad no proporciona un número.",
  "availability.valueImpossible": "La entidad proporciona un valor físicamente imposible.",
  "availability.unitAmbiguous": (v) => `${v.entity} necesita un device_class: varios tipos de medida usan esa unidad y la tarjeta no adivina.`,
  "availability.unidentified": (v) => `${v.entity} no dice qué mide. Añade un device_class o una unidad que la tarjeta conozca.`,
  "availability.unitUnreadable": (v) => `${v.entity} proporciona una unidad que la tarjeta no puede leer para este tipo de medida.`,
  "availability.roomNoData": (v) => `${v.name}: sin datos. Abrir detalles.`,
  "availability.valueNoData": (v) => `${v.label}: sin datos`,

  "subtitle.aboveComfort": (v) => `Media ${v.diff} por encima del confort · ${v.count}/${v.total} ${v.total === 1 ? "habitación" : "habitaciones"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Media ${v.diff} por encima del confort.`,
  "subtitle.belowComfort": (v) => `Media ${v.diff} por debajo del confort · ${v.count}/${v.total} ${v.total === 1 ? "habitación" : "habitaciones"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Media ${v.diff} por debajo del confort.`,
  "subtitle.inComfortIssue": (v) => `Media dentro del intervalo de confort · ${v.name} es la habitación que más se desvía.`,
  "subtitle.inComfortAllGood": "Media dentro del intervalo de confort · todas las habitaciones están dentro del intervalo objetivo.",
  "subtitle.inComfort": "Media dentro del intervalo de confort.",
  "subtitle.missingRooms": (v) => ` No se ${v.count === 1 ? "encontró" : "encontraron"} ${v.count} ${v.count === 1 ? "habitación configurada" : "habitaciones configuradas"}.`,

  "footer.comfort": (v) => `Confort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Diferencia ${v.value}`,
  "footer.trend": (v) => `Tendencia ${v.value}`,
  "trend.direction.rising": "ascendente",
  "trend.direction.stable": "estable",
  "trend.direction.falling": "descendente",
  "trend.aria": (v) => `Tendencia ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} confort`,
  "scale.comfortLabelShort": (v) => `${v.range} confort`,
  "scale.optimalLabel": (v) => `${v.range} óptimo`,
  "scale.optimalLabelShort": (v) => `${v.range} óptimo`,

  "rangeScale.currentLabel": "ahora",
  "rangeScale.currentLabelShort": "ahora",
  "rangeScale.minLabel": "mín.",
  "rangeScale.maxLabel": "máx.",
  "rangeScale.footer": (v) => `Intervalo de hoy ${v.span} · Mín. ${v.min}${v.minTime} · Máx. ${v.max}${v.maxTime}`,
  "rangeScale.footerTime": (v) => ` (${v.time})`,
  "rangeScale.footerCompact": (v) => `Intervalo de hoy ${v.span} · Mín. ${v.min} · Máx. ${v.max}`,

  "card.coldestRoom": "Habitación más fría",
  "card.warmestRoom": "Habitación más cálida",
  "card.driestRoom": "Habitación más seca",
  "card.mostHumidRoom": "Habitación más húmeda",
  "card.lowestRoom": "Habitación con el valor más bajo",
  "card.highestRoom": "Habitación con el valor más alto",
  "card.dailyMinimum": "Mínimo diario",
  "card.dailyMaximum": "Máximo diario",
  "card.ariaOpen": (v) => `Abrir ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Abrir ${v.name}`,

  "rotator.hint": "Desliza para cambiar de vista",

  "layout.nothingShown": "Todas las partes de esta tarjeta están ocultas por show:.",
  "views.none": "No hay ninguna vista disponible.",

};
