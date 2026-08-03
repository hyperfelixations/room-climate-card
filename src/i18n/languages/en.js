// English UI strings — the reference language.
//
// English is the card default, the HACS audience's language, and the
// fallback translate() uses for any key missing in another language. Every
// other language file in this directory must carry exactly this key set.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const en = {
  "title.temperature": "Temperature",
  "title.humidity": "Humidity",
  "title.co2": "CO₂",
  "title.pm25": "PM2.5",

  "level.veryHot": "Very hot",
  "level.hot": "Hot",
  "level.veryWarm": "Very warm",
  "level.warm": "Warm",
  "level.slightlyWarm": "Slightly warm",
  "level.optimal": "Optimal",
  "level.slightlyCool": "Slightly cool",
  "level.fresh": "Fresh",
  "level.cool": "Cool",
  "level.cold": "Cold",
  "level.veryCold": "Very cold",

  "level.criticallyHumid": "Critically humid",
  "level.tooHumid": "Too humid",
  "level.veryHumid": "Very humid",
  "level.humid": "Humid",
  "level.slightlyHumid": "Slightly humid",
  "level.slightlyDry": "Slightly dry",
  "level.dry": "Dry",
  "level.veryDry": "Very dry",
  "level.tooDry": "Too dry",
  "level.criticallyDry": "Critically dry",

  "level.critical": "Critical",
  "level.veryHigh": "Very high",
  "level.high": "High",
  "level.elevated": "Elevated",
  "level.slightlyElevated": "Slightly elevated",
  "level.invalidReading": "Invalid",

  "adjective.warm": "warm",
  "adjective.cool": "cool",
  "adjective.humid": "humid",
  "adjective.dry": "dry",
  "adjective.elevated": "elevated",
  "adjective.low": "low",

  "value.homeAverage": "Home avg.",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculated from room values`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · calculated from room values`,
  "value.ariaOpen": "Open average",

  "subtitle.aboveComfort": (v) => `Avg. ${v.diff} above comfort · ${v.count}/${v.total} ${v.total === 1 ? "room" : "rooms"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Avg. ${v.diff} above comfort.`,
  "subtitle.belowComfort": (v) => `Avg. ${v.diff} below comfort · ${v.count}/${v.total} ${v.total === 1 ? "room" : "rooms"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Avg. ${v.diff} below comfort.`,
  "subtitle.inComfortIssue": (v) => `Avg. in comfort · ${v.name} stands out most.`,
  "subtitle.inComfortAllGood": "Avg. in comfort · all rooms are within target range.",
  "subtitle.inComfort": "Avg. in comfort.",
  "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "room" : "rooms"} without data.`,

  "footer.comfort": (v) => `Comfort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Spread ${v.value}`,
  "footer.trend": (v) => `Trend ${v.value}`,
  "trend.direction.rising": "rising",
  "trend.direction.stable": "stable",
  "trend.direction.falling": "falling",
  "trend.aria": (v) => `Trend ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} comfort`,
  "scale.comfortLabelShort": (v) => `${v.range} comfort`,
  "scale.optimalLabel": (v) => `${v.range} optimal`,
  "scale.optimalLabelShort": (v) => `${v.range} optimal`,

  "rangeScale.currentLabel": "now",
  "rangeScale.currentLabelShort": "now",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Today's span ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Today's span ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Coldest room",
  "card.warmestRoom": "Warmest room",
  "card.driestRoom": "Driest room",
  "card.mostHumidRoom": "Most humid room",
  "card.lowestRoom": "Lowest room",
  "card.highestRoom": "Highest room",
  "card.dailyMinimum": "Daily minimum",
  "card.dailyMaximum": "Daily maximum",
  "card.ariaOpen": (v) => `Open ${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `Open ${v.name}`,

  "rotator.hint": "Swipe to switch between views",

  "views.none": "No view available.",

  "empty.title": "No data available.",
  "empty.hintNoRooms": "The configured average entity is not reporting a number.",
  "empty.hintMissingRooms": (v) => `${v.count} configured ${v.count === 1 ? "entity is" : "entities are"} missing or not reporting a number.`,
  "empty.hintNoRoomData": "No configured room entity is reporting a number.",
};
