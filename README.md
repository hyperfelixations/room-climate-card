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
- Daily minimum/maximum views and a rate-of-change display
- Built-in classification profiles for every measurement, including `indoor`,
  `outdoor`, and `fridge` for temperature, plus custom profiles in YAML
- Built-in color palettes, ramps made from one to three colors, and custom
  palettes in YAML
- Translated into 15 languages, following your Home Assistant language setting
- Flexible layouts through the `show:` block, from the full card to compact
  combinations of headers, values, views, and room chips
- Plenty of optional YAML for views, bands, markers, footers, chips, the
  carousel, and tap/hold actions — see [Configuration](#configuration)

### Auto-slide in action

With more than one view enabled (here: the scale and room-comparison views), the card automatically rotates between them. You can swipe or tap at any time:

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
reading. You can also select the card from the full list, where it previews a
climate sensor found in your system.

From there the YAML below is what you edit. Pick the shape that matches what you
have — you need at least one sensor.

### One sensor

```yaml
type: custom:room-climate-card
entity: sensor.house_temperature
```

Tapping the large value opens that entity. Set `entity_label` to add a caption
above the value.

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

The large value is the average of the rooms. Each chip opens its room sensor.

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
coldest/warmest comparison, and the scale markers. Usable room values provide
the average while the main sensor is unavailable.

See [Configuration](#configuration) below for every available option.

## Join the community

The Home Assistant forum thread is where setups, questions and ideas for this
card are discussed, and the Discord is where that happens as a conversation.
The remaining links are for following along as new things are built.

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
| `classification` | `auto` + metric default | Sets the level names, bands, scale, and icons. A plain string such as `outdoor` picks a built-in profile. See [Classification](#classification). |
| `palette` | `pastel` | The colors the card classifies with. `pastel` is the card's own soft ramp, `vivid` a saturated one. You can also name any color, or write out a palette of your own. See [Palettes](#palettes). |

The trend arrow appears above the value. Its signed rate appears in the main
scale footer when at least two rooms have values.

#### Text, language, and number display

| Option | Default | What it does |
| --- | --- | --- |
| `title` | automatic | Replaces the card title, which otherwise names the measurement (“Temperature”, for example), and decides what happens when the line is too long for the card. `title: ""` removes the line. See [The two header lines](#the-two-header-lines). |
| `subtitle` | automatic | Replaces the line under the title, in the same shape. `subtitle: ""` removes the line. See [The two header lines](#the-two-header-lines). |
| `entity_label` | automatic | Sets the small caption above the large value. `entity_label: ""` removes it. Left out, a single-room card uses that room's name, a card with only `entity` has no caption, and a card with rooms uses the translated "Home avg." caption. |
| `icon` | automatic | Pins the header icon to an `mdi:*` icon of your choice, for example `mdi:home-thermometer`. Otherwise it follows the current value. |
| `decimals` | mode-dependent | Sets `0`, `1`, or `2` decimal places for the large value, the room chips, the daily minimum/maximum, the spread, and the trend. Defaults: `0` for CO₂, `1` for the others. Scale and band labels stay whole numbers. |
| `language` | `auto` | Forces one of `en`, `de`, `nl`, `fr`, `it`, `es`, `ru`, `pl`, `uk`, `ko`, `ja`, `zh`, `nb`, `sv`, `lv`. `auto` follows your Home Assistant language. |

#### What the card shows

Use `show:` to fit the card to your dashboard. Each entry controls one layout
part; omitted entries use the defaults shown below.

```yaml
show:
  icon: false
  pill: false
```

| Part | Default | What it is |
| --- | --- | --- |
| `accent_line` | `true` | The colored bar along the top edge, in the color of the current reading. |
| `icon` | `true` | The icon in the top left. |
| `title` | `true` | The card title. |
| `subtitle` | `true` | The line under the title. |
| `entity_label` | `true` | The small caption above the large value. |
| `pill` | `true` | The status label in the top right — “Optimal”, “Warm”, and so on. |
| `panel` | `true` | The middle block: the large value and the views beside it. |
| `rooms` | `auto` | The room chips. `auto` hides the one chip that would just repeat the large value on a single-room card and shows chips otherwise; `true` always shows them; `false` never does. |
| `unavailable_rooms` | `true` | Shows a neutral `--` chip for an unavailable or non-numeric room sensor. Set it to `false` to omit these chips. |

#### Room-chip display

| Option | Default | What it does |
| --- | --- | --- |
| `room_sort` | `value_asc` | Orders the chips by `value_asc`, `value_desc`, `name`, or the `configured` order. |
| `room_label` | `auto` | Chooses the chip text: `auto` and `short` use `rooms[].short`; `name` uses `rooms[].name`. |
| `room_columns` | automatic | Sets `1`–`20` grid columns. If `room_rows` is omitted, enough rows are added automatically. |
| `room_rows` | automatic | Sets `1`–`20` grid rows. If `room_columns` is omitted, enough columns are added automatically. |

Setting both `room_columns` and `room_rows` limits the grid to that many chips,
selected in the order written under `rooms:`.

#### Card chrome, carousel, and actions

| Option | Default | What it does |
| --- | --- | --- |
| `auto_slide` | `true` | `false` stops automatic movement between views. |
| `swipe` | `true` | `false` disables horizontal swipe navigation. |
| `rotation_seconds` | `14` | Seconds a view remains visible before automatic movement. Accepted range: `1`–`3600`. |
| `slide_seconds` | `1` | Duration of the slide transition. Accepted range: `0.1`–`10`. |
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
| `range_scale` | Usable `range_entity` with valid `minimum`/`maximum` | Optional scale with current, daily-minimum, and daily-maximum markers. Add it to `views:` to enable it. |
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
`auto` for the availability rules in the table above. Each view also needs the
listed data.

Once you write a `views:` section, it is the full list: the card shows exactly
those views, in exactly that order, and adds nothing on its own.

#### View-specific options

Options belong inside the corresponding `views:` entry.

| View | Option | Values | Default | Effect |
| --- | --- | --- | --- | --- |
| `range` | `show_time` | `true` / `false` | `true` | Displays timestamps with the minimum and maximum values. |
| `range_scale` | `show_comfort_band` | `true` / `false` | `true` | Displays the comfort band. This view has no separate comfort label. |
| `range_scale` | `show_optimal_band` | `true` / `false` | `true` | Displays the optimal band and its label. |
| `range_scale` | `show_footer` | `true` / `false` | `true` | Displays the footer. |
| `range_scale` | `footer` | `detailed` / `compact` | `detailed` | `detailed` includes the min/max times; `compact` omits them. |
| `scale` | `show_comfort_band` | `true` / `false` | `true` | Displays the comfort band and its label. |
| `scale` | `show_optimal_band` | `true` / `false` | `true` | Displays the optimal band and its label. |
| `scale` | `show_footer` | `true` / `false` | `true` | Displays the comfort/spread/trend footer when at least two rooms have values. |
| `scale` | `markers` | `extremes` / `average` / `all` | `extremes` | `extremes` shows the lowest room, average, and highest room (the default); `average` shows only the average; `all` shows a smaller marker for every currently valid configured room plus a larger average marker. |
| `extremes` | `show_value` | `true` / `false` | `true` | Displays the values with the coldest/warmest labels and room names. |

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

### Classification

With no `classification` option, the card uses `source: auto`: a live entity
classification is accepted only when both `value_color` and `value_level` are
present and valid. Otherwise the card classifies the reading itself, against the
built-in profile for that measurement.

Temperature uses `indoor` by default. Select the built-in outdoor profile with
the short form:

```yaml
classification: outdoor
```

The outdoor profile uses an optimal band of `18–22 °C` and a comfort band of
`14–26 °C`. Its scale follows the current readings across seasonal temperature
ranges. A custom profile selects this scale style with `anchor_scale: false`.

Select the built-in fridge profile for appliance monitoring:

```yaml
classification: fridge
```

The fridge profile uses food-safety ranges: an optimal band of `3–5 °C`, a
comfort band of `1–6 °C`, and a base scale of `0–8 °C`.

The header icon follows the active profile unless you set `icon` yourself:
temperature moves through thermometer, fire, and snowflake icons; humidity
through the water-percent variants; CO₂ switches to an alert icon at its
highest tier; and PM2.5 goes from molecule through haze and dust to alert.

The object form selects the classification source. `auto` accepts complete
entity attributes and uses the selected built-in profile for other readings:

```yaml
classification:
  source: auto
  profile: outdoor
```

`entity` uses entity attributes on their own:

```yaml
classification:
  source: entity
```

`profile` selects the named built-in profile:

```yaml
classification:
  source: profile
  profile: outdoor
```

`auto` and `profile` use the metric's default profile when `profile` is
omitted. `outdoor` and `fridge` exist for temperature only; `indoor` is the
default profile for temperature, humidity, CO₂, and PM2.5.

A custom profile defines its tiers, bands, scale, and icons together.

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
      score: 3
      level: Very hot
      zone: outside
    - min: 26
      score: 2
      level: Warm
      zone: outside
    - min: 22
      score: 1
      level: Slightly warm
      zone: comfort
    - min: 18
      score: 0
      level: Comfortable
      zone: optimal
    - min: 14
      score: -1
      level: Slightly cool
      zone: comfort
    - default: true
      score: -2
      level: Cold
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
- Without `color`, a tier's `score` selects its palette color: `0` is optimal,
  positive values mean too much, and negative values mean too little. These
  scores are whole numbers in strictly descending order. An optional
  3/4/6/8-digit hex `color` sets a tier directly and accepts any numeric score.
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
- `icons` is optional and uses a descending list of `{min, icon}` entries with
  one final `{default: true, icon: ...}` entry. The thresholds follow the
  profile's `comparison`:
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

### Palettes

Choose the card's colors with `palette`:

```yaml
palette: vivid
```

The built-in choices are `pastel` (the default), `vivid`, and the traffic-light
palette `signal`. `color-vision` uses blue-violet and amber for color-vision
accessibility; the keys `protan-deutan`, `protan`, `deutan`, and `tritan` select
the same palette.

Any CSS color name or hex color creates a coordinated palette around that
color:

```yaml
palette: teal
```

Hex works too: `palette: "#3366CC"`.

Join two or three colors with hyphens to create a palette between them:

```yaml
palette: blue-red            # blue at "too little", red at "too much"
```

The first color is the far end of “too little”, and the last is the far end of
“too much”. Add a middle color for optimal, for example
`palette: blue-green-red`. Hex colors work too: `palette: 1DB85D-FD9808`.
`blue-red` passes through violet; use `blue-white-red` to select white as the
middle color.

#### Writing your own

`optimal` sets the middle color. `above` lists colors from the first step above
optimal towards “too much”; `below` does the same towards “too little”:

```yaml
palette:
  optimal: 1DB85D
  above: FD9808, EE2046
  below: 6EC1E4, 2A6FDB
```

**Only `optimal` is required.** A palette with only that field gives every
classification the same color:

```yaml
palette:
  optimal: teal
```

Colors accept hex with or without `#`, quoted short hex, or CSS names. A wing
can be a list, one color, or several colors separated by commas.

> **Watch the `#`.** In YAML a `#` after a space starts a comment, so
> `optimal: #1DB85D` leaves the value empty. Write it without the `#`, or put it
> in quotes.
>
> **A color written only in digits needs exactly six of them.** `123456`,
> `080808`, and `008000` work unquoted. Quote shorter or longer values, such as
> `"080"` or `"#0808080"`.

The two wings may have different lengths. The first color is the first step
from optimal; the final color is the end of that direction.

`invalid` is optional. It belongs to a reading the card considers physically
impossible, such as a humidity of 130 %. Its default is neutral grey.

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

Writing `clip` or `wrap` on its own sets the overflow. To use either word as
the text, use the block form: `title: {text: wrap}`.

An empty string removes the line entirely, and so does `show: {title: false}`.

When the card has no usable data, the subtitle shows the reason even with
`show: {subtitle: false}`. For usable data, the configured subtitle applies.

### Full example

This example shows how the different groups of options can be combined. You
only need to keep the parts you want to customize.

```yaml
type: custom:room-climate-card
entity: sensor.house_temperature
range_entity: sensor.house_temperature_daily_range
trend_entity: sensor.house_temperature_trend
classification: indoor
palette: vivid

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
- Daily minimum/maximum and trend use dedicated entities, usually template
  sensors, that provide the current range and rate.
- One card shows one kind of measurement. Rooms measuring something else, or
  using an incompatible unit, are excluded. Mixed room measurements without a
  main entity produce a “No data” explanation.

## Troubleshooting

> [!WARNING]
> **Four option spellings disappear in 3.0.0.** They still work today, and the
> reference above already uses what replaces them — if your card has one of
> these, change it now:
>
> - `show_rooms: auto | true | false` → `show:` with `rooms: auto | true | false`
> - `unavailable_values: show | hide` → `show:` with `unavailable_rooms: true | false`
> - `hide_footer: true` → `show_footer: false` in every view that draws a footer
> - `footer: false` inside a view's `options:` → `show_footer: false` in that view
>
> Where a card writes both spellings of one decision, the newer one applies.
> `hide_footer` is the one without a one-line replacement: from 3.0.0 the footer
> belongs to each view, so turning them all off takes a `show_footer: false` in
> every `views:` entry that has one.

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
what they measure. The line under the title says which. Four different
situations:

- **A typo, or an entity that no longer exists.** Home Assistant does not know
  the id at all, so the card does not treat it as a source: no chip, and the id
  is named under the title. A card with one working room and one mistyped one
  is a one-room card.
- **A sensor that is `unavailable`, `unknown`, or reporting something that is
  not a number.** The entity exists, so it holds its place on the card as a `--`
  chip. Set `show.unavailable_rooms: false` to leave those chips out.
- **A reading that cannot be real**, such as 800 % humidity or a temperature
  below absolute zero. The card reports it as an impossible reading and leaves it
  out of every calculation.
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
