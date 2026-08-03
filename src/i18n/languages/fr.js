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
  // reachable once rooms.comparable requires >= 2 rooms, see buildCardDomainModel()).
  "adjective.warm": "chaudes",
  "adjective.cool": "fraîches",
  "adjective.humid": "humides",
  "adjective.dry": "sèches",
  "adjective.elevated": "élevées",
  "adjective.low": "basses",

  "value.homeAverage": "Moy. maison",
  "value.tooltip": (v) => `${v.label}: ${v.value}`,
  "value.tooltipNoLabel": (v) => `${v.value}`,
  "value.tooltipCalculated": (v) => `${v.label}: ${v.value} · calculé à partir des valeurs des pièces`,
  "value.tooltipCalculatedNoLabel": (v) => `${v.value} · calculé à partir des valeurs des pièces`,
  "value.ariaOpen": "Ouvrir la moyenne",
  "status.noData": "Aucune donnée",
  "availability.entityMissing": (v) => `Entité ${v.entity} introuvable.`,
  "availability.entitiesMissing": (v) => `${v.count} ${v.count === 1 ? "entité de pièce configurée est introuvable" : "entités de pièce configurées sont introuvables"} : ${v.entities}.`,
  "availability.valueUnavailable": "La valeur est actuellement indisponible.",
  "availability.noUsableRooms": "Aucune valeur de pièce configurée n'est actuellement exploitable.",
  "availability.incompatible": "Les sources configurées utilisent des types de mesure ou des unités incompatibles.",
  "availability.roomNoData": (v) => `${v.name} : aucune donnée. Ouvrir les détails.`,
  "availability.valueNoData": (v) => `${v.label} : aucune donnée`,

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

  // Keep the full label as the primary value; the layout resolver substitutes
  // the short form only when the rendered width requires it.
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

};
