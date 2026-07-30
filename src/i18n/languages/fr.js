// French UI strings.
//
// Key set must stay identical to en.js: translate() falls back to English
// per key, and a module-load self-check (see ../integrity.js) warns about any
// missing or extra key as soon as the card is loaded.
//
// Values are either a string or a function (vars) => string — the function
// form covers interpolation and plural/conditional branching without pulling
// in a full ICU parser.

export const fr = {
  "title.temperature": "Température",
  "title.humidity": "Humidité",
  "title.co2": "CO₂",
  "title.pm25": "PM2,5",

  "level.veryHot": "Très chaud",
  "level.hot": "Chaud",
  "level.veryWarm": "Assez chaud",
  "level.warm": "Tiède",
  "level.slightlyWarm": "Légèrement tiède",
  "level.optimal": "Optimal",
  "level.slightlyCool": "Légèrement frais",
  "level.fresh": "Frais",
  "level.cool": "Frisquet",
  "level.cold": "Froid",
  "level.veryCold": "Très froid",

  "level.criticallyHumid": "Extrêmement humide",
  "level.tooHumid": "Trop humide",
  "level.veryHumid": "Très humide",
  "level.humid": "Humide",
  "level.slightlyHumid": "Légèrement humide",
  "level.slightlyDry": "Légèrement sec",
  "level.dry": "Sec",
  "level.veryDry": "Très sec",
  "level.tooDry": "Trop sec",
  "level.criticallyDry": "Extrêmement sec",

  "level.critical": "Critique",
  "level.veryHigh": "Très élevé",
  "level.high": "Élevé",
  "level.elevated": "Modérément élevé",
  "level.slightlyElevated": "Légèrement élevé",
  "level.invalidReading": "Invalide",

  // Predicative fragment ("2/4 pièces chaudes"); "pièce"/"pièces" is
  // feminine, so these are feminine-plural forms — the only form this
  // key is actually used with (subtitle.*Comfort's rooms branch is only
  // reachable once hasRoomsView requires >= 2 rooms, see buildCardDomainModel()).
  "adjective.warm": "chaudes",
  "adjective.cool": "fraîches",
  "adjective.humid": "humides",
  "adjective.dry": "sèches",
  "adjective.elevated": "élevées",
  "adjective.low": "basses",

  "avg.label": "Moy. maison",
  "avg.tooltip": (v) => `${v.label}: ${v.value}`,
  "avg.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculé à partir des valeurs des pièces`,
  "avg.ariaOpen": "Ouvrir la moyenne",

  "subtitle.aboveComfort": (v) => `Moy. ${v.diff} au-dessus du confort · ${v.count}/${v.total} ${v.total === 1 ? "pièce" : "pièces"} ${v.adjective}.`,
  "subtitle.aboveComfortNoRooms": (v) => `Moy. ${v.diff} au-dessus du confort.`,
  "subtitle.belowComfort": (v) => `Moy. ${v.diff} en dessous du confort · ${v.count}/${v.total} ${v.total === 1 ? "pièce" : "pièces"} ${v.adjective}.`,
  "subtitle.belowComfortNoRooms": (v) => `Moy. ${v.diff} en dessous du confort.`,
  "subtitle.inComfortIssue": (v) => `Moy. dans le confort · ${v.name} se démarque le plus.`,
  "subtitle.inComfortAllGood": "Moy. dans le confort · toutes les pièces sont dans la plage cible.",
  "subtitle.inComfort": "Moy. dans le confort.",
  "subtitle.missingRooms": (v) => ` ${v.count} ${v.count === 1 ? "pièce" : "pièces"} sans données.`,

  "footer.comfort": (v) => `Confort ${v.count}/${v.total}`,
  "footer.spread": (v) => `Écart ${v.value}`,
  "footer.trend": (v) => `Tendance ${v.value}`,
  "trend.direction.rising": "en hausse",
  "trend.direction.stable": "stable",
  "trend.direction.falling": "en baisse",
  "trend.aria": (v) => `Tendance ${v.direction} : ${v.value}`,

  "scale.comfortLabel": (v) => `${v.range} confort`,
  "scale.comfortLabelShort": (v) => `${v.range} confort`,
  "scale.optimalLabel": (v) => `${v.range} optimal`,
  "scale.optimalLabelShort": (v) => `${v.range} optimal`,

  // Review fix (post-2.27.0): "act." used to be the PRIMARY value here,
  // permanently truncating "maintenant" for every card width. Restored
  // to the full word; "act." now only serves as the *Short fallback
  // the label-short-form resolver substitutes in when the long form
  // genuinely doesn't fit (see _resolveRangeScaleLabels()).
  "rangeScale.currentLabel": "maintenant",
  "rangeScale.currentLabelShort": "act.",
  "rangeScale.minLabel": "min",
  "rangeScale.maxLabel": "max",
  "rangeScale.footer": (v) => `Écart du jour ${v.span} · Min ${v.min} (${v.minTime}) · Max ${v.max} (${v.maxTime})`,
  "rangeScale.footerCompact": (v) => `Écart du jour ${v.span} · Min ${v.min} · Max ${v.max}`,

  "card.coldestRoom": "Pièce la plus froide",
  "card.warmestRoom": "Pièce la plus chaude",
  "card.driestRoom": "Pièce la plus sèche",
  "card.mostHumidRoom": "Pièce la plus humide",
  "card.lowestRoom": "Pièce la plus basse",
  "card.highestRoom": "Pièce la plus haute",
  "card.dailyMinimum": "Minimum journalier",
  "card.dailyMaximum": "Maximum journalier",
  "card.ariaOpen": (v) => `Ouvrir ${v.label} : ${v.name}`,

  "room.ariaOpen": (v) => `Ouvrir ${v.name}`,

  "rotator.hint": "Balayez pour changer de vue",

  "views.none": "Aucune vue disponible.",

  "empty.title": "Aucune donnée disponible.",
  "empty.hintNoRooms": "L'entité de moyenne configurée ne renvoie aucun nombre.",
  "empty.hintMissingRooms": (v) => `${v.count} ${v.count === 1 ? "entité configurée est manquante ou ne renvoie" : "entités configurées sont manquantes ou ne renvoient"} aucun nombre.`,
  "empty.hintNoRoomData": "Aucune entité de pièce configurée ne renvoie de nombre.",
};
