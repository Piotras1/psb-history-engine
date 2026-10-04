# History Templates & Card Examples

Ready-to-use dashboard cards that visualize the `history` attribute created by **PSB History Engine**.
Copy a template, change the entity IDs at the top of the configuration, and you are done.

- [Before you start](#before-you-start)
- [Template 1: Temperature (Custom Button-card)](#template-1-temperature-custom-button-card)
- [Template 2: Temperature (Piotras Smart Button)](#template-2-temperature-piotras-smart-button)
  - [Extended version](#want-more-extended-version)
- [Adapting a template to another sensor](#adapting-a-template-to-another-sensor)
- [Troubleshooting](#troubleshooting)

---

## Before you start

### Requirements

- PSB History Engine installed, with the source entity added in the **Tracked** panel.
- The generated history entity, e.g. `sensor.living_room_temperature_history`.
- The card you want to use:
  - [Custom Button-card (CB)](https://github.com/custom-cards/button-card)
  - [Piotras Smart Button (PSB)](https://github.com/Piotras1/piotras-smart-button)

### What the cards read

Each tracked entity gets a companion `sensor.<name>_history` with this attribute structure:

```yaml
attributes:
  source_unit_of_measurement: °C   # used by the templates as the default unit
  interval_seconds: 3600
  history:
    - [1735689600, 21.4]           # [unix timestamp in seconds, value]
    - [1735693200, 21.6]
    - [1735696800, 21.5]
```

Both temperature templates are meant for entities tracked in **Current value** mode.

> **Tip:** the unit is taken automatically from `source_unit_of_measurement`.
> Set `unit` in the configuration only if you want to override it.

---

## Template 1: Temperature (Custom Button-card)

A minimal, lightweight card: current value, status from configurable thresholds, and a filled history chart.

<!-- Add screenshot: -->
<!-- ![Temperature card, Custom Button-card](../img/template-cb-temperature.jpg) -->

**Features**

- Status text, icon and color change with configurable thresholds (Cold / Cool / Ideal / Warm / Hot)
- Filled line chart with a marker on the latest point
- Minimum Y-axis range, so small fluctuations do not look dramatic
- Optional fixed `y_min` / `y_max`
- Unit read automatically from the history entity
- Tap opens the standard *more-info* dialog

**Configuration** (all in the `variables.config` block at the top of the YAML)

| Option | Default | Description |
|---|---|---|
| `title` | `TEMPERATURE` | Card title |
| `unit` | empty | Unit override. Empty = use `source_unit_of_measurement` |
| `history_entity_id` | none | The `sensor.<name>_history` entity |
| `history_attribute` | `history` | Attribute that holds the array |
| `chart_width` / `chart_height` | `380` / `80` | Chart size in px |
| `stroke_width` | `2` | Line thickness |
| `fill_opacity` | `0.45` | Opacity of the gradient under the line |
| `max_points` | `24` | Number of latest points to draw |
| `y_axis_padding` | `0.15` | Extra space above and below the data (fraction of the range) |
| `min_y_range` | `2` | Minimum visible Y range. Use about `10` for humidity or voltage |
| `y_min` / `y_max` | `null` | Fixed Y-axis limits. `null` = automatic |
| `side_padding` | `6` | Space on the right so the last dot is not clipped |
| `show_last_dot` | `true` | Marker on the latest point |
| `show_time_labels` | `true` | Labels under the chart |
| `time_label_start` / `time_label_end` | auto / `Now` | Label texts. Remove `time_label_start` to get `-N pts` automatically |
| `thresholds` | see code | List ordered from lowest to highest. `max: null` means no upper limit |
| `fallback` | see code | Shown when the value is unavailable |

**Code**

```yaml
type: custom:button-card
entity: sensor.sonoff_termometr_salon_temperature
show_name: false
show_state: false
show_label: false
show_icon: false
tap_action:
  action: more-info
variables:
  config:
    title: TEMPERATURE
    unit: ''
    history_entity_id: sensor.sonoff_termometr_salon_temperature_history
    history_attribute: history
    chart_height: 80
    chart_width: 380
    stroke_width: 2
    fill_opacity: 0.45
    max_points: 24
    y_axis_padding: 0.15
    min_y_range: 2
    y_min: null
    y_max: null
    side_padding: 6
    show_last_dot: true
    show_time_labels: true
    time_label_end: Now
    thresholds:
      - max: 18
        status: Cold
        color: '#2196F3'
        icon: mdi:thermometer-low
      - max: 21
        status: Cool
        color: '#03A9F4'
        icon: mdi:thermometer
      - max: 24
        status: Ideal
        color: '#4CAF50'
        icon: mdi:thermometer-check
      - max: 26
        status: Warm
        color: '#FF9800'
        icon: mdi:thermometer-high
      - max: null
        status: Hot
        color: '#F44336'
        icon: mdi:thermometer-alert
    fallback:
      status: No Data
      color: '#888888'
      icon: mdi:thermometer-off
styles:
  card:
    - padding: 12px
    - border-radius: 12px
    - background: '#1c1c1e'
    - cursor: pointer
  grid:
    - grid-template-areas: '"header" "chart"'
    - grid-template-rows: auto 1fr
    - row-gap: 8px
  custom_fields:
    header:
      - grid-area: header
      - width: 100%
    chart:
      - grid-area: chart
      - width: 100%
custom_fields:
  header: |
    [[[
      const cfg = variables.config;
      const temp = entity ? parseFloat(entity.state) : NaN;
      const histEnt = states[cfg.history_entity_id];
      const unit = cfg.unit
        || (histEnt && histEnt.attributes && histEnt.attributes.source_unit_of_measurement)
        || '';
      let stateCfg = cfg.fallback;

      if (!isNaN(temp)) {
        stateCfg = cfg.thresholds.find(t => t.max === null || t.max === undefined || temp <= t.max) || cfg.fallback;
      }

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-icon icon="${stateCfg.icon}" style="--mdc-icon-size: 24px; color: ${stateCfg.color};"></ha-icon>
            <div style="display: flex; flex-direction: column; text-align: left;">
              <span style="font-weight: 700; font-size: 0.9em; color: #ffffff; line-height: 1.1;">${cfg.title}</span>
              <span style="font-size: 0.75em; color: ${stateCfg.color}; font-weight: 600;">${stateCfg.status}</span>
            </div>
          </div>
          <span style="font-weight: 800; font-size: 1.2em; color: ${stateCfg.color};">${isNaN(temp) ? '--' : temp.toFixed(1)} ${unit}</span>
        </div>
      `;
    ]]]
  chart: |
    [[[
      const cfg = variables.config;
      const histEntity = states[cfg.history_entity_id];
      if (!histEntity || !histEntity.attributes) {
        return '<div style="font-size: 0.8em; color: #888; text-align: center; padding: 10px;">History entity missing...</div>';
      }

      const attrName = cfg.history_attribute || 'history';
      const rawHistory = histEntity.attributes[attrName];

      if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
        return '<div style="font-size: 0.8em; color: #888; text-align: center; padding: 10px;">No history attribute data...</div>';
      }

      const temp = entity ? parseFloat(entity.state) : NaN;
      let dynamicColor = cfg.fallback.color;

      if (!isNaN(temp)) {
        const found = cfg.thresholds.find(t => t.max === null || t.max === undefined || temp <= t.max);
        if (found) dynamicColor = found.color;
      }

      let values = [];
      for (let i = 0; i < rawHistory.length; i++) {
        const item = rawHistory[i];
        if (Array.isArray(item) && item.length >= 2) {
          const val = parseFloat(item[1]);
          if (!isNaN(val)) values.push(val);
        }
      }

      // Limit points to `max_points` (taking latest)
      const maxPts = cfg.max_points || 24;
      if (values.length > maxPts) {
        values = values.slice(-maxPts);
      }

      if (values.length < 2) {
        return '<div style="font-size: 0.8em; color: #888; text-align: center; padding: 10px;">Not enough points...</div>';
      }

      const width = cfg.chart_width || 280;
      const height = cfg.chart_height || 50;
      const showLabels = cfg.show_time_labels !== false;
      const bottomPadding = showLabels ? 12 : 4;
      const topPadding = 4;
      const sidePad = cfg.side_padding !== undefined ? cfg.side_padding : 6;
      const plotWidth = width - sidePad;

      // --- Y axis scale ---
      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
      const padFactor = cfg.y_axis_padding !== undefined ? cfg.y_axis_padding : 0.15;
      const pad = (dataMax - dataMin) * padFactor;

      let minVal = dataMin - pad;
      let maxVal = dataMax + pad;

      // Minimum visible range (small fluctuations should not look dramatic)
      const minRange = cfg.min_y_range !== undefined ? cfg.min_y_range : 2;
      if ((maxVal - minVal) < minRange) {
        const mid = (maxVal + minVal) / 2;
        minVal = mid - minRange / 2;
        maxVal = mid + minRange / 2;
      }

      // Optional fixed limits
      if (cfg.y_min !== undefined && cfg.y_min !== null) minVal = cfg.y_min;
      if (cfg.y_max !== undefined && cfg.y_max !== null) maxVal = cfg.y_max;
      if (maxVal <= minVal) maxVal = minVal + 1;

      const range = maxVal - minVal;
      const drawHeight = height - topPadding - bottomPadding;

      const pointsArray = values.map((val, idx) => {
        const x = (idx / (values.length - 1)) * plotWidth;
        const clamped = Math.min(maxVal, Math.max(minVal, val));
        const y = height - bottomPadding - ((clamped - minVal) / range) * drawHeight;
        return { x, y };
      });

      const pointsString = pointsArray.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const lastPoint = pointsArray[pointsArray.length - 1];

      const gradId = "cb_tempGrad_" + Math.random().toString(36).substr(2, 5);
      const showDot = cfg.show_last_dot !== false;

      return `
        <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block;">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${dynamicColor}" stop-opacity="${cfg.fill_opacity}"/>
              <stop offset="100%" stop-color="${dynamicColor}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <polygon points="0,${height - bottomPadding} ${pointsString} ${plotWidth},${height - bottomPadding}" fill="url(#${gradId})" />
          <polyline points="${pointsString}" fill="none" stroke="${dynamicColor}" stroke-width="${cfg.stroke_width}" stroke-linecap="round" stroke-linejoin="round" />
          ${showDot ? `<circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="3" fill="${dynamicColor}" stroke="#1c1c1e" stroke-width="1.5" />` : ''}
          ${showLabels ? `
            <text x="0" y="${height}" font-size="8" fill="#666666" font-weight="600" text-anchor="start">${cfg.time_label_start || `-${values.length} pts`}</text>
            <text x="${width}" y="${height}" font-size="8" fill="#666666" font-weight="600" text-anchor="end">${cfg.time_label_end || 'Now'}</text>
          ` : ''}
        </svg>
      `;
    ]]]
```

---

## Template 2: Temperature (Piotras Smart Button)

The same look and features as Template 1, built for PSB. One extra: tap the `-N pts` label to switch the time range.

<!-- Add screenshot: -->
<!-- ![Temperature card, Piotras Smart Button](../img/template-psb-temperature.jpg) -->

**Features**

- Status text, icon and color change with configurable thresholds
- Filled line chart with a marker on the latest point
- **Tap the underlined `-N pts` label to cycle the time range** (steps set in `points_steps`; ranges larger than the buffer are skipped, and the last step always shows everything available)
- Minimum Y-axis range and optional fixed `y_min` / `y_max`
- Unit read automatically from the history entity
- Tap the chart to open the *more-info* dialog of the history entity (buffer contents and attributes); tap elsewhere on the card to open the source sensor (long-term history from the recorder)
- All options in one `Configuration` block at the top, written as plain JavaScript

**Configuration** (the `Configuration` module)

| Option | Default | Description |
|---|---|---|
| `title` | `TEMPERATURE` | Card title |
| `entity_id` | none | The source sensor (live value) |
| `history_entity_id` | none | The `sensor.<name>_history` entity |
| `history_attribute` | `history` | Attribute that holds the array |
| `unit` | empty | Unit override. Empty = use `source_unit_of_measurement` |
| `chart_width` / `chart_height` | `380` / `80` | Chart size in px |
| `stroke_width` | `2` | Line thickness |
| `fill_opacity` | `0.45` | Opacity of the gradient under the line |
| `max_points` | `24` | Number of points shown at start |
| `points_steps` | `[24, 48, 72]` | Ranges cycled by tapping the `-N pts` label |
| `y_axis_padding` | `0.15` | Extra space above and below the data |
| `min_y_range` | `2` | Minimum visible Y range. Use about `10` for humidity or voltage |
| `y_min` / `y_max` | `null` | Fixed Y-axis limits. `null` = automatic |
| `side_padding` | `8` | Space on the right so the marker is not clipped |
| `show_last_dot` | `true` | Marker on the latest point |
| `show_time_labels` | `true` | Labels under the chart |
| `chart_tap_more_info` | `true` | Tap the chart to open more-info of the history entity |
| `thresholds` | see code | Ordered from lowest to highest. `max: null` means no upper limit |
| `fallback` | see code | Shown when the value is unavailable |

**Code**

```yaml
type: custom:piotras-smart-button
card_width: auto
card_height: 130
name_size: 15
border_width: 1
show_state: false
show_icon: false
show_shadow: false
background_color1: '#1c1c1e'
name: customData.Content
tap_action:
  action: more-info
entity: sensor.sonoff_termometr_salon_temperature
custom_data:
  Configuration: |-
    p{{{
      return {
        title: "TEMPERATURE",
        entity_id: "sensor.sonoff_termometr_salon_temperature",
        history_entity_id: "sensor.sonoff_termometr_salon_temperature_history",
        history_attribute: "history",

        // Unit: empty = taken from source_unit_of_measurement
        unit: "",

        chart_height: 80,
        chart_width: 380,
        stroke_width: 2,
        fill_opacity: 0.45,

        // Points shown at start and the ranges cycled by tapping "-N pts"
        max_points: 24,
        points_steps: [24, 48, 72],

        // Y axis scale
        y_axis_padding: 0.15,
        min_y_range: 2,     // temperature: 2, humidity: 10, voltage: 10
        y_min: null,        // null = automatic
        y_max: null,        // null = automatic
        side_padding: 8,

        show_last_dot: true,
        show_time_labels: true,
        chart_tap_more_info: true,   // tap the chart = more-info of the history entity

        thresholds: [
          { max: 18, status: "Cold", color: "#2196F3", icon: "mdi:thermometer-low" },
          { max: 20, status: "Cool", color: "#03A9F4", icon: "mdi:thermometer" },
          { max: 24, status: "Ideal", color: "#4CAF50", icon: "mdi:thermometer-check" },
          { max: 26, status: "Warm", color: "#FF9800", icon: "mdi:thermometer-high" },
          { max: null, status: "Hot", color: "#F44336", icon: "mdi:thermometer-alert" }
        ],
        fallback: {
          status: "No Data",
          color: "#888888",
          icon: "mdi:thermometer-off"
        }
      };
    }}}q
  Content: |-
    p{{{
      const cfg = customData.Configuration;
      if (!cfg) return '';

      const histEnt = states[cfg.history_entity_id];
      const unit = cfg.unit
        || (histEnt && histEnt.attributes && histEnt.attributes.source_unit_of_measurement)
        || '';

      const findThreshold = (v) =>
        cfg.thresholds.find(t => t.max === null || t.max === undefined || v <= t.max) || cfg.fallback;

      const mainEntity = states[cfg.entity_id];
      const temp = mainEntity ? parseFloat(mainEntity.state) : NaN;
      const stateCfg = isNaN(temp) ? cfg.fallback : findThreshold(temp);

      // --- Read history ---
      const raw = (histEnt && histEnt.attributes)
        ? histEnt.attributes[cfg.history_attribute || 'history']
        : null;

      const all = [];
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i];
          if (Array.isArray(item) && item.length >= 2) {
            const val = parseFloat(item[1]);
            if (!isNaN(val)) all.push(val);
          }
        }
      }
      const total = all.length;

      // --- Time range (tap "-N pts" to cycle) ---
      // Steps larger than the buffer are skipped; the last step shows everything.
      const steps = (Array.isArray(cfg.points_steps) && cfg.points_steps.length)
        ? cfg.points_steps
        : [cfg.max_points || 24];
      const ranges = steps.filter(s => s < total);
      ranges.push(total);

      const wanted = (card._maxPts !== undefined) ? card._maxPts : (cfg.max_points || ranges[0]);
      const values = all.slice(-Math.min(wanted, total));
      const canCycle = ranges.length > 1;

      const cyclePointsTap = customTap.id_js({
        action: () => {
          const i = ranges.indexOf(values.length);
          card._maxPts = ranges[(i + 1) % ranges.length];
          card._updateState();
        }
      });

      // Tap on the chart opens more-info of the history entity
      const chartTap = customTap.id_js({
        action: () => {
          const ha = document.querySelector('home-assistant');
          if (ha) {
            ha.dispatchEvent(new CustomEvent('hass-more-info', {
              detail: { entityId: cfg.history_entity_id },
              bubbles: true,
              composed: true
            }));
          }
        }
      });

      let chartHtml = '';

      if (values.length < 2) {
        chartHtml = '<div style="font-size: 0.8em; color: #888; text-align: center; padding: 10px;">Not enough history points...</div>';
      } else {
        const width = cfg.chart_width || 280;
        const height = cfg.chart_height || 50;
        const showLabels = cfg.show_time_labels !== false;
        const bottomPadding = showLabels ? 14 : 4;
        const topPadding = 4;
        const sidePad = cfg.side_padding !== undefined ? cfg.side_padding : 8;
        const plotWidth = width - sidePad;

        // --- Y axis scale ---
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        const padFactor = cfg.y_axis_padding !== undefined ? cfg.y_axis_padding : 0.15;
        const pad = (dataMax - dataMin) * padFactor;

        let minVal = dataMin - pad;
        let maxVal = dataMax + pad;

        const minRange = cfg.min_y_range !== undefined ? cfg.min_y_range : 2;
        if ((maxVal - minVal) < minRange) {
          const mid = (maxVal + minVal) / 2;
          minVal = mid - minRange / 2;
          maxVal = mid + minRange / 2;
        }

        if (cfg.y_min !== undefined && cfg.y_min !== null) minVal = cfg.y_min;
        if (cfg.y_max !== undefined && cfg.y_max !== null) maxVal = cfg.y_max;
        if (maxVal <= minVal) maxVal = minVal + 1;

        const range = maxVal - minVal;
        const drawHeight = height - topPadding - bottomPadding;

        const pts = values.map((val, idx) => {
          const x = (idx / (values.length - 1)) * plotWidth;
          const clamped = Math.min(maxVal, Math.max(minVal, val));
          const y = height - bottomPadding - ((clamped - minVal) / range) * drawHeight;
          return { x, y };
        });

        const pointsString = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const last = pts[pts.length - 1];
        const gradId = "psb_tempGrad_" + Math.random().toString(36).substr(2, 5);

        chartHtml = `
          <div style="position: relative; width: 100%; height: ${height}px;">
          <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block; pointer-events: none;">
            <defs>
              <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${stateCfg.color}" stop-opacity="${cfg.fill_opacity}"/>
                <stop offset="100%" stop-color="${stateCfg.color}" stop-opacity="0.0"/>
              </linearGradient>
            </defs>

            <polygon points="0,${height - bottomPadding} ${pointsString} ${plotWidth},${height - bottomPadding}" fill="url(#${gradId})" />
            <polyline points="${pointsString}" fill="none" stroke="${stateCfg.color}" stroke-width="${cfg.stroke_width}" stroke-linecap="round" stroke-linejoin="round" />

            ${cfg.show_last_dot !== false ? `
              <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" fill="${stateCfg.color}" stroke="#1c1c1e" stroke-width="1.5" />
            ` : ''}

            ${showLabels ? `
              ${canCycle
                ? `<text ${cyclePointsTap} x="0" y="${height}" font-size="12" fill="${stateCfg.color}" font-weight="700" text-anchor="start" style="cursor: pointer; text-decoration: underline; pointer-events: auto;">-${values.length} pts</text>`
                : `<text x="0" y="${height}" font-size="11" fill="#666666" font-weight="600" text-anchor="start">-${values.length} pts</text>`}
              <text x="${width}" y="${height}" font-size="11" fill="#666666" font-weight="600" text-anchor="end">Now</text>
            ` : ''}
          </svg>
          ${cfg.chart_tap_more_info !== false ? `
            <div ${chartTap} style="position: absolute; top: 0; left: 0; width: ${(plotWidth / width) * 100}%; height: ${height - bottomPadding}px; cursor: pointer; z-index: 10;"></div>
          ` : ''}
          </div>
        `;
      }

      return `
        <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; padding: 5px; box-sizing: border-box; user-select: none;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <ha-icon icon="${stateCfg.icon}" style="--mdc-icon-size: 24px; color: ${stateCfg.color};"></ha-icon>
              <div style="display: flex; flex-direction: column; text-align: left;">
                <span style="font-weight: 700; font-size: 0.9em; color: #ffffff; line-height: 1.1;">${cfg.title}</span>
                <span style="font-size: 0.75em; color: ${stateCfg.color}; font-weight: 600;">${stateCfg.status}</span>
              </div>
            </div>
            <span style="font-weight: 800; font-size: 1.25em; color: ${stateCfg.color};">${isNaN(temp) ? '--' : temp.toFixed(1)} ${unit}</span>
          </div>

          <div style="width: 100%; margin-top: 4px;">
            ${chartHtml}
          </div>
        </div>
      `;
    }}}q
```

> **Tip:** the card height is `130` for the default chart. If you change `chart_height`,
> adjust `card_height` by the same amount.

### Want more? Extended version

An extended temperature card is available in the PSB modules. On top of this template it adds:

- tap any point on the chart to inspect its value and time
- automatic return to the live value after a few seconds of inactivity
- MIN / AVG / MAX for the visible range

👉 **[Extended temperature card (PSB Custom Data Modules)](https://github.com/Piotras1/piotras-smart-button/discussions/categories/custom-data-modules)**

<!-- Replace the link above with the direct link to the module entry once it is published. -->

---

## Adapting a template to another sensor

The templates are not limited to temperature. To reuse one for humidity, battery, voltage or power:

1. Change the entity IDs: the source sensor (`entity` / `entity_id`) and its `_history` companion (`history_entity_id`).
2. Change `title` and the `icon` values in `thresholds` (for example `mdi:water-percent`, `mdi:battery`).
3. Rewrite the `thresholds` to match the new value range. Keep them ordered from lowest to highest and end with `max: null`.
4. Set `min_y_range` to a sensible value for the quantity:

| Quantity | Suggested `min_y_range` |
|---|---|
| Temperature (°C) | `2` |
| Humidity (%) | `10` |
| Battery (%) | `10` |
| Mains voltage (V) | `10` |
| Power (W) | depends on the load, start with `50` |

5. For quantities with a natural scale, fix the axis with `y_min` and `y_max` (for example `0` and `100` for humidity or battery).

> **Note:** these templates draw raw values, so they are meant for entities tracked in
> **Current value** mode. Entities tracked in **Increasing counter** mode (energy, gas, water)
> store cumulative meter values, and a sample flagged `"reset"` is the delta for that interval.
> A card for counters has to calculate deltas first.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `History entity missing...` | `history_entity_id` is misspelled, or the entity is not tracked yet. Copy the ID from the **Tracked** panel. |
| `No history attribute data...` | The buffer is still empty. Wait for the first sample, or check the interval in the entity settings. |
| `Not enough points...` | The chart needs at least 2 samples. |
| The last dot is clipped on the right | Increase `side_padding`. If it is still clipped, the card or theme uses `overflow: hidden`. |
| The chart looks flat | Lower `min_y_range` or set `y_min` and `y_max`. |
| The chart shows only a short time span | The visible span is `max_points` x the entity interval. Raise `max_points` (and the buffer depth in the entity settings if needed). |
| The card is empty with no error | Check the YAML indentation and open the browser console for JavaScript errors. |
| The unit is missing | The source entity has no unit. Set `unit` manually. |
