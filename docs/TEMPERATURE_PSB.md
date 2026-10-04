## Template: Temperature (Piotras Smart Button)
A minimal, lightweight card: current value, status from configurable thresholds, and a filled history chart.

<img src="../img/piotras-smart-button-temp.jpg" alt="Temperature PSB card">

**Features**

- Status text, icon and color change with configurable thresholds (Cold / Cool / Ideal / Warm / Hot)
- Filled line chart with a marker on the latest point
- Minimum Y-axis range, so small fluctuations do not look dramatic
- Optional fixed `y_min` / `y_max`
- Unit read automatically from the history entity
- Tap opens the standard *more-info* dialog
- Tap the chart to open the more-info dialog of the history entity
- Tap anywhere else on the card to open the source sensor

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
card_height: 140
name_size: 16
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
              <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="${stateCfg.color}" stroke="#1c1c1e" stroke-width="1.5" />
            ` : ''}

            ${showLabels ? `
              ${canCycle
                ? `<text ${cyclePointsTap} x="0" y="${height}" font-size="13" fill="${stateCfg.color}" font-weight="700" text-anchor="start" style="cursor: pointer; text-decoration: underline; pointer-events: auto;">-${values.length} pts</text>`
                : `<text x="0" y="${height}" font-size="12" fill="#999" font-weight="600" text-anchor="start">-${values.length} pts</text>`}
              <text x="${width}" y="${height}" font-size="12" fill="#999" font-weight="600" text-anchor="end">Now</text>
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
grid_options:
  columns: 9
  rows: auto
```
