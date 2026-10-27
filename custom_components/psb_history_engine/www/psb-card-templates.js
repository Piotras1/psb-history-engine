// PSB History Engine - card templates for "Copy to PSB".
//
// One template per tracking mode, so the code a user copies contains only what
// that kind of entity needs:
//   value    a line chart of the sampled values
//   counter  a line chart of consumption per hour (running total -> hourly use)
//   on_off   a bar of ON / OFF periods built from the saved state changes
//
// Each entry has:
//   show    the on/off options offered in the dialog, with their defaults
//           (the key order is the order of the checkboxes)
//   height  card_height before the optional parts are taken away
//   yaml    the card itself (Piotras Smart Button YAML)
//
// Placeholders filled in by the panel (_buildCardYaml):
//   __HEIGHT__ __ENTITY__ __TITLE__ __ACCENT__ __SHOW__ __UNIT__
//   __L_NODATA__ __L_PTS__ __L_COLLECTING__ __L_BUFFER__ __L_ON__ __L_OFF__ __L_STARTS__
//
// Writing a card here: paste the YAML as it is and put a backslash in front of
// every backtick and every "${" (\` and \${). Nothing else needs escaping.
// Do not write a "${...}" without the backslash - card() throws on it, because
// JavaScript would treat it as a substitution of its own.
const card = (strings) => {
  if (strings.length !== 1) {
    throw new Error("psb-card-templates: unescaped ${...} in a card template - write \\${ instead");
  }
  return strings.raw[0].replace(/\\`/g, () => "`").replace(/\\\$\{/g, () => "${");
};

export const CARD_TEMPLATES = {
  value: {
    show: { title: true, buffer: true, minmax: true, grid: true, dot: true, trend: false, times: true, switch: true },
    height: 200,
    yaml: card`type: custom:piotras-smart-button
card_width: auto
card_height: __HEIGHT__
show_state: false
show_icon: false
show_press_effect: false
background_color1: 'var(--card-background-color, #1c1c1e)'
custom_data:
  historyLine: |-
    p{{{
      // ===== SETTINGS =====
      const entity = '__ENTITY__';
      const title = '__TITLE__';
      const accent = '__ACCENT__';
      const decimalsOverride = null;   // null = automatic from the unit
      const unitOverride = __UNIT__;   // null = automatic from the entity
      const show = __SHOW__;
      // ===== END OF SETTINGS =====

      const lang = { noData: '__L_NODATA__', pts: '__L_PTS__', buffer: '__L_BUFFER__' };

      // --- everything is read from the history entity ---
      const st = states[entity] || {};
      const a = st.attributes || {};
      const interval = Number(a.interval_seconds) || 900;   // seconds between two points
      const unitAttr = a.source_unit_of_measurement;
      const unit = unitOverride ?? ((unitAttr && unitAttr !== 'points') ? unitAttr : '');

      // --- buffer state & depth info ---
      const bufState = Number(st.state) || (Array.isArray(a.history) ? a.history.length : 0);
      const bufDepth = Number(a.depth) || bufState || 1;
      const bufPct = Math.min(100, Math.round((bufState / bufDepth) * 100));
      const bufColor = bufPct >= 80 ? '#22c55e' : bufPct >= 30 ? '#eab308' : '#ef4444';

      const all = (Array.isArray(a.history) ? a.history : [])
        .map(p => ({ t: Number(p[0]), v: Number(p[1]), reset: p[2] === 'reset' }))
        .filter(p => !isNaN(p.t) && !isNaN(p.v))
        .sort((x, y) => x.t - y.t);

      if (all.length < 2) return lang.noData;

      // --- ranges from the number of points ---
      const N = all.length;
      const steps = [12, 24, 48, 96, 192];
      let ranges = steps.filter(s => s <= N);
      if (!ranges.length) ranges = [N];
      if (N > ranges[ranges.length - 1]) ranges.push(N);   // "all"
      if (typeof card._pts !== 'number') card._pts = [...ranges].reverse().find(r => r <= 24) ?? ranges[0];
      if (!ranges.includes(card._pts)) {
        card._pts = ranges.reduce((b, r) => Math.abs(r - card._pts) < Math.abs(b - card._pts) ? r : b);
      }
      const count = card._pts;
      const pts = all.slice(-count);
      const n = pts.length;

      // --- unit and decimals ---
      const decMap = { '°C': 1, '°F': 1, '%': 0, 'W': 0, 'kW': 2, 'kWh': 2, 'Wh': 0, 'V': 1, 'A': 2, 'hPa': 0, 'm³': 3, 'L': 1,
                       'PLN': 2, 'zł': 2, 'EUR': 2, '€': 2, 'USD': 2, '$': 2, 'GBP': 2, '£': 2, 'CZK': 2, 'CHF': 2 };
      const dec = decimalsOverride ?? (decMap[unit] ?? 1);
      const fmt = v => v.toFixed(dec) + (unit ? ' ' + unit : '');
      const pad2 = v => String(v).padStart(2, '0');
      const fmtDur = s => s >= 3600
        ? (s % 3600 === 0 ? \`\${s / 3600}h\` : \`\${Math.floor(s / 3600)}h \${Math.round((s % 3600) / 60)}m\`)
        : \`\${Math.round(s / 60)}m\`;

      // --- automatic scale ---
      const vals = pts.map(p => p.v);
      const vMin = Math.min(...vals), vMax = Math.max(...vals);
      const cur = pts[n - 1].v;
      const flat = (vMax - vMin) <= Math.max(1e-9, Math.abs(vMax) * 1e-6);
      const padV = flat ? (Math.abs(vMax) * 0.1 || 1) : (vMax - vMin) * 0.15;
      let lo = vMin - padV;
      const hi = vMax + padV;
      if (vMin >= 0 && lo < 0) lo = 0;

      // --- round scale values ---
      const niceStep = (range, target) => {
        const r = range / target;
        const p10 = Math.pow(10, Math.floor(Math.log10(r)));
        const f = r / p10;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p10;
      };
      const step = niceStep(hi - lo, 3);
      const stepDec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
      let ticks = [];
      if (isFinite(step) && step > 0) {
        const first = Math.ceil(lo / step - 1e-9);
        for (let k = 0; k < 8 && (first + k) * step <= hi + step * 1e-6; k++) ticks.push((first + k) * step);
      }
      if (ticks.length < 2) ticks = flat ? [vMin] : [vMin, vMax];

      const W = 360, H = 80, top = 6, bot = 6;
      const padL = show.grid ? 34 : 4;
      const padR = 8;
      const CW = W - padL - padR;
      const t0 = pts[0].t;
      const span = pts[n - 1].t - t0;
      const X = t => padL + (span > 0 ? ((t - t0) / span) * CW : 0);
      const Y = v => H - bot - ((v - lo) / (hi - lo)) * (H - top - bot);

      // --- line broken where data is missing ---
      const gapLimit = interval * 1.5;
      const segs = [];
      pts.forEach((p, i) => {
        if (i === 0 || p.t - pts[i - 1].t > gapLimit) segs.push([]);
        segs[segs.length - 1].push({ x: X(p.t), y: Y(p.v) });
      });
      const line = segs.map(s => s.map((q, i) => \`\${i ? 'L' : 'M'} \${q.x.toFixed(1)} \${q.y.toFixed(1)}\`).join(' ')).join(' ');
      const area = segs.filter(s => s.length > 1).map(s =>
        \`M \${s[0].x.toFixed(1)} \${H - bot} \` + s.map(q => \`L \${q.x.toFixed(1)} \${q.y.toFixed(1)}\`).join(' ') +
        \` L \${s[s.length - 1].x.toFixed(1)} \${H - bot} Z\`).join(' ');

      // --- scale and grid ---
      let grid = '';
      if (show.grid) {
        ticks.forEach(v => {
          const y = Y(v).toFixed(1);
          grid += \`<line x1="\${padL}" y1="\${y}" x2="\${padL + CW}" y2="\${y}" stroke="var(--divider-color, rgba(125,125,125,0.15))" stroke-dasharray="3 4" />\`;
          grid += \`<text x="\${padL - 6}" y="\${(Y(v) + 3).toFixed(1)}" fill="var(--secondary-text-color, #64748b)" font-size="8" font-family="monospace" text-anchor="end" style="text-shadow:none;">\${v.toFixed(stepDec)}</text>\`;
        });
      }

      // --- time labels (unified text color for full contrast) ---
      let times = '';
      if (show.times) {
        const an = ['start', 'middle', 'middle', 'middle', 'end'];
        [0, 0.25, 0.5, 0.75, 1].forEach((f, k) => {
          const d = new Date((t0 + span * f) * 1000);
          times += \`<text x="\${(padL + f * CW).toFixed(1)}" y="\${H + 14}" fill="var(--secondary-text-color, #64748b)" font-size="9" font-weight="\${k === 4 ? '700' : '600'}" font-family="monospace" text-anchor="\${an[k]}" style="text-shadow:none;">\${pad2(d.getHours())}:\${pad2(d.getMinutes())}</text>\`;
        });
      }
      const svgH = H + (show.times ? 18 : 4);

      // --- dot and trend ---
      const dot = show.dot
        ? \`<circle cx="\${X(pts[n - 1].t).toFixed(1)}" cy="\${Y(cur).toFixed(1)}" r="3.5" fill="\${accent}" stroke="var(--card-background-color, #1c1c1e)" stroke-width="1.5" />\` : '';
      let trend = '';
      if (show.trend) {
        const back = Math.max(1, Math.round(3600 / interval));
        const ref = pts[Math.max(0, n - 1 - back)];
        const dv = cur - ref.v;
        trend = Math.abs(dv) < Math.pow(10, -dec) ? '→' : dv > 0 ? '↑' : '↓';
      }

      const gid = 'hlFill_' + entity.replace(/[^a-zA-Z0-9]/g, '_');
      const svg = \`
        <svg viewBox="0 0 \${W} \${svgH}" style="width:100%; height:\${svgH}px; overflow:visible; display:block;">
          <defs>
            <linearGradient id="\${gid}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="\${accent}" stop-opacity="0.28" />
              <stop offset="100%" stop-color="\${accent}" stop-opacity="0" />
            </linearGradient>
          </defs>
          \${grid}
          <path d="\${area}" fill="url(#\${gid})" />
          <path d="\${line}" fill="none" stroke="\${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          \${dot}
          \${times}
        </svg>\`;

      // --- header with buffer dot indicator ---
      const bufferDot = (show.buffer !== false)
        ? \`<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:\${bufColor}; margin-right:6px;" title="\${lang.buffer}: \${bufState}/\${bufDepth} \${lang.pts} (\${bufPct}%)"></span>\`
        : '';

      const header = show.title ? \`
        <div style="display:flex; justify-content:space-between; align-items:center; text-shadow:none;">
          <div style="display:flex; align-items:center;">
            \${bufferDot}
            <span style="font-weight:700; font-size:1em; color:var(--primary-text-color, #1e293b); letter-spacing:0.3px;">\${title}</span>
          </div>
          <span style="font-weight:800; font-size:1.1em; color:var(--primary-text-color, #1e293b);">\${fmt(cur)}\${trend ? ' ' + trend : ''}</span>
        </div>\` : '';

      const minmax = show.minmax
        ? \`<span style="color:var(--secondary-text-color, #64748b); font-size:0.85em; font-family:monospace; text-shadow:none;">MIN \${fmt(vMin)} · MAX \${fmt(vMax)}</span>\` : '<span></span>';

      const rangeLabel = \`\${count} \${lang.pts} · \${fmtDur(count * interval)}\`;

      const switchBtn = (show.switch && ranges.length > 1)
        ? \`<div \${customTap.id_js({ action: () => {
              const i = ranges.indexOf(card._pts);
              card._pts = ranges[(i + 1) % ranges.length];
              card._updateState();
            } })} style="background:var(--primary-background-color, rgba(56,189,248,0.1)); border:1px solid var(--divider-color, rgba(56,189,248,0.25)); color:var(--primary-text-color, #1e293b); font-size:0.75em; font-weight:700; padding:2px 8px; border-radius:6px; cursor:pointer; user-select:none; text-shadow:none;">⏱️ \${rangeLabel}</div>\`
        : '';

      const footer = (show.minmax || switchBtn) ? \`
        <div style="display:flex; justify-content:space-between; align-items:center; ">
          \${minmax}
          \${switchBtn}
        </div>\` : '';

      return \`
        <div style="display:flex; flex-direction:column; width:100%; gap:8px; box-sizing:border-box;">
          \${header}
          <div style="background:var(--primary-background-color, rgba(255,255,255,0.6)); padding:6px; border-radius:10px; border:1px solid var(--divider-color, rgba(0,0,0,0.06));">
            \${svg}
          </div>
          \${footer}
        </div>
      \`;
    }}}q
name: customData.historyLine
show_shadow: false
`,
  },

  counter: {
    show: { title: true, buffer: true, minmax: true, grid: true, dot: true, trend: false, times: true, switch: true },
    height: 200,
    yaml: card`type: custom:piotras-smart-button
card_width: auto
card_height: __HEIGHT__
show_state: false
show_icon: false
show_press_effect: false
background_color1: 'var(--card-background-color, #1c1c1e)'
custom_data:
  historyLine: |-
    p{{{
      // ===== SETTINGS =====
      const entity = '__ENTITY__';
      const title = '__TITLE__';
      const accent = '__ACCENT__';
      const decimalsOverride = null;   // null = automatic from the unit
      const unitOverride = __UNIT__;   // null = automatic from the entity
      const show = __SHOW__;
      // ===== END OF SETTINGS =====

      const lang = { noData: '__L_NODATA__', pts: '__L_PTS__', collecting: '__L_COLLECTING__', buffer: '__L_BUFFER__' };

      // --- everything is read from the history entity ---
      const st = states[entity] || {};
      const a = st.attributes || {};
      const sampleInterval = Number(a.interval_seconds) || 900;
      const unitAttr = a.source_unit_of_measurement;
      const unit = unitOverride ?? ((unitAttr && unitAttr !== 'points') ? unitAttr : '');

      // --- buffer state & depth info ---
      const bufState = Number(st.state) || (Array.isArray(a.history) ? a.history.length : 0);
      const bufDepth = Number(a.depth) || bufState || 1;
      const bufPct = Math.min(100, Math.round((bufState / bufDepth) * 100));
      const bufColor = bufPct >= 80 ? '#22c55e' : bufPct >= 30 ? '#eab308' : '#ef4444';

      const raw = (Array.isArray(a.history) ? a.history : [])
        .map(p => ({ t: Number(p[0]), v: Number(p[1]), reset: p[2] === 'reset' }))
        .filter(p => !isNaN(p.t) && !isNaN(p.v))
        .sort((x, y) => x.t - y.t);

      // counter mode (kWh, water...): consumption PER HOUR, not the running total.
      const hourly = sampleInterval < 3600;
      const interval = hourly ? 3600 : sampleInterval;
      const perHour = hourly ? Math.floor(3600 / sampleInterval) : 1;
      const buckets = new Map();
      for (let i = 1; i < raw.length; i++) {
        if (raw[i].t - raw[i - 1].t > sampleInterval * 1.5) continue;   // data gap
        const d = (raw[i].reset || raw[i].v < raw[i - 1].v) ? raw[i].v : raw[i].v - raw[i - 1].v;
        let t = raw[i].t;
        if (hourly) {
          const hs = new Date((raw[i].t - sampleInterval / 2) * 1000);
          hs.setMinutes(0, 0, 0);
          t = hs.getTime() / 1000;
        }
        const bk = buckets.get(t) || { t, v: 0, n: 0 };
        bk.v += Math.max(0, d);
        bk.n++;
        buckets.set(t, bk);
      }
      const all = [...buckets.values()]
        .filter(bk => bk.n >= perHour)
        .sort((x, y) => x.t - y.t)
        .map(bk => ({ t: bk.t, v: hourly ? bk.v * 3600 / (bk.n * sampleInterval) : bk.v }));
      if (all.length < 2) return raw.length >= 2 ? lang.collecting : lang.noData;

      // --- ranges from the number of points ---
      const N = all.length;
      const steps = [6, 12, 24, 48, 96];
      let ranges = steps.filter(s => s <= N);
      if (!ranges.length) ranges = [N];
      if (N > ranges[ranges.length - 1]) ranges.push(N);   // "all"
      if (typeof card._pts !== 'number') card._pts = [...ranges].reverse().find(r => r <= 24) ?? ranges[0];
      if (!ranges.includes(card._pts)) {
        card._pts = ranges.reduce((b, r) => Math.abs(r - card._pts) < Math.abs(b - card._pts) ? r : b);
      }
      const count = card._pts;
      const pts = all.slice(-count);
      const n = pts.length;

      // --- unit and decimals ---
      const decMap = { '°C': 1, '°F': 1, '%': 0, 'W': 0, 'kW': 2, 'kWh': 2, 'Wh': 0, 'V': 1, 'A': 2, 'hPa': 0, 'm³': 3, 'L': 1,
                       'PLN': 2, 'zł': 2, 'EUR': 2, '€': 2, 'USD': 2, '$': 2, 'GBP': 2, '£': 2, 'CZK': 2, 'CHF': 2 };
      const dec = decimalsOverride ?? (decMap[unit] ?? 1);
      const fmt = v => v.toFixed(dec) + (unit ? ' ' + unit : '');
      const pad2 = v => String(v).padStart(2, '0');
      const fmtDur = s => s >= 3600
        ? (s % 3600 === 0 ? \`\${s / 3600}h\` : \`\${Math.floor(s / 3600)}h \${Math.round((s % 3600) / 60)}m\`)
        : \`\${Math.round(s / 60)}m\`;

      // --- automatic scale ---
      const vals = pts.map(p => p.v);
      const vMin = Math.min(...vals), vMax = Math.max(...vals);
      const cur = pts[n - 1].v;
      const flat = (vMax - vMin) <= Math.max(1e-9, Math.abs(vMax) * 1e-6);
      const padV = flat ? (Math.abs(vMax) * 0.1 || 1) : (vMax - vMin) * 0.15;
      let lo = vMin - padV;
      const hi = vMax + padV;
      if (vMin >= 0 && lo < 0) lo = 0;

      // --- round scale values ---
      const niceStep = (range, target) => {
        const r = range / target;
        const p10 = Math.pow(10, Math.floor(Math.log10(r)));
        const f = r / p10;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p10;
      };
      const step = niceStep(hi - lo, 3);
      const stepDec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
      let ticks = [];
      if (isFinite(step) && step > 0) {
        const first = Math.ceil(lo / step - 1e-9);
        for (let k = 0; k < 8 && (first + k) * step <= hi + step * 1e-6; k++) ticks.push((first + k) * step);
      }
      if (ticks.length < 2) ticks = flat ? [vMin] : [vMin, vMax];

      const W = 360, H = 80, top = 6, bot = 6;
      const padL = show.grid ? 34 : 4;
      const padR = 8;
      const CW = W - padL - padR;
      const t0 = pts[0].t;
      const span = pts[n - 1].t - t0;
      const X = t => padL + (span > 0 ? ((t - t0) / span) * CW : 0);
      const Y = v => H - bot - ((v - lo) / (hi - lo)) * (H - top - bot);

      // --- line broken where data is missing ---
      const gapLimit = interval * 1.5;
      const segs = [];
      pts.forEach((p, i) => {
        if (i === 0 || p.t - pts[i - 1].t > gapLimit) segs.push([]);
        segs[segs.length - 1].push({ x: X(p.t), y: Y(p.v) });
      });
      const line = segs.map(s => s.map((q, i) => \`\${i ? 'L' : 'M'} \${q.x.toFixed(1)} \${q.y.toFixed(1)}\`).join(' ')).join(' ');
      const area = segs.filter(s => s.length > 1).map(s =>
        \`M \${s[0].x.toFixed(1)} \${H - bot} \` + s.map(q => \`L \${q.x.toFixed(1)} \${q.y.toFixed(1)}\`).join(' ') +
        \` L \${s[s.length - 1].x.toFixed(1)} \${H - bot} Z\`).join(' ');

      // --- scale and grid ---
      let grid = '';
      if (show.grid) {
        ticks.forEach(v => {
          const y = Y(v).toFixed(1);
          grid += \`<line x1="\${padL}" y1="\${y}" x2="\${padL + CW}" y2="\${y}" stroke="var(--divider-color, rgba(125,125,125,0.15))" stroke-dasharray="3 4" />\`;
          grid += \`<text x="\${padL - 6}" y="\${(Y(v) + 3).toFixed(1)}" fill="var(--secondary-text-color, #64748b)" font-size="8" font-family="monospace" text-anchor="end" style="text-shadow:none;">\${v.toFixed(stepDec)}</text>\`;
        });
      }

      // --- time labels (unified text color for full contrast) ---
      let times = '';
      if (show.times) {
        const an = ['start', 'middle', 'middle', 'middle', 'end'];
        [0, 0.25, 0.5, 0.75, 1].forEach((f, k) => {
          const d = new Date((t0 + span * f) * 1000);
          times += \`<text x="\${(padL + f * CW).toFixed(1)}" y="\${H + 14}" fill="var(--secondary-text-color, #64748b)" font-size="9" font-weight="\${k === 4 ? '700' : '600'}" font-family="monospace" text-anchor="\${an[k]}" style="text-shadow:none;">\${pad2(d.getHours())}:\${pad2(d.getMinutes())}</text>\`;
        });
      }
      const svgH = H + (show.times ? 18 : 4);

      // --- dot and trend ---
      const dot = show.dot
        ? \`<circle cx="\${X(pts[n - 1].t).toFixed(1)}" cy="\${Y(cur).toFixed(1)}" r="3.5" fill="\${accent}" stroke="var(--card-background-color, #1c1c1e)" stroke-width="1.5" />\` : '';
      let trend = '';
      if (show.trend) {
        const back = Math.max(1, Math.round(3600 / interval));
        const ref = pts[Math.max(0, n - 1 - back)];
        const dv = cur - ref.v;
        trend = Math.abs(dv) < Math.pow(10, -dec) ? '→' : dv > 0 ? '↑' : '↓';
      }

      const gid = 'hlFill_' + entity.replace(/[^a-zA-Z0-9]/g, '_');
      const svg = \`
        <svg viewBox="0 0 \${W} \${svgH}" style="width:100%; height:\${svgH}px; overflow:visible; display:block;">
          <defs>
            <linearGradient id="\${gid}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="\${accent}" stop-opacity="0.28" />
              <stop offset="100%" stop-color="\${accent}" stop-opacity="0" />
            </linearGradient>
          </defs>
          \${grid}
          <path d="\${area}" fill="url(#\${gid})" />
          <path d="\${line}" fill="none" stroke="\${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          \${dot}
          \${times}
        </svg>\`;

      // --- header with buffer dot indicator ---
      const bufferDot = (show.buffer !== false)
        ? \`<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:\${bufColor}; margin-right:6px;" title="\${lang.buffer}: \${bufState}/\${bufDepth} \${lang.pts} (\${bufPct}%)"></span>\`
        : '';

      const header = show.title ? \`
        <div style="display:flex; justify-content:space-between; align-items:center; text-shadow:none;">
          <div style="display:flex; align-items:center;">
            \${bufferDot}
            <span style="font-weight:700; font-size:1em; color:var(--primary-text-color, #1e293b); letter-spacing:0.3px;">\${title}</span>
          </div>
          <span style="font-weight:800; font-size:1.1em; color:var(--primary-text-color, #1e293b);">\${fmt(cur)}\${trend ? ' ' + trend : ''}</span>
        </div>\` : '';

      const minmax = show.minmax
        ? \`<span style="color:var(--secondary-text-color, #64748b); font-size:0.85em; font-family:monospace; text-shadow:none;">MIN \${fmt(vMin)} · MAX \${fmt(vMax)}</span>\` : '<span></span>';

      const rangeLabel = hourly ? fmtDur(count * 3600) : \`\${count} \${lang.pts} · \${fmtDur(count * interval)}\`;

      const switchBtn = (show.switch && ranges.length > 1)
        ? \`<div \${customTap.id_js({ action: () => {
              const i = ranges.indexOf(card._pts);
              card._pts = ranges[(i + 1) % ranges.length];
              card._updateState();
            } })} style="background:var(--primary-background-color, rgba(56,189,248,0.1)); border:1px solid var(--divider-color, rgba(56,189,248,0.25)); color:var(--primary-text-color, #1e293b); font-size:0.75em; font-weight:700; padding:2px 8px; border-radius:6px; cursor:pointer; user-select:none; text-shadow:none;">⏱️ \${rangeLabel}</div>\`
        : '';

      const footer = (show.minmax || switchBtn) ? \`
        <div style="display:flex; justify-content:space-between; align-items:center; ">
          \${minmax}
          \${switchBtn}
        </div>\` : '';

      return \`
        <div style="display:flex; flex-direction:column; width:100%; gap:8px; box-sizing:border-box;">
          \${header}
          <div style="background:var(--primary-background-color, rgba(255,255,255,0.6)); padding:6px; border-radius:10px; border:1px solid var(--divider-color, rgba(0,0,0,0.06));">
            \${svg}
          </div>
          \${footer}
        </div>
      \`;
    }}}q
name: customData.historyLine
show_shadow: false
`,
  },

  on_off: {
    show: { title: true, buffer: true, minmax: true, times: true, switch: true },
    height: 150,
    yaml: card`type: custom:piotras-smart-button
card_width: auto
card_height: __HEIGHT__
show_state: false
show_icon: false
show_press_effect: false
background_color1: 'var(--card-background-color, #1c1c1e)'
custom_data:
  historyLine: |-
    p{{{
      // ===== SETTINGS =====
      const entity = '__ENTITY__';
      const title = '__TITLE__';
      const accent = '__ACCENT__';
      const show = __SHOW__;
      // ===== END OF SETTINGS =====

      const lang = { noData: '__L_NODATA__', buffer: '__L_BUFFER__', on: '__L_ON__', off: '__L_OFF__', starts: '__L_STARTS__' };

      // --- everything is read from the history entity (events: [time, 1 = on | 0 = off | -1 = unavailable]) ---
      const st = states[entity] || {};
      const a = st.attributes || {};

      // --- buffer state & depth info ---
      const bufState = Number(st.state) || (Array.isArray(a.history) ? a.history.length : 0);
      const bufDepth = Number(a.depth) || bufState || 1;
      const bufPct = Math.min(100, Math.round((bufState / bufDepth) * 100));
      const bufColor = bufPct >= 80 ? '#22c55e' : bufPct >= 30 ? '#eab308' : '#ef4444';

      const p2 = v => String(v).padStart(2, '0');
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const dur = s => s >= 3600 ? \`\${Math.floor(s / 3600)}h \${p2(Math.floor((s % 3600) / 60))}m\` : s >= 60 ? \`\${Math.floor(s / 60)}m\` : \`\${Math.floor(s)}s\`;
      const when = t => { const d = new Date(t * 1000); return \`\${p2(d.getDate())}.\${p2(d.getMonth() + 1)} \${p2(d.getHours())}:\${p2(d.getMinutes())}\`; };
      // entries are [time, 1 = on | 0 = off | -1 = unavailable], one per state change
      const num = v => (v === null || v === '' || typeof v === 'boolean') ? NaN : Number(v);   // Number(null) would be 0 = "off"
      const ev = (Array.isArray(a.history) ? a.history : [])
        .map(p => ({ t: num(p?.[0]), c: num(p?.[1]) }))
        .filter(p => !isNaN(p.t) && (p.c === 1 || p.c === 0 || p.c === -1))
        .sort((x, y) => x.t - y.t);
      if (!ev.length) return lang.noData;
      const last = ev[ev.length - 1];
      const now = Math.max(Math.floor(Date.now() / 1000), last.t);

      // windows: 6 h / 12 h / 24 h / 2 d / 7 d (only those shorter than the recorded span) and "all" (0)
      const spanH = (now - ev[0].t) / 3600;
      const wins = [...[6, 12, 24, 48, 168].filter(w => w < spanH), 0];
      if (typeof card._win !== 'number' || !wins.includes(card._win)) card._win = [...wins].reverse().find(w => w > 0 && w <= 24) ?? 0;
      const tS = card._win === 0 ? ev[0].t : now - card._win * 3600;
      const total = Math.max(1, now - tS);

      // segments inside the window (the state in force at its start is carried over)
      const segs = [];
      for (let i = 0; i < ev.length; i++) {
        const s0 = Math.max(ev[i].t, tS), s1 = Math.min(i + 1 < ev.length ? ev[i + 1].t : now, now);
        if (s1 > s0) segs.push({ s0, s1, c: ev[i].c });
      }
      const onSec = segs.reduce((t, s) => t + (s.c === 1 ? s.s1 - s.s0 : 0), 0);
      const knownSec = segs.reduce((t, s) => t + (s.c !== -1 ? s.s1 - s.s0 : 0), 0);
      const starts = ev.filter((p, i) => i > 0 && p.c === 1 && p.t >= tS && p.t <= now).length;

      const W = 360, BX = 4, BW = W - 8, BY = 4, BH = 26;
      const X = t => BX + ((t - tS) / total) * BW;
      const g2 = 'ooBar_' + entity.replace(/[^a-zA-Z0-9]/g, '_');
      const subtle = 'var(--secondary-text-color, #64748b)';
      const track = 'var(--divider-color, rgba(125,125,125,0.2))';
      let rects = '';
      segs.forEach(s => {
        const x1 = X(s.s0), x2 = X(s.s1);
        const w = Math.max(s.c === 1 ? 1.4 : 0.8, x2 - x1);                 // a short ON pulse stays visible
        const fill = s.c === 1 ? accent : s.c === 0 ? subtle : \`url(#\${g2}h)\`;
        const tip = (s.c === 1 ? lang.on : s.c === 0 ? lang.off : '–') + ' · ' + when(s.s0) + ' → ' + when(s.s1) + ' (' + dur(s.s1 - s.s0) + ')';
        rects += \`<rect x="\${x1.toFixed(2)}" y="\${BY}" width="\${w.toFixed(2)}" height="\${BH}" fill="\${fill}"\${s.c === 0 ? ' opacity="0.3"' : ''}><title>\${esc(tip)}</title></rect>\`;
      });
      const defs = \`<defs><clipPath id="\${g2}c"><rect x="\${BX}" y="\${BY}" width="\${BW}" height="\${BH}" rx="6" /></clipPath>\` +
        \`<pattern id="\${g2}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="\${track}" />\` +
        \`<line x1="0" y1="0" x2="0" y2="6" stroke="\${subtle}" stroke-opacity="0.55" stroke-width="2" /></pattern></defs>\`;

      // midnight marks
      let seps = '';
      {
        const d = new Date(tS * 1000);
        d.setHours(24, 0, 0, 0);
        for (let g = 0; g < 60 && d.getTime() / 1000 < now; g++) {
          const x = X(d.getTime() / 1000).toFixed(1);
          seps += \`<line x1="\${x}" y1="\${BY - 2}" x2="\${x}" y2="\${BY + BH + 2}" stroke="\${subtle}" stroke-opacity="0.6" stroke-dasharray="2 2" />\`;
          d.setDate(d.getDate() + 1);
        }
      }

      // time labels at round times: whole hours, or minutes for windows under 3 h (midnight shows the date);
      // the most recent win, none touch each other, at most 8
      let labels = '';
      if (show.times) {
        const spanW = total / 3600;
        const minuteMode = spanW < 3;
        const stepMin = minuteMode ? ([1, 2, 5, 10, 15, 30].find(sv => (total / 60) / sv <= 6) || 30) : 0;
        const stepH = minuteMode ? 0 : ([1, 2, 3, 4, 6, 12, 24].find(sv => spanW / sv <= 8) || 24);
        const cand = [];
        const d = new Date(tS * 1000);
        if (minuteMode) {
          d.setSeconds(0, 0);
          const m0 = d.getMinutes();
          d.setMinutes(m0 + ((stepMin - (m0 % stepMin)) % stepMin));
          if (d.getTime() / 1000 < tS) d.setMinutes(d.getMinutes() + stepMin);
        } else {
          d.setMinutes(0, 0, 0);
          if (d.getTime() / 1000 < tS) d.setHours(d.getHours() + 1);
        }
        for (let g = 0; g < 1000 && d.getTime() / 1000 <= now; g++) {
          const hh = d.getHours(), mm = d.getMinutes();
          if (minuteMode || hh % stepH === 0) {
            const x = X(d.getTime() / 1000);
            const anchor = x < BX + 14 ? 'start' : x > W - 14 ? 'end' : 'middle';
            const lft = anchor === 'start' ? x : anchor === 'end' ? x - 28 : x - 14;
            cand.push({ x, anchor, lft, rgt: lft + 28, text: (!minuteMode && hh === 0) ? \`\${p2(d.getDate())}.\${p2(d.getMonth() + 1)}\` : \`\${p2(hh)}:\${p2(mm)}\` });
          }
          if (minuteMode) d.setMinutes(d.getMinutes() + stepMin); else d.setHours(d.getHours() + 1);
        }
        let nextLeft = Infinity;
        const kept = [];
        for (let i = cand.length - 1; i >= 0; i--) if (cand[i].rgt + 4 <= nextLeft) { nextLeft = cand[i].lft; kept.push(cand[i]); }
        kept.reverse();
        let shown = kept;
        while (shown.length > 8) shown = shown.filter((_, i) => (shown.length - 1 - i) % 2 === 0);
        shown.forEach(c => {            // written left to right
          labels += \`<text x="\${c.x.toFixed(1)}" y="\${BY + BH + 14}" fill="\${subtle}" font-size="9" font-weight="600" font-family="monospace" text-anchor="\${c.anchor}" style="text-shadow:none;">\${c.text}</text>\`;
        });
      }
      const H2 = BY + BH + (show.times ? 18 : 4);
      const barSvg = \`<svg viewBox="0 0 \${W} \${H2}" style="width:100%; height:\${H2}px; overflow:visible; display:block;">\${defs}\` +
        \`<rect x="\${BX}" y="\${BY}" width="\${BW}" height="\${BH}" rx="6" fill="\${track}" /><g clip-path="url(#\${g2}c)">\${rects}</g>\${seps}\${labels}</svg>\`;

      // header: title + buffer dot, live ON / OFF pill and how long it has been in the current state
      const srcSt = a.source_entity ? states[a.source_entity]?.state : undefined;
      const curC = srcSt === undefined ? last.c : (srcSt === 'unavailable' || srcSt === 'unknown') ? -1 : (srcSt === 'on' ? 1 : 0);
      const isOn = curC === 1;
      const pill = \`<span title="\${esc(when(last.t))}" style="display:inline-flex; align-items:center; gap:5px; font-size:0.65em; font-weight:800; letter-spacing:0.4px; padding:1px 8px; margin-right:8px; border-radius:999px; vertical-align:middle; border:1px solid \${isOn ? accent : 'var(--divider-color, rgba(125,125,125,0.4))'}; color:var(--primary-text-color, #1e293b);"><span style="width:6px; height:6px; border-radius:50%; background:\${isOn ? accent : subtle};"></span>\${curC === -1 ? '–' : isOn ? lang.on : lang.off}</span>\`;
      const bufDot = (show.buffer !== false)
        ? \`<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:\${bufColor}; margin-right:6px;" title="\${lang.buffer}: \${bufState}/\${bufDepth} (\${bufPct}%)"></span>\` : '';
      const head = show.title ? \`
      <div style="display:flex; justify-content:space-between; align-items:center; text-shadow:none;">
        <div style="display:flex; align-items:center;">
          \${bufDot}
          <span style="font-weight:700; font-size:1em; color:var(--primary-text-color, #1e293b); letter-spacing:0.3px;">\${title}</span>
        </div>
        <span style="font-weight:800; font-size:1.1em; color:var(--primary-text-color, #1e293b);">\${pill}\${dur(now - last.t)}</span>
      </div>\` : '';

      const summary = show.minmax
        ? \`<span style="color:var(--secondary-text-color, #64748b); font-size:0.85em; font-family:monospace; text-shadow:none;">\${lang.on} \${(onSec / 3600).toFixed(1)} h\${knownSec > 0 ? \` (\${Math.round(onSec / knownSec * 100)}%)\` : ''} · \${starts} \${lang.starts}</span>\` : '<span></span>';
      const winBtn = (show.switch && wins.length > 1)
        ? \`<div \${customTap.id_js({ action: () => {
              const i = wins.indexOf(card._win);
              card._win = wins[(i + 1) % wins.length];
              card._updateState();
            } })} style="background:var(--primary-background-color, rgba(56,189,248,0.1)); border:1px solid var(--divider-color, rgba(56,189,248,0.25)); color:var(--primary-text-color, #1e293b); font-size:0.75em; font-weight:700; padding:2px 8px; border-radius:6px; cursor:pointer; user-select:none; text-shadow:none;">⏱️ \${card._win === 0 ? dur(now - ev[0].t) : card._win + 'h'}</div>\` : '';
      const foot = (show.minmax || winBtn) ? \`
      <div style="display:flex; justify-content:space-between; align-items:center; ">
        \${summary}
        \${winBtn}
      </div>\` : '';

      return \`
      <div style="display:flex; flex-direction:column; width:100%; gap:8px; box-sizing:border-box;">
        \${head}
        <div style="background:var(--primary-background-color, rgba(255,255,255,0.6)); padding:6px; border-radius:10px; border:1px solid var(--divider-color, rgba(0,0,0,0.06));">
          \${barSvg}
        </div>
        \${foot}
      </div>
    \`;
    }}}q
name: customData.historyLine
show_shadow: false
`,
  },
};
