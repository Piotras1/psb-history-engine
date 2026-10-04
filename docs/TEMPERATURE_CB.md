## Template: Temperature (Custom Button-card) 
A minimal, lightweight card: current value, status from configurable thresholds, and a filled history chart.

<img src="../img/custom-button-card-temp.jpg" alt="Temperature CB card">

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
          ${showDot ? `<circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="4" fill="${dynamicColor}" stroke="#1c1c1e" stroke-width="1.5" />` : ''}
          ${showLabels ? `
            <text x="0" y="${height}" font-size="10" fill="#999" font-weight="600" text-anchor="start">${cfg.time_label_start || `-${values.length} pts`}</text>
            <text x="${width}" y="${height}" font-size="10" fill="#999" font-weight="600" text-anchor="end">${cfg.time_label_end || 'Now'}</text>
          ` : ''}
        </svg>
      `;
    ]]]
grid_options:
  columns: 9
  rows: auto
```



