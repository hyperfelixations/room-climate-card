// Chinese UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const zh = {
  "title.temperature": "温度",
  "title.humidity": "湿度",
  "title.co2": "CO₂",
  "title.pm25": "PM2.5",

  "level.veryHot": "非常炎热",
  "level.hot": "炎热",
  "level.veryWarm": "很暖",
  "level.warm": "温暖",
  "level.slightlyWarm": "略暖",
  "level.optimal": "最佳",
  "level.slightlyCool": "略凉",
  "level.fresh": "清爽",
  "level.cool": "凉",
  "level.cold": "冷",
  "level.veryCold": "非常寒冷",

  "level.criticallyHumid": "湿度严重过高",
  "level.tooHumid": "过于潮湿",
  "level.veryHumid": "非常潮湿",
  "level.humid": "潮湿",
  "level.slightlyHumid": "略潮湿",
  "level.slightlyDry": "略干燥",
  "level.dry": "干燥",
  "level.veryDry": "非常干燥",
  "level.tooDry": "过于干燥",
  "level.criticallyDry": "严重干燥",

  "level.critical": "严重",
  "level.veryHigh": "非常高",
  "level.high": "高",
  "level.elevated": "偏高",
  "level.slightlyElevated": "略高",
  "level.invalidReading": "无效值",

  "adjective.warm": "偏暖",
  "adjective.cool": "偏凉",
  "adjective.humid": "偏湿",
  "adjective.dry": "偏干",
  "adjective.elevated": "数值偏高",
  "adjective.low": "数值偏低",

  "avg.label": "全屋平均",
  "avg.tooltip": (v) => `${v.label}: ${v.value}`,
  "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · 根据各房间数值计算`,
  "avg.ariaOpen": "打开平均值",

  "subtitle.aboveComfort": (v) => `平均值高于舒适范围 ${v.diff} · ${v.total}个房间中有${v.count}个${v.adjective}。`,
  "subtitle.aboveComfortNoRooms": (v) => `平均值高于舒适范围 ${v.diff}。`,
  "subtitle.belowComfort": (v) => `平均值低于舒适范围 ${v.diff} · ${v.total}个房间中有${v.count}个${v.adjective}。`,
  "subtitle.belowComfortNoRooms": (v) => `平均值低于舒适范围 ${v.diff}。`,
  "subtitle.inComfortIssue": (v) => `平均值处于舒适范围 · ${v.name}的偏差最大。`,
  "subtitle.inComfortAllGood": "平均值处于舒适范围 · 所有房间均在目标范围内。",
  "subtitle.inComfort": "平均值处于舒适范围。",
  "subtitle.missingRooms": (v) => ` ${v.count}个房间无数据。`,

  "footer.comfort": (v) => `舒适 ${v.count}/${v.total}`,
  "footer.spread": (v) => `极差 ${v.value}`,
  "footer.trend": (v) => `趋势 ${v.value}`,
  "trend.direction.rising": "上升",
  "trend.direction.stable": "稳定",
  "trend.direction.falling": "下降",
  "trend.aria": (v) => `趋势${v.direction}：${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} 舒适`,
  "scale.comfortLabelShort": (v) => `${v.range} 舒适`,
  "scale.optimalLabel": (v) => `${v.range} 最佳`,
  "scale.optimalLabelShort": (v) => `${v.range} 最佳`,

  "rangeScale.currentLabel": "当前",
  "rangeScale.currentLabelShort": "当前",
  "rangeScale.minLabel": "最低",
  "rangeScale.maxLabel": "最高",
  "rangeScale.footer": (v) => `今日范围 ${v.span} · 最低 ${v.min} (${v.minTime}) · 最高 ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `今日范围 ${v.span} · 最低 ${v.min} · 最高 ${v.max}`,

  "card.coldestRoom": "最冷房间",
  "card.warmestRoom": "最暖房间",
  "card.driestRoom": "最干燥房间",
  "card.mostHumidRoom": "最潮湿房间",
  "card.lowestRoom": "数值最低的房间",
  "card.highestRoom": "数值最高的房间",
  "card.dailyMinimum": "当日最低",
  "card.dailyMaximum": "当日最高",
  "card.ariaOpen": (v) => `打开${v.label}: ${v.name}`,

  "room.ariaOpen": (v) => `打开${v.name}`,

  "rotator.hint": "滑动以切换视图",

  "views.none": "暂无可用视图。",

  "empty.title": "暂无可用数据。",
  "empty.hintNoRooms": "配置的平均值实体未返回数值。",
  "empty.hintMissingRooms": (v) => `${v.count}个已配置实体缺失或未返回数值。`,
  "empty.hintNoRoomData": "配置的房间实体均未返回数值。",
};
