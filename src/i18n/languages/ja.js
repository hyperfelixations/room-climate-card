// Japanese UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const ja = {
  "title.temperature": "温度",
  "title.humidity": "湿度",
  "title.co2": "CO₂",
  "title.pm25": "PM2.5",

  "level.veryHot": "非常に暑い",
  "level.hot": "暑い",
  "level.veryWarm": "かなり暖かい",
  "level.warm": "暖かい",
  "level.slightlyWarm": "やや暖かい",
  "level.optimal": "最適",
  "level.slightlyCool": "やや涼しい",
  "level.fresh": "さわやか",
  "level.cool": "涼しい",
  "level.cold": "寒い",
  "level.veryCold": "非常に寒い",

  "level.criticallyHumid": "湿度が危険域",
  "level.tooHumid": "湿度が高すぎる",
  "level.veryHumid": "湿度が非常に高い",
  "level.humid": "湿度が高い",
  "level.slightlyHumid": "湿度がやや高い",
  "level.slightlyDry": "やや乾燥",
  "level.dry": "乾燥",
  "level.veryDry": "非常に乾燥",
  "level.tooDry": "乾燥しすぎ",
  "level.criticallyDry": "乾燥が危険域",

  "level.critical": "危険",
  "level.veryHigh": "非常に高い",
  "level.high": "高い",
  "level.elevated": "高め",
  "level.slightlyElevated": "やや高め",
  "level.invalidReading": "無効な値",

  "adjective.warm": "暖かめ",
  "adjective.cool": "涼しめ",
  "adjective.humid": "湿度が高め",
  "adjective.dry": "乾燥気味",
  "adjective.elevated": "数値が高め",
  "adjective.low": "数値が低め",

  "value.homeAverage": "住宅平均",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · 各部屋の値から算出`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · 各部屋の値から算出`,
  "value.ariaOpen": "平均値を開く",
  "status.noData": "データなし",
  "availability.entityMissing": (v) => `エンティティ ${v.entity} が見つかりません。`,
  "availability.entitiesMissing": (v) => `設定された部屋エンティティが ${v.count} 件見つかりません: ${v.entities}。`,
  "availability.valueUnavailable": "現在、値を利用できません。",
  "availability.noUsableRooms": "現在利用できる設定済みの部屋値がありません。",
  "availability.incompatible": "設定されたソースの測定種類または単位に互換性がありません。",
  "availability.roomNoData": (v) => `${v.name}: データなし。詳細を開く。`,
  "availability.valueNoData": (v) => `${v.label}: データなし`,

  "subtitle.aboveComfort": (v) => `平均は快適範囲を ${v.diff} 上回っています · ${v.total}室中${v.count}室は${v.adjective}です。`,
  "subtitle.aboveComfortNoRooms": (v) => `平均は快適範囲を ${v.diff} 上回っています。`,
  "subtitle.belowComfort": (v) => `平均は快適範囲を ${v.diff} 下回っています · ${v.total}室中${v.count}室は${v.adjective}です。`,
  "subtitle.belowComfortNoRooms": (v) => `平均は快適範囲を ${v.diff} 下回っています。`,
  "subtitle.inComfortIssue": (v) => `平均は快適範囲内 · ${v.name}が最も外れています。`,
  "subtitle.inComfortAllGood": "平均は快適範囲内 · すべての部屋が目標範囲内です。",
  "subtitle.inComfort": "平均は快適範囲内です。",
  "subtitle.missingRooms": (v) => ` ${v.count}室はデータなし。`,

  "footer.comfort": (v) => `快適 ${v.count}/${v.total}`,
  "footer.spread": (v) => `ばらつき ${v.value}`,
  "footer.trend": (v) => `トレンド ${v.value}`,
  "trend.direction.rising": "上昇",
  "trend.direction.stable": "安定",
  "trend.direction.falling": "下降",
  "trend.aria": (v) => `傾向 ${v.direction}: ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} 快適`,
  "scale.comfortLabelShort": (v) => `${v.range} 快適`,
  "scale.optimalLabel": (v) => `${v.range} 最適`,
  "scale.optimalLabelShort": (v) => `${v.range} 最適`,

  "rangeScale.currentLabel": "現在",
  "rangeScale.currentLabelShort": "現在",
  "rangeScale.minLabel": "最小",
  "rangeScale.maxLabel": "最大",
  "rangeScale.footer": (v) => `今日の範囲 ${v.span} · 最小 ${v.min} (${v.minTime}) · 最大 ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `今日の範囲 ${v.span} · 最小 ${v.min} · 最大 ${v.max}`,

  "card.coldestRoom": "最も寒い部屋",
  "card.warmestRoom": "最も暖かい部屋",
  "card.driestRoom": "最も乾燥した部屋",
  "card.mostHumidRoom": "最も湿度が高い部屋",
  "card.lowestRoom": "値が最も低い部屋",
  "card.highestRoom": "値が最も高い部屋",
  "card.dailyMinimum": "日最低",
  "card.dailyMaximum": "日最高",
  "card.ariaOpen": (v) => `${v.label}を開く: ${v.name}`,

  "room.ariaOpen": (v) => `${v.name}を開く`,

  "rotator.hint": "スワイプして表示を切り替え",

  "views.none": "利用可能な表示がありません。",

};
