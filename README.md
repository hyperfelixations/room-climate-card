# Room Climate Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Questions](https://img.shields.io/badge/Questions%3F-Ask%20here-41BDF5?logo=homeassistant&logoColor=white)](https://community.home-assistant.io/t/i-made-a-room-climate-card-for-home-assistant-and-would-love-some-feedback/1020037)

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=hyperfelixations&repository=room-climate-card&category=plugin)

A custom dashboard card for [Home Assistant](https://www.home-assistant.io/)
that shows the climate of one room or of your whole home: temperature,
humidity, CO₂, or PM2.5. It reads the current value from your sensors, puts it
on a scale with comfort and optimal ranges, and lists the individual rooms
below. The card follows your dashboard's light or dark theme.

![Room Climate Card with four modes and in dark and light mode](room-climate-card-four-modes.png)

## Features

- Four modes in one card: temperature, humidity, CO₂, and PM2.5, picked
  automatically from your sensors
- A whole-home value, either from one sensor of your own or averaged from the
  rooms you list
- A scale bar with comfort and optimal bands that stretches to fit the current
  values
- Room chips with a coldest/warmest comparison, wrapping into more rows as you
  add rooms — or laid out to a grid you choose
- Daily minimum/maximum views and a rate-of-change segment, when you have
  entities for them
- Colors and labels from a built-in profile — temperature comes with `indoor`,
  `outdoor`, and `fridge` — or from your own profile in YAML, in the color
  palette of your choice
- Rooms whose sensor is briefly unavailable stay on the card as `--` chips you
  can still tap
- Translated into 15 languages, following your Home Assistant language setting
- A `show:` block that takes parts off the card — the icon, either header line,
  the status label, the middle block, the chips — for a smaller card or a denser
  dashboard
- Plenty of optional YAML for views, bands, markers, footers, chips, the
  carousel, and tap/hold actions — see [Configuration](#configuration)

### Auto-slide in action

With more than one view enabled (here: the scale and room-comparison views), the card automatically rotates between them — swiping and tapping still work at any time:

![Card automatically rotating between the scale and room-comparison views](demo-auto-slide.gif)

## What you need

- **At least one sensor**: a main `entity`, one or more `rooms`, or both. The
  card reads the mode from a `device_class` of `temperature`, `humidity`,
  `carbon_dioxide`, or `pm25`. In practice these are `sensor.*` entities.
- **A current browser.** There is no backend part and no minimum Home Assistant
  version — but the layout uses CSS container queries, so any currently
  supported version of Chrome, Edge, Firefox, or Safari.

## Installation

### HACS

[![Open your Home Assistant instance and add this repository to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=hyperfelixations&repository=room-climate-card&category=plugin)

Add Room Climate Card as a custom repository using the button above or
manually:

1. Open HACS → the three-dot menu → **Custom repositories**.
2. Add `https://github.com/hyperfelixations/room-climate-card`, category
   **Dashboard**.
3. Install "Room Climate Card" and reload your browser.

### Manual

1. Download
   [`room-climate-card.js`](https://github.com/hyperfelixations/room-climate-card/releases/latest/download/room-climate-card.js)
   from the latest release and copy it into your Home Assistant `www/` folder
   (e.g. `www/room-climate-card.js`).
2. Add it as a dashboard resource: Settings → Dashboards → the three-dot menu → **Resources** → add `/local/room-climate-card.js` as a JavaScript module.
3. Add a card with `type: custom:room-climate-card` to a dashboard.

## Quickstart

The card picker knows this card. Start from **Add card**, pick a temperature,
humidity, CO₂, or PM2.5 entity, and the Room Climate Card appears under
**Community**, already set to the entity you picked and previewing your own
reading. Browsing the card list instead works too: the card starts out pointing
at a climate sensor it finds in your system.

From there the YAML below is what you edit. Pick the shape that matches what you
have — you need at least one sensor.

### One sensor

```yaml
type: custom:room-climate-card
entity: sensor.house_temperature
```

Tapping the large value opens that entity. There is no caption above it —
nothing else on the card needs telling apart — unless you set `entity_label`.

### One room

```yaml
type: custom:room-climate-card
rooms:
  - name: Kitchen
    short: KI
    entity: sensor.kitchen_temperature
```

The room name becomes the caption, and tapping the large value opens that
room. Its chip is hidden by default, since it would just repeat the big number —
set `show: {rooms: true}` if you want it anyway.

Only entities Home Assistant knows count here. If you add a second room and
mistype its id, this stays a one-room card and the unknown id is named under
the title.

### Several rooms

```yaml
type: custom:room-climate-card
rooms:
  - name: Kitchen
    short: KI
    entity: sensor.kitchen_temperature
  - name: Bedroom
    short: BE
    entity: sensor.bedroom_temperature
```

The large value is the average of the rooms, so there is nothing to open by
tapping it. The chips still open their own rooms.

### One sensor plus rooms

```yaml
type: custom:room-climate-card
entity: sensor.house_temperature
rooms:
  - name: Kitchen
    short: KI
    entity: sensor.kitchen_temperature
  - name: Bedroom
    short: BE
    entity: sensor.bedroom_temperature
  - name: Living Room
    short: LR
    entity: sensor.living_room_temperature
```

Your sensor gives the large value; the rooms give the chips, the
coldest/warmest comparison, and the scale markers. If your main sensor drops
out for a while, the card averages the rooms instead.

See [Configuration](#configuration) below for every available option.

## Join the community

Got the card running? There is a place to talk about it. The Home Assistant
forum thread is where setups, questions and ideas for this card are discussed,
and the Discord is where that happens as a conversation. Everything else is for
following along as new things are built.

[![Questions](https://img.shields.io/badge/Questions%3F-Ask%20here-41BDF5?logo=homeassistant&logoColor=white)](https://community.home-assistant.io/t/i-made-a-room-climate-card-for-home-assistant-and-would-love-some-feedback/1020037)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/zfGKCVEvwe)
[![GitHub](https://img.shields.io/badge/GitHub-Follow-181717?logo=github&logoColor=white)](https://github.com/hyperfelixations)
[![YouTube](https://img.shields.io/badge/YouTube-Subscribe-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@hyperfelixations)
[![Instagram](https://img.shields.io/badge/Instagram-Follow-E4405F?logo=instagram&logoColor=white)](https://www.instagram.com/hyperfelixations/)

Ideas and bug reports are welcome as
[issues](https://github.com/hyperfelixations/room-climate-card/issues) too.

## Configuration

Everything except a source is optional — leave an option out and you get the
default.

### Top-level options

#### Data sources

| Option | Default | What it does |
| --- | --- | --- |
| `entity` | none | Your main or whole-home sensor. Its `device_class` decides whether this is a temperature, humidity, CO₂, or PM2.5 card; for `°C`, `°F`, `K` and `%` the unit alone is enough. Leave it out and the rooms take over: one room is used directly, several are averaged. |
| `rooms` | `[]` | Your room sensors. From two rooms with values on, you get the comparison features and the `extremes` view. Each room needs its own `entity` — see [Room entries](#room-entries). |
| `range_entity` | none | A sensor holding today's range as its state, with `minimum` and `maximum` attributes for the two values. Add `minimum_timestamp` and `maximum_timestamp` if you also want the times — `minimum_zeitpunkt` and `maximum_zeitpunkt` work too. Only `minimum` and `maximum` are needed; where a time is missing, the card just shows the value. |
| `trend_entity` | none | A rate-of-change sensor in a unit that matches, for example `°C/h`. You get a rising, stable, or falling arrow above the large value, plus the rate in the scale footer. |
| `classification` | `auto` + metric default | Decides the level names and where each reading sits on the scale; the [palette](#palettes) turns that into a colour. A plain string such as `outdoor` picks a built-in profile. See [Classification](#classification). |
| `palette` | `pastel` | The colors the card classifies with. `pastel` is the card's own soft ramp, `vivid` a saturated one. You can also name any color, or write out a palette of your own. See [Palettes](#palettes). |

Small changes count as stable rather than as a trend, so the arrow does not
flicker — for temperature, anything within about `±0.1 °C/h`. The arrow appears
above the value; the signed rate needs the main scale footer, which in turn
needs at least two rooms with values.

#### Text, language, and number display

| Option | Default | What it does |
| --- | --- | --- |
| `title` | automatic | Replaces the card title, which otherwise names the measurement — “Temperature”, for example, and decides what happens when it is too long for the card. `title: ""` removes the line. See [The two header lines](#the-two-header-lines). |
| `subtitle` | automatic | Replaces the line under the title, in the same shape. `subtitle: ""` removes the line. See [The two header lines](#the-two-header-lines). |
| `entity_label` | automatic | Sets the small caption above the large value. `entity_label: ""` removes it. Left out, a single-room card uses that room's name, a card with only `entity` has no caption, and a card with rooms uses the translated "Home avg." caption. |
| `icon` | automatic | Pins the header icon to an `mdi:*` icon of your choice, for example `mdi:home-thermometer`. Otherwise it follows the current value. |
| `decimals` | mode-dependent | Sets `0`, `1`, or `2` decimal places for the large value, the room chips, the daily minimum/maximum, the spread, and the trend. Defaults: `0` for CO₂, `1` for the others. Scale and band labels stay whole numbers. |
| `language` | `auto` | Forces one of `en`, `de`, `nl`, `fr`, `it`, `es`, `ru`, `pl`, `uk`, `ko`, `ja`, `zh`, `nb`, `sv`, `lv`. `auto` follows your Home Assistant language. |

#### What the card shows

The `show:` block decides which PARTS of the card are drawn. Everything in it is
on unless you say otherwise, so a card without a `show:` block looks exactly the
way it does in the pictures above.

```yaml
show:
  icon: false
  pill: false
```

| Part | Default | What it is |
| --- | --- | --- |
| `accent_line` | `true` | The colored bar along the top edge, in the color of the current reading. |
| `icon` | `true` | The icon in the top left. Hiding it moves the title to the card's left edge. |
| `title` | `true` | The card title. |
| `subtitle` | `true` | The line under the title. |
| `entity_label` | `true` | The small caption above the large value. |
| `pill` | `true` | The status label in the top right — “Optimal”, “Warm”, and so on. |
| `panel` | `true` | The middle block: the large value and the views beside it. |
| `rooms` | `auto` | The room chips. `auto` hides the one chip that would just repeat the large value on a single-room card and shows chips otherwise; `true` always shows them; `false` never does. |
| `unavailable_rooms` | `true` | A neutral, tappable `--` chip for a room whose sensor is unavailable or non-numeric. `false` leaves it out. A room whose entity Home Assistant does not know, or whose unit does not fit, is not shown as a chip at all. |

Hiding a part is a layout decision and nothing more: every room you configure
counts towards the average, the coldest/warmest comparison, the spread and the
scale markers whether or not anything of it is drawn.

Turn off the icon, both header lines and the pill together and the top row goes
with them, so what is left moves up to the card's edge. Turn off everything —
including the panel and the chips — and the card says so rather than showing you
an empty box.

Two of these have a second effect worth knowing. A card without a title has no
visible name of its own, so the heading around it on your dashboard is what names
it; a screen reader reaches the large value either way, since that carries its
own description. And a card without the panel has no views, which leaves the
carousel and its options with nothing to do.

`show_rooms: auto | true | false` and `unavailable_values: show | hide` are the
older spellings of `show.rooms` and `show.unavailable_rooms`. Both still work.
Where a card writes both, the `show:` block decides.

#### Room-chip display

| Option | Default | What it does |
| --- | --- | --- |
| `room_sort` | `value_asc` | Orders the chips by `value_asc`, `value_desc`, `name`, or the `configured` order. Sorting is display only — it does not change which room counts as coldest or warmest. |
| `room_label` | `auto` | Chooses the chip text: `auto` and `short` use `rooms[].short`; `name` uses `rooms[].name`. |
| `room_columns` | automatic | Sets `1`–`20` grid columns. If `room_rows` is omitted, enough rows are added automatically. |
| `room_rows` | automatic | Sets `1`–`20` grid rows. If `room_columns` is omitted, enough columns are added automatically. |

Setting both `room_columns` and `room_rows` caps how many chips are drawn — the
first ones in your `rooms:` order. A room left out of the grid still counts,
exactly as a room hidden by `show.rooms` does.

Which layouts show chips, for each value of `show.rooms`:

| Your sources | `auto` | `true` | `false` |
| --- | --- | --- | --- |
| Only `entity` | hidden | hidden | hidden |
| One room | hidden | shown | hidden |
| Several rooms | shown | shown | hidden |
| `entity` plus rooms | shown | shown | hidden |

`--` placeholders follow the same rules and sit after the rooms that do have a
value. They are tappable, but a value the card cannot read is left out of every
calculation.

#### Card chrome, carousel, and actions

| Option | Default | What it does |
| --- | --- | --- |
| `auto_slide` | `true` | `false` stops automatic movement between views. It does not disable manual swiping. |
| `swipe` | `true` | `false` disables horizontal swipe navigation. It does not stop automatic movement or tap/hold actions. |
| `rotation_seconds` | `14` | Seconds a view remains visible before automatic movement. Accepted range: `1`–`3600`. |
| `slide_seconds` | `1` | Duration of the slide transition. Accepted range: `0.1`–`10`. |
| `hide_footer` | `false` | `true` hides every view's footer at once. To hide one view's footer, use that view's own `show_footer`. |
| `tap_action` | `more-info` | What a tap on the large value or a chip does. |
| `hold_action` | `more-info` | The same for a long press. |
| `views` | automatic | Chooses which views appear, in which order, with which options. Write it and it is the full list — see [Views](#views). |
| `start_view` | first active view | The view the card starts on: `range`, `range_scale`, `scale`, or `extremes`. If that one is not available, the first active view is used. |

`auto_slide` and `swipe` are independent. For example, this creates a
manually swipeable carousel that never advances on its own:

```yaml
auto_slide: false
swipe: true
```

### Room entries

Each item under `rooms:` supports:

| Room field | Required | What it does |
| --- | --- | --- |
| `entity` | yes | Unique room sensor entity ID. |
| `name` | no | Full room name used in tooltips, extrema, and when `room_label: name` is selected. Falls back to `short`, then to the entity ID. |
| `short` | no | Short chip label. Falls back to `name`, then to the entity ID. |
| `tap_action` | no | Action for this room only. Inherits the card-level `tap_action` when omitted or invalid. |
| `hold_action` | no | Hold action for this room only. Inherits the card-level `hold_action` when omitted or invalid. |

Example:

```yaml
tap_action:
  action: more-info
hold_action:
  action: none

rooms:
  - name: Kitchen
    short: KI
    entity: sensor.kitchen_temperature
    tap_action:
      action: navigate
      navigation_path: /lovelace/kitchen
```

Accepted `action` values are `more-info`, `toggle`, `perform-action`,
`navigate`, `url`, `assist`, and `none`. Other action-specific fields are
passed to Home Assistant. The default is `more-info`; `none` disables that
interaction.

### Views

Without a `views:` section the card decides for itself:

- `range` appears when a usable `range_entity` is available.
- `scale` appears by default.
- `extremes` appears with at least two usable room values.
- `range_scale` is optional and does not appear automatically.

Available view types:

| View | Availability | Purpose |
| --- | --- | --- |
| `range` | Usable `range_entity` | Two cards for today's minimum and maximum. |
| `range_scale` | Usable `range_entity` with valid `minimum`/`maximum` | Alternate scale with current, daily-minimum, and daily-maximum markers. It stays off when `views:` is omitted, but listing it explicitly enables it. |
| `scale` | Always available | Main dynamic scale with configurable average, extrema, or per-room markers. |
| `extremes` | At least two usable room values | Coldest and warmest room cards. |

A string and an object without `enabled` both explicitly enable the listed
view:

```yaml
views:
  - range
  - scale
  - extremes
```

Use the object form to set `enabled` or `options`:

```yaml
views:
  - type: range
    enabled: auto
  - type: range_scale
  - type: scale
  - type: extremes
    enabled: auto
```

`enabled` accepts `true`, `false`, or `auto`. Leaving it out means `true`; use
`auto` to let the card decide as it would without a `views:` section. A view you
enable still needs its entities to actually appear.

Once you write a `views:` section, it is the full list: the card shows exactly
those views, in exactly that order, and adds nothing on its own.

#### View-specific options

Options belong inside the corresponding `views:` entry.

| View | Option | Values | Default | Effect |
| --- | --- | --- | --- | --- |
| `range` | `show_time` | `true` / `false` | `true` | Hides the min/max timestamps but keeps the values. |
| `range_scale` | `show_comfort_band` | `true` / `false` | `true` | Shows or hides the comfort band. This view has no separate comfort label. |
| `range_scale` | `show_optimal_band` | `true` / `false` | `true` | Shows or hides both the optimal band and its label. |
| `range_scale` | `show_footer` | `true` / `false` | `true` | Whether this view draws a footer at all. Global `hide_footer: true` always wins. |
| `range_scale` | `footer` | `detailed` / `compact` | `detailed` | Which form the footer takes: with the min/max times, or without them. |
| `scale` | `show_comfort_band` | `true` / `false` | `true` | Shows or hides both the comfort band and its label. |
| `scale` | `show_optimal_band` | `true` / `false` | `true` | Shows or hides both the optimal band and its label. |
| `scale` | `show_footer` | `true` / `false` | `true` | Shows or hides the comfort/spread/trend footer under this scale. It needs at least two rooms with values, and `hide_footer: true` overrides it. The trend arrow above the value is separate. |
| `scale` | `markers` | `extremes` / `average` / `all` | `extremes` | `extremes` shows the lowest room, average, and highest room (the default); `average` shows only the average; `all` shows a smaller marker for every currently valid configured room plus a larger average marker. |
| `extremes` | `show_value` | `true` / `false` | `true` | Hides the numbers but keeps the coldest/warmest labels and the room names. |

Options apply to their own view only, and you can combine them freely:

```yaml
views:
  - type: range_scale
    options:
      show_comfort_band: false
      show_optimal_band: true
      footer: compact

  - type: scale
    options:
      show_comfort_band: false
      show_optimal_band: false
      show_footer: false
      markers: average
```

Hiding a band hides the band and nothing else. The thresholds behind it decide
the colors, the classification, and where the markers sit whether or not the band
is drawn.

### Classification

With no `classification` option, the card uses `source: auto`: a live entity
classification is accepted only when both `value_color` and `value_level` are
present and valid. Otherwise the complete numeric fallback profile is used.

Temperature uses `indoor` by default. Select the built-in outdoor profile with
the short form:

```yaml
classification: outdoor
```

The outdoor profile uses an optimal band of `18–22 °C` and a comfort band of
`14–26 °C`. Its scale has no fixed range: both ends follow whatever your
sensors currently report, which is what you want outdoors, where summer and
winter are nowhere near each other. A band that is completely off the current
scale is hidden until the values reach it. A profile of your own gets the same
axis behaviour with `scale.anchor_scale: false` (see
[Classification](#classification)).

Select the built-in fridge profile the same way, for monitoring an appliance
instead of a room:

```yaml
classification: fridge
```

The fridge profile aims at food safety rather than comfort: an optimal band of
`3–5 °C` and a comfort band of `1–6 °C`, with more room above the band than
below, because getting too warm is what spoils food. Its scale stays fixed at
`0–8 °C` — a fridge does not need a scale that follows the weather.

The header icon follows the active profile unless you set `icon` yourself:
temperature moves through thermometer, fire, and snowflake icons; humidity
through the water-percent variants; CO₂ switches to an alert icon at its
highest tier; and PM2.5 goes from molecule through haze and dust to alert.

The full object form gives you four choices:

```yaml
# Complete entity attributes, then the selected built-in fallback.
classification:
  source: auto
  profile: outdoor

# Entity attributes only. Incomplete attributes stay neutral.
classification:
  source: entity

# Ignore entity classification and force the built-in profile.
classification:
  source: profile
  profile: outdoor
```

`auto` and `profile` use the metric's default profile when `profile` is
omitted. `outdoor` and `fridge` exist for temperature only; `indoor` is the
default profile for temperature, humidity, CO₂, and PM2.5.

A custom profile is authoritative: it ignores entity classification and owns
tiers, bands, base scale, and icons together.

```yaml
classification:
  source: custom
  unit: "°C"
  comparison: ">="

  bands:
    comfort:
      min: 14
      max: 26
    optimal:
      min: 18
      max: 22

  scale:
    min: 10
    max: 30
    step: 1

  icons:
    - min: 35
      icon: mdi:fire-alert
    - min: 30
      icon: mdi:thermometer-high
    - min: 14
      icon: mdi:thermometer
    - min: 5
      icon: mdi:thermometer-low
    - default: true
      icon: mdi:snowflake

  tiers:
    - min: 30
      score: 6
      level: Very hot
      color: "#B85F67"
      zone: outside
    - min: 26
      score: 5
      level: Warm
      color: "#C0A752"
      zone: outside
    - min: 22
      score: 4
      level: Slightly warm
      color: "#9DA85A"
      zone: comfort
    - min: 18
      score: 3
      level: Comfortable
      color: "#79A86C"
      zone: optimal
    - min: 14
      score: 2
      level: Slightly cool
      color: "#69A78B"
      zone: comfort
    - default: true
      score: 1
      level: Cold
      color: "#8192C8"
      zone: outside
```

Custom-profile rules:

- `unit` must be a unit the card knows for this measurement. Temperature takes
  Celsius, Fahrenheit, or Kelvin, and the whole profile is converted to
  whatever unit your sensors use.
- `comparison` is `>=` by default and may be `>`.
- Tier `min` values must be unique and strictly descending. Exactly one final
  `{default: true}` tier is required.
- Every tier requires a non-empty `level`, a numeric `score`, and
  `zone: optimal | comfort | outside | invalid`.
- `color` is optional, and what you do with it decides what `score` means.
  Give a tier a safe 3/4/6/8-digit hex `color` and it uses that color, with
  `score` free to be any number you like. Leave `color` out and the tier takes
  its color from the [palette](#palettes), with `score` saying how far the tier
  is from the right value: `0` is optimal, positive is too much, negative is too
  little. A whole number, descending along with the thresholds. You can mix the
  two — paint the ends by hand and let the palette fill in the middle.
- How far a profile reaches is simply its own furthest tier, so a profile with
  only one direction to go wrong — CO₂ has no "too little" — just stops at `0`,
  and a profile with twenty steps needs no extra option to be shown in a palette
  with five.
- The optimal band must be inside the comfort band. `scale.step` must be
  greater than zero.
- `scale` describes the axis the card draws, and it comes in two shapes. Give
  it a `min` and a `max` for an axis that always covers that range and grows
  outwards when readings go further — that is what `indoor` and `fridge` do.
  Or leave both out and add `anchor_scale: false` for an axis that follows the
  readings themselves, which suits a measurement whose sensible range moves
  with the season — that is what `outdoor` does:
  ```yaml
  scale:
    step: 1
    anchor_scale: false
  ```
  The two are alternatives: a `min` or `max` alongside `anchor_scale: false`
  is an error.
- Optional `scale.headroom` must be non-negative and applies to both shapes.
  `scale.one_sided` is a boolean for measurements with no "too little" end,
  such as CO₂; it holds the axis at `scale.min` and therefore needs the
  anchored shape.
- Bands are drawn as far as the axis reaches. A comfort band wider than the
  current axis fills the bar, and the rest of it appears as readings move and
  the axis grows.
- `icons` is optional and has the same shape for every measurement: a
  descending list of `{min, icon}` tiers with a final `{default: true,
  icon: ...}` entry, which is `tiers` without the color, level, and zone
  fields. You choose the thresholds and the icons, and they follow the profile's
  `comparison` just like the tiers do:
  ```yaml
  icons:
    - min: 60
      icon: mdi:water-percent-alert
    - min: 30
      icon: mdi:water-percent
    - default: true
      icon: mdi:water-minus
  ```
  Leave `icons` out and the card shows the measurement's own header icon for
  every reading.
- Optional `valid_range` accepts `min`, `max`, `min_inclusive`, and
  `max_inclusive`.
- A mistake inside `classification` stops the card with an error naming the
  exact option, so a typo never quietly changes what a color means.

### Palettes

A profile decides *where* a reading sits — how far it is from the right value,
and in which direction — and the palette decides what those places look like.
The two are separate, so you can keep the built-in profiles and still change
every color on the card with one line:

```yaml
palette: vivid
```

Four palettes ship with the card:

| Name | What it is for |
| --- | --- |
| `pastel` | The default: a soft ramp running from blue through green to red. |
| `vivid` | The same journey in saturated colors — easier to read on a bright wall panel, or beside strongly colored cards. |
| `color-vision` | For color vision deficiency, of any kind. Its ends are blue-violet and amber, a pair that stays apart for protanopes, deuteranopes and tritanopes alike, instead of green and red, the pair that does not. Also answers to `protan-deutan`, `protan`, `deutan` and `tritan`. |
| `signal` | Green, amber, red — a traffic light rather than a gradient, for a dashboard you read from across the room. Both directions use the same pair, so it says how far a reading is from where it should be rather than which way. It is built from green and red, so `color-vision` is the better choice if that pair is hard for you. |

You can also ask for a ramp in a single color, by name or as a hex:

```yaml
palette: teal
```

Any of the 148 CSS color names works, as does `palette: "#3366CC"`. The color you
name is the middle of the ramp, exactly as you wrote it; from there the ramp runs
paler towards “too little” and deeper towards “too much”, keeping your color the
whole way. A color with no hue of its own — `gray`, `white`, `black` — gives a
grayscale ramp, which stays readable with any kind of color vision.

Not every color has room in both directions: nothing is paler than `white`, and
`gold` is already so light that its palest steps sit close together. Both
directions are the same length, so a side with nowhere left to go repeats the
color it ended on.

Two or three colors, joined by hyphens, give you a ramp that travels between
them:

```yaml
palette: blue-red            # blue at "too little", red at "too much"
palette: blue-green-red      # and green in the middle
```

The first color is the far end of “too little”, the last the far end of “too
much”, and with three the middle one is the color for a reading that is where it
should be. You get the colors you named, exactly as you wrote them; everything
between is filled in. Hex works too: `palette: 1DB85D-FD9808`.

The ramp travels the short way round the color wheel, so `blue-red` runs through
violet. If you want white in the middle, say so: `blue-white-red`.

Four or more is not supported, and the card says so.

A name that ships as a palette always wins over a color of the same name, and a
single color wins over the hyphenated form. That matters for five CSS colors you
can spell either way: `orangered` is one color, `orange-red` is a ramp from
orange to red. The same goes for `blueviolet`, `greenyellow`, `limegreen` and
`yellowgreen`.

Whichever you pick, the card fits it to the background it is standing on. A
dark theme, a light theme, a card you have colored yourself — the ramp moves
just far enough to be read there, in brightness and saturation only, so `teal`
arrives as teal. That covers the four palettes above and every ramp built from
a color you name; a palette you write out yourself keeps the ramp you typed.

Three small places put a color on a soft tint of itself: the status pill in the
top right, the icon badge, and the little mark on a room chip. Where that would
swallow the color, the text takes a slightly deeper or lighter shade of the same
color so it stays readable. The scale, the room chips and the line across the
top always show the color itself.

#### Writing your own

A palette has a middle and two wings. `optimal` is the color for a reading that
is where it should be, `above` runs outwards from there towards “too much” and
`below` outwards towards “too little”, so the first entry of each is one step off
optimal:

```yaml
palette:
  optimal: 1DB85D
  above: FD9808, EE2046
  below: 6EC1E4, 2A6FDB
```

**Only `optimal` is required.** Leave a wing out and the card simply does not
color that direction — useful for CO₂ and PM2.5, which have no “too little” at
all. Leave both out and the whole card is that one color:

```yaml
palette:
  optimal: teal
```

Each color can be written the way you have it to hand: `1DB85D`, `"#1DB85D"`,
`#0F8` in quotes, or a CSS color name such as `teal`. A wing can be a list, a
single color, or several separated by commas.

> **Watch the `#`.** In YAML a `#` after a space starts a comment, so
> `optimal: #1DB85D` leaves the value empty. Write it without the `#`, or put it
> in quotes. If you do hit it, the card says so rather than just calling the
> value invalid.
>
> **A color written only in digits needs exactly six of them.** `123456`,
> `080808` and `008000` all work unquoted. Anything shorter or longer has to be
> quoted — `"080"`, `"#0808080"` — because `080` could mean `#000080` or `#008800`
> and the card will not guess. Quoting is also the only way to be sure with more
> than six digits: `0808080` unquoted arrives as `808080` and is read as that
> color.

The wings do not have to be the same length as each other, or the same length as
the profile you are using. However many colors you give it, the first step away
from the middle already changes color, and the furthest reading gets your
furthest color.

`invalid` is optional. It belongs to a reading the card considers physically
impossible — a humidity of 130 %, say. Leaving it out is the normal thing to do,
and a neutral grey fills in.

A value the entity classifies itself uses its own `value_color`, and shows the
neutral color when it supplies none. The palette applies to the card's own
classification, not to one an integration provided.

### The two header lines

The title names the measurement — “Temperature”, say — and under it the card
writes a sentence about what it is showing: which rooms are comfortable, which
one stands out, or why there is no data. You can replace either, and for either
you can decide what happens when it is longer than the card is wide. Both take
the same four shapes:

```yaml
title: Ground floor
subtitle: Ground floor sensors
```

```yaml
subtitle: wrap
```

```yaml
subtitle:
  text: Ground floor sensors
  overflow: wrap
```

```yaml
title: ""
```

`overflow: wrap` lets a line run onto as many lines as it needs, and everything
below moves down to make room; `clip` cuts it off with an ellipsis. The two lines
start from different defaults: the title wraps, the subtitle clips.

Writing `clip` or `wrap` on its own sets the overflow and leaves the text alone —
which is why those two words cannot be used as the text on their own. If you
really want one of them as the text, use the block form: `title: {text: wrap}`.

An empty string removes the line entirely, and so does `show: {title: false}`.

One exception, and it belongs to the subtitle: when the card has no data to show,
that line explains why, whatever you wrote there and even with `show: {subtitle:
false}` set. It says your text again as soon as data comes back. A card showing
`--` under a line that says nothing about it would be the wrong kind of quiet.

### What the card checks, and what it decides for you

A mistake that would make the card meaningless stops it with an error naming
the option: no source at all, a `rooms:` that is not a list, a room without an
entity, duplicate room entities, or a malformed `entity`. A mistake in a purely
cosmetic option falls back to the default, and an unknown `views:` entry, view
option or `show:` key is skipped with a note in the browser console.

Three things the card decides on its own:

- which metric it is showing, and the unit it displays;
- converting a profile written in one unit to the unit your sensors use;
- how far the scale stretches beyond a profile's range to fit your values.

Levels and bands come from one place: the `classification` option above. A
profile owns them together, so you switch profiles rather than overriding
single pieces. Colors come from the [palette](#palettes), unless a tier names
one for itself.

### Full example

This example shows how the different groups of options can be combined. You
only need to keep the parts you want to customize.

```yaml
type: custom:room-climate-card
entity: sensor.house_temperature
range_entity: sensor.house_temperature_daily_range
trend_entity: sensor.house_temperature_trend
classification: indoor

title: Indoor climate
entity_label: Home average
decimals: 1
language: auto

rooms:
  - name: Kitchen
    short: KI
    entity: sensor.kitchen_temperature
  - name: Bedroom
    short: BE
    entity: sensor.bedroom_temperature
room_sort: name
room_label: name
room_columns: 4

show:
  rooms: true
  unavailable_rooms: true
  pill: false

auto_slide: false
swipe: true
rotation_seconds: 14
slide_seconds: 1

start_view: scale
views:
  - type: range
    options:
      show_time: false
  - type: range_scale
    options:
      show_comfort_band: true
      show_optimal_band: true
      footer: compact
  - type: scale
    options:
      show_comfort_band: false
      show_optimal_band: true
      show_footer: true
      markers: average
  - type: extremes
    options:
      show_value: true
```

## Known limitations

- There is no visual editor — everything is YAML. Start with the
  [Quickstart](#quickstart) and use the [Configuration](#configuration)
  reference from there.
- Daily minimum/maximum and trend need their own entities. The card reads what
  Home Assistant reports right now; it does not look at history itself. Those
  entities are usually template sensors — I plan to publish the ones I use.
- One card shows one kind of measurement. Rooms measuring something else, or
  using a unit that does not fit, are left out. If there is no main entity and
  the rooms disagree about what they measure, the card says so instead of
  picking a winner.

## Troubleshooting

**The card doesn't appear after installing.**
Confirm the dashboard resource was actually added (Settings → Dashboards →
the three-dot menu → **Resources**) and points at the right path/module
type, then do a hard browser reload (see below). After a HACS install, a
normal Home Assistant restart or resource re-registration is usually
enough; a manual install needs the resource step from
[Installation](#installation) done explicitly.

**Changes don't show up, or the card looks outdated after an update.**
Browsers aggressively cache dashboard resources. Hard-reload the dashboard
tab (Ctrl+Shift+R / Cmd+Shift+R), or clear the browser cache for your Home
Assistant URL, after installing or updating the card.

**"Custom element doesn't exist: room-climate-card".**
Check the card's `type:` — it must be exactly `custom:room-climate-card`
(the `custom:` prefix is required), and the resource must have loaded
without a console error.

**The card shows “No data” and `--` as its large value.**
None of your sources has a usable number right now, or the card cannot tell
what they measure. The line under the title says which. Three different
situations:

- **A typo, or an entity that no longer exists.** Home Assistant does not know
  the id at all, so the card does not treat it as a source: no chip, and the id
  is named under the title. A card with one working room and one mistyped one
  is a one-room card.
- **A sensor that is `unavailable`, `unknown`, or reporting something that is
  not a number.** The entity exists, so it holds its place on the card as a `--`
  chip. Set `show.unavailable_rooms: false` to leave those chips out.
- **A reading that cannot be real**, such as 800 % humidity. The card says so
  rather than showing it.
- **A sensor measuring something else, or using a unit that does not fit.** It
  is left out of this card.

If everything looks right, check that your sensors have a `device_class` of
`temperature`, `humidity`, `carbon_dioxide`, or `pm25`. The line under the title
names the sensor whenever the fix is on the sensor rather than in the card; if it
is long, `subtitle: wrap` shows all of it.

**"… needs a device_class", and the sensor reads ppm or µg/m³.**
Those two units belong to several measurements in Home Assistant — `ppm` to CO₂
but also to carbon monoxide and volatile organic compounds, `µg/m³` to PM1,
PM2.5, PM4, PM10 and more — so the card will not guess which one it is looking
at. Add the matching `device_class` to the sensor (`carbon_dioxide` or `pm25`)
and the card picks it up. Temperature and humidity sensors are unaffected:
their units belong to one measurement each.

**Something broke after updating the card.**
Hard-reload the dashboard first (see above — a stale cached version is the
most common cause). If the problem persists, open your browser's developer
console and check for an error message before reporting it.

If none of this helps, please open a
[GitHub issue](https://github.com/hyperfelixations/room-climate-card/issues) and include:

- your Home Assistant version;
- the card version (open your browser's developer console, type
  `roomClimateCardVersion`, and press Enter);
- your browser and its version;
- the relevant part of your card's YAML configuration;
- any error message from the browser console.

## Links

- [Releases](https://github.com/hyperfelixations/room-climate-card/releases) — every
  version, with its notes and its download
- [Issues](https://github.com/hyperfelixations/room-climate-card/issues)
- [License](LICENSE) (MIT)
- [Testing](TESTING.md) — how the card is tested, and how to run any part of it
- [Home Assistant forum thread](https://community.home-assistant.io/t/i-made-a-room-climate-card-for-home-assistant-and-would-love-some-feedback/1020037)
  — questions and discussion about this card
- [Discord](https://discord.gg/zfGKCVEvwe) — the same, as a conversation
- Elsewhere: [GitHub](https://github.com/hyperfelixations),
  [YouTube](https://www.youtube.com/@hyperfelixations), and
  [Instagram](https://www.instagram.com/hyperfelixations/)
