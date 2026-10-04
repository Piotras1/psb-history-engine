// PSB History Engine - full sidebar panel: browse trackable entities, configure
// per-entity buffer (mode/interval/depth/suffix), preview the live buffer.
// UI text is loaded from lang/<code>.json (pl/en/de) into LANG_CACHE at
// startup; active language comes from the Setup screen and defaults to
// English until an admin picks one.

const LANGUAGES = ["cs", "de", "en", "es", "fr", "it", "pl", "pt", "ru", "sv"];
const DEFAULT_LANGUAGE = "en";
const LANG_URL_BASE = "/psb_history_engine/lang";

// Loaded from lang/<code>.json on startup (see _loadLanguages below) rather
// than bundled here, so adding a language is just a new JSON file - no JS
// edits needed. Populated once per panel session; _t() reads from this.
const LANG_CACHE = {};

// Auto-detected entity categories (order = order in the menu / chips).
const CATEGORY_KEYS = ["energy", "power", "temperature", "humidity", "battery", "water_gas", "other"];
const CLASS_TO_CATEGORY = {
  energy: "energy",
  power: "power",
  temperature: "temperature",
  humidity: "humidity",
  battery: "battery",
  water: "water_gas",
  gas: "water_gas",
};
const UNIT_TO_CATEGORY = {
  kwh: "energy", wh: "energy", mwh: "energy",
  w: "power", kw: "power",
  "°c": "temperature", "°f": "temperature", k: "temperature",
  "m³": "water_gas", m3: "water_gas", l: "water_gas", "ft³": "water_gas",
};
const ADD_RESULTS_LIMIT = 40;

const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
const UNIT_KEYS = ["seconds", "minutes", "hours", "days"];

class PsbHistoryEnginePanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._entities = null;
    this._defaults = null;
    this._view = "tracked";
    this._opened = null;
    this._editing = null;
    this._pending = new Set();
    this._error = null;
    this._errorIsWarning = false;
    this._addQuery = "";
    this._addCat = "all";
    this._trackQuery = "";
    this._addPending = false;
    this.attachShadow({ mode: "open" });
  }

  disconnectedCallback() {
    clearInterval(this._previewPollTimer);
    this._previewPollTimer = null;
  }

  set narrow(value) {
    this._narrow = value;
  }
  set route(value) {
    this._route = value;
  }
  set panel(value) {
    this._panel = value;
  }

  set hass(hass) {
    const firstRun = this._hass === null;
    this._hass = hass;
    if (firstRun) {
      this._refresh();
    } else if (this._entities) {
      this._patchLiveValues();
      this._patchDom();
    }
  }

  get _language() {
    const lang = this._defaults && this._defaults.language;
    return LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  }

  _t(key, vars) {
    const path = key.split(".");
    const lookup = (dict) => path.reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
    let str = lookup(LANG_CACHE[this._language]);
    if (str === undefined) str = lookup(LANG_CACHE[DEFAULT_LANGUAGE]);
    if (str === undefined) return key;
    if (vars) {
      for (const k of Object.keys(vars)) str = str.split(`{${k}}`).join(vars[k]);
    }
    return str;
  }

  async _call(type, extra) {
    return this._hass.connection.sendMessagePromise({
      type: `psb_history_engine/${type}`,
      ...extra,
    });
  }

  async _loadLanguages() {
    await Promise.all(
      LANGUAGES.map(async (lang) => {
        if (LANG_CACHE[lang]) return;
        try {
          const res = await fetch(`${LANG_URL_BASE}/${lang}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          LANG_CACHE[lang] = await res.json();
        } catch (err) {
          console.warn(`PSB History Engine: failed to load language "${lang}"`, err);
        }
      })
    );
  }

  async _refresh() {
    try {
      const [, listResult, settingsResult] = await Promise.all([
        this._loadLanguages(),
        this._call("list_entities"),
        this._call("get_settings"),
      ]);
      this._entities = listResult.entities;
      this._defaults = settingsResult.defaults;
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  _patchLiveValues() {
    if (!this._entities) return;
    for (const entity of this._entities) {
      const state = this._hass.states[entity.entity_id];
      if (state) {
        const value = parseFloat(state.state);
        entity.value = Number.isNaN(value) ? null : value;
      }
    }
  }

  _patchDom() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("[data-value-for]").forEach((el) => {
      const entity = this._entities.find((e) => e.entity_id === el.dataset.valueFor);
      if (entity) el.textContent = this._fmt(entity.value, entity.unit);
    });
  }

  _flashError(message, isError = true) {
    this._error = message;
    this._errorIsWarning = !isError;
    this._render();
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._error = null;
      const node = this.shadowRoot && this.shadowRoot.querySelector(".error");
      if (node) node.remove();
    }, 4000);
  }

  _switchView(view) {
    this._view = view;
    this._opened = null;
    this._editing = null;
    this._render();
    this._restartPreviewPoll();
  }

  _toggleOpen(entityId) {
    if (this._opened === entityId) {
      this._opened = null;
      this._editing = null;
    } else {
      this._opened = entityId;
      this._editing = null;
    }
    this._render();
    this._restartPreviewPoll();
  }

  _restartPreviewPoll() {
    clearInterval(this._previewPollTimer);
    this._previewPollTimer = null;
    if (this._opened && !this._editing) {
      const entityId = this._opened;
      this._refreshPreviewLive(entityId);
      this._previewPollTimer = setInterval(() => this._refreshPreviewLive(entityId), 8000);
    }
  }

  async _refreshPreviewLive(entityId) {
    const host = this.shadowRoot && this.shadowRoot.querySelector(
      `[data-preview-for="${CSS.escape(entityId)}"]`
    );
    const entity = this._entities && this._entities.find((e) => e.entity_id === entityId);
    if (!host || !entity) return;
    try {
      const result = await this._call("get_entity_state", { entity_id: entity.history_entity_id });
      const forced = result && result.state !== null ? { state: result.state, attributes: result.attributes } : null;
      host.innerHTML = this._renderPreview(entity, forced);
      this._bindActions(host);
      this._attachChartEvents(host, forced ? forced.attributes?.history : this._hass.states[entity.history_entity_id]?.attributes?.history, entity.unit);
    } catch (_err) {
      // Silent
    }
  }

  _startEdit(entityId) {
    this._opened = entityId;
    this._editing = entityId;
    this._render();
    this._restartPreviewPoll();
  }

  _cancelEdit() {
    this._editing = null;
    this._render();
    this._restartPreviewPoll();
  }

  _esc(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _category(entity) {
    const st = this._hass && this._hass.states[entity.entity_id];
    const deviceClass = st && st.attributes ? st.attributes.device_class : null;
    if (deviceClass && CLASS_TO_CATEGORY[deviceClass]) return CLASS_TO_CATEGORY[deviceClass];
    const unit = String(entity.unit || (st && st.attributes && st.attributes.unit_of_measurement) || "")
      .trim()
      .toLowerCase();
    return UNIT_TO_CATEGORY[unit] || "other";
  }

  _matchesView(entity, view) {
    if (view === "tracked") return entity.tracked;
    if (view.startsWith("cat:")) return entity.tracked && this._category(entity) === view.slice(4);
    return false;
  }

  _countFor(view) {
    return this._entities.filter((e) => this._matchesView(e, view)).length;
  }

  _searchText(entity) {
    return `${entity.name} ${entity.entity_id} ${entity.history_entity_id}`.toLowerCase();
  }

  _fmt(value, unit) {
    if (value === null || value === undefined) return "-";
    return `${Number(value).toFixed(2)} ${unit || ""}`.trim();
  }

  _coverageText(intervalValue, intervalUnit, depth) {
    const unitSeconds = UNIT_SECONDS[intervalUnit] || 60;
    const totalSeconds = (parseInt(intervalValue, 10) || 1) * unitSeconds * (parseInt(depth, 10) || 1);
    if (totalSeconds < 3600) return this._t("coverage.min", { n: Math.round(totalSeconds / 60) });
    if (totalSeconds < 86400) return this._t("coverage.hours", { n: (totalSeconds / 3600).toFixed(1) });
    return this._t("coverage.days", { n: (totalSeconds / 86400).toFixed(1) });
  }

  _fmtDuration(seconds) {
    // Reuses the same coverage.* translations as _coverageText, instead of
    // hardcoding unit suffixes here too - keeps both in sync automatically
    // and makes this work in every configured panel language, not just pl.
    if (seconds < 60) return this._t("coverage.seconds", { n: Math.round(seconds) });
    if (seconds < 3600) return this._t("coverage.min", { n: Math.round(seconds / 60) });
    if (seconds < 86400) return this._t("coverage.hours", { n: (seconds / 3600).toFixed(1) });
    return this._t("coverage.days", { n: (seconds / 86400).toFixed(1) });
  }

  async _saveEntity(entityId, form) {
    const key = `save::${entityId}`;
    this._pending.add(key);
    this._render();
    try {
      const result = await this._call("save_entity", { entity_id: entityId, ...form });
      this._entities = result.entities;
      this._editing = null;
      this._flashError(this._t("msg.save_ok"), false);
    } catch (err) {
      this._flashError(err?.message || this._t("msg.save_fail"));
    } finally {
      this._pending.delete(key);
      this._render();
      this._restartPreviewPoll();
    }
  }

  async _addEntity(entityId) {
    entityId = (entityId || "").trim();
    if (!entityId) return;

    const known = this._entities.find((e) => e.entity_id === entityId);
    if (!known && !this._hass.states[entityId]) {
      this._flashError(this._t("msg.entity_not_found", { id: entityId }));
      return;
    }
    if (known && known.tracked) {
      this._flashError(this._t("msg.already_tracked", { id: entityId }));
      return;
    }

    const d = this._defaults || {};
    this._addPending = true;
    this._render();
    try {
      const result = await this._call("save_entity", {
        entity_id: entityId,
        enabled: true,
        tracking_mode: d.tracking_mode,
        interval_value: d.interval_value,
        interval_unit: d.interval_unit,
        depth: d.depth,
        offset_seconds: d.offset_seconds ?? 0,
        suffix: d.suffix,
        friendly_name: "",
      });
      this._entities = result.entities;
      this._flashError(this._t("msg.added", { id: entityId }), false);
    } catch (err) {
      this._flashError(err?.message || this._t("msg.add_fail"));
    } finally {
      this._addPending = false;
      this._render();
    }
  }

  async _clearData(entityId) {
    const key = `clear::${entityId}`;
    this._pending.add(key);
    this._render();
    try {
      const result = await this._call("clear_entity", { entity_id: entityId });
      this._entities = result.entities;
      this._flashError(this._t("msg.clear_ok"), false);
    } catch (err) {
      this._flashError(err?.message || this._t("msg.clear_fail"));
    } finally {
      this._pending.delete(key);
      this._render();
    }
  }

  async _removeEntity(entityId) {
    const key = `remove::${entityId}`;
    this._pending.add(key);
    this._render();
    try {
      const result = await this._call("remove_entity", { entity_id: entityId });
      this._entities = result.entities;
      this._opened = null;
      this._editing = null;
    } catch (err) {
      this._flashError(err?.message || this._t("msg.remove_fail"));
    } finally {
      this._pending.delete(key);
      this._render();
      this._restartPreviewPoll();
    }
  }

  async _saveSettings(form) {
    try {
      const result = await this._call("save_settings", form);
      this._defaults = result.defaults;
      this._flashError(this._t("msg.settings_saved"), false);
    } catch (err) {
      this._flashError(err?.message || this._t("msg.settings_save_fail"));
    }
    this._render();
  }

  async _exportSettings() {
    try {
      const result = await this._call("export_settings");
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "psb_history_engine_settings.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this._flashError(err?.message || this._t("msg.export_fail"));
    }
  }

  async _importSettings(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await this._call("import_settings", {
        defaults: data.defaults || {},
        tracked_entities: data.tracked_entities || {},
      });
      this._entities = result.entities;
      this._flashError(this._t("msg.import_ok"), false);
      await this._refresh();
    } catch (err) {
      this._flashError(err?.message || this._t("msg.import_fail"));
    }
  }

  async _copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (_2) {
        return false;
      }
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  _sparklinePoints(history) {
    if (!Array.isArray(history) || history.length < 2) return null;
    const values = history.map((p) => p[1]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 260;
    const h = 70;
    const pad = 2;
    const step = (w - pad * 2) / (history.length - 1);
    const pts = history
      .map((p, i) => {
        const x = pad + i * step;
        const v = typeof p[1] === "number" ? p[1] : min;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { pts, w, h, min, max };
  }

  _fmtTime(ts) {
    return new Date(ts * 1000).toLocaleString([], {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  _attachChartEvents(host, history, unit) {
    if (!host) return;
    const container = host.querySelector('[data-chart-container]');
    if (!container || !Array.isArray(history) || history.length < 2) return;

    const svg = container.querySelector('.sparkline');
    const line = container.querySelector('.crosshair-line');
    const dot = container.querySelector('.crosshair-dot');
    const tooltip = container.querySelector('.chart-tooltip');

    const handlePointer = (e) => {
      const rect = svg.getBoundingClientRect();
      let x = e.clientX - rect.left;
      if (x < 0) x = 0;
      if (x > rect.width) x = rect.width;

      const pct = x / rect.width;
      const index = Math.min(
        history.length - 1,
        Math.max(0, Math.round(pct * (history.length - 1)))
      );

      const point = history[index];
      if (!point) return;
      const timestamp = point[0];
      const val = point[1];

      const svgX = 2 + index * ((260 - 4) / (history.length - 1));
      
      const values = history.map(p => p[1]).filter(v => typeof v === 'number');
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const svgY = 70 - 2 - (((typeof val === 'number' ? val : min) - min) / range) * (70 - 4);

      line.setAttribute('x1', svgX);
      line.setAttribute('x2', svgX);
      line.style.display = 'block';

      dot.setAttribute('cx', svgX);
      dot.setAttribute('cy', svgY);
      dot.style.display = 'block';

      tooltip.style.display = 'block';
      tooltip.innerHTML = `<b>${this._fmtTime(timestamp)}</b> — ${this._t("preview.value_label")}: <b>${this._fmt(val, unit)}</b>`;
    };

    const clearPointer = () => {
      line.style.display = 'none';
      dot.style.display = 'none';
      tooltip.style.display = 'none';
    };

    svg.addEventListener('pointermove', handlePointer);
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      handlePointer(e);
    });
    svg.addEventListener('pointerleave', clearPointer);
    svg.addEventListener('pointerup', clearPointer);
  }

  _renderPreview(entity, forcedState) {
    const state = forcedState !== undefined ? forcedState : this._hass.states[entity.history_entity_id];
    if (!state) {
      return `<div class="preview"><div class="preview-row"><span></span></div><div class="preview-empty">${this._t("preview.not_created")}</div></div>`;
    }
    const history = state.attributes.history || [];
    const count = history.length;
    if (count === 0) {
      return `<div class="preview"><div class="preview-row"><span>${this._t("preview.count", { n: 0, depth: entity.config.depth })}</span></div><div class="preview-empty">${this._t("preview.no_entries_hint")}</div></div>`;
    }

    let timespanText = "";
    if (count >= 2) {
      const cfg = entity.config || {};
      const unitSec = UNIT_SECONDS[cfg.interval_unit] || 60;
      const intervalSec = (parseInt(cfg.interval_value, 10) || 1) * unitSec;
      
      const firstTs = history[0][0];
      const lastTs = history[count - 1][0];
      
      const currentSpanSec = Math.max(0, lastTs - firstTs) + intervalSec;
      const maxSpanSec = intervalSec * (parseInt(cfg.depth, 10) || 1);

      timespanText = `<span class="time-badge" title="${this._esc(this._t("preview.timespan_tooltip"))}">
        <ha-icon icon="mdi:clock-outline"></ha-icon> ${this._fmtDuration(currentSpanSec)} / max ${this._fmtDuration(maxSpanSec)}
      </span>`;
    }

    const unit = entity.unit || "";
    const spark = this._sparklinePoints(history);
    const last3 = history.slice(-3).reverse();
    const lastRows = last3
      .map(
        (p) =>
          `<div class="entry-row"><span>${this._fmtTime(p[0])}</span><span>${this._fmt(p[1], unit)}${p[2] === "reset" ? ` <em class="reset-tag">${this._t("preview.reset_tag")}</em>` : ""}</span></div>`
      )
      .join("");

    const chart = spark
      ? `<div class="chart-container" data-chart-container>
           <div class="chart">
             <div class="chart-y">
               <span>${this._fmt(spark.max, unit)}</span>
               <span>${this._fmt(spark.min, unit)}</span>
             </div>
             <div class="chart-body">
               <svg class="sparkline" viewBox="0 0 ${spark.w} ${spark.h}" preserveAspectRatio="none">
                 <polygon points="${spark.pts} ${spark.w - 2},${spark.h} 2,${spark.h}" fill="var(--primary-color)" opacity="0.15"/>
                 <polyline points="${spark.pts}" fill="none" stroke="var(--primary-color)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
                 <line class="crosshair-line" x1="0" y1="0" x2="0" y2="${spark.h}" stroke="var(--primary-color)" stroke-width="1.5" stroke-dasharray="2,2" style="display:none;"/>
                 <circle class="crosshair-dot" r="4" fill="var(--primary-color)" stroke="#fff" stroke-width="1" style="display:none;"/>
               </svg>
               <div class="chart-x">
                 <span>${this._fmtTime(history[0][0])}</span>
                 <span>${this._fmtTime(history[count - 1][0])}</span>
               </div>
             </div>
           </div>
           <div class="chart-tooltip" style="display:none;"></div>
         </div>`
      : `<div class="preview-empty">${this._t("preview.not_enough_points")}</div>`;

    return `
      <div class="preview">
        <div class="preview-row">
          <span>${this._t("preview.count", { n: `<b>${count}</b>`, depth: entity.config.depth })}</span>
          ${
            count >= entity.config.depth
              ? `<span class="full-badge" title="${this._t("preview.full_tooltip")}">
                   <ha-icon icon="mdi:sync"></ha-icon>${this._t("preview.full_tag")}
                 </span>`
              : ""
          }
          ${timespanText}
        </div>
        ${chart}
        <div class="preview-sub">${this._t("preview.last_entries")}</div>
        ${lastRows}
      </div>`;
  }

  _renderEditForm(entity) {
    const cfg = entity.config;
    const pendingSave = this._pending.has(`save::${entity.entity_id}`);
    const pendingRemove = this._pending.has(`remove::${entity.entity_id}`);
    const pendingClear = this._pending.has(`clear::${entity.entity_id}`);
    const enabledChecked = entity.tracked ? entity.enabled : true;
    return `
      <div class="edit-form" data-entity="${entity.entity_id}">
        <label class="field checkbox-field">
          <input type="checkbox" data-f="enabled" ${enabledChecked ? "checked" : ""}>
          <span>${this._t("form.enabled")}</span>
        </label>
        <label class="field">
          <span>${this._t("form.mode")}</span>
          <select data-f="tracking_mode">
            <option value="value" ${cfg.tracking_mode === "value" ? "selected" : ""}>${this._t("mode.value_full")}</option>
            <option value="counter" ${cfg.tracking_mode === "counter" ? "selected" : ""}>${this._t("mode.counter_full")}</option>
          </select>
        </label>
        <label class="field">
          <span>${this._t("form.interval")}</span>
          <span class="inline">
            <input type="number" min="1" data-f="interval_value" value="${cfg.interval_value}">
            <select data-f="interval_unit">
              ${UNIT_KEYS.map((u) => `<option value="${u}" ${cfg.interval_unit === u ? "selected" : ""}>${this._t(`unit.${u}`)}</option>`).join("")}
            </select>
          </span>
        </label>
        <label class="field">
          <span>${this._t("form.depth")}</span>
          <input type="number" min="2" max="500" data-f="depth" value="${cfg.depth}">
        </label>
        <div class="hint" data-coverage>${this._t("coverage.prefix")}${this._coverageText(cfg.interval_value, cfg.interval_unit, cfg.depth)}</div>
        <label class="field">
          <span>${this._t("form.offset")}</span>
          <input type="number" step="1" data-f="offset_seconds" value="${cfg.offset_seconds ?? 0}">
          <span class="hint">${this._t("form.offset_hint")}</span>
        </label>
        <label class="field">
          <span>${this._t("form.suffix")}</span>
          <input type="text" data-f="suffix" value="${cfg.suffix}">
        </label>
        <label class="field">
          <span>${this._t("form.name")}</span>
          <input type="text" data-f="friendly_name" value="${cfg.friendly_name || ""}">
        </label>
        <div class="target-preview">${this._t("form.target")} <code>${entity.history_entity_id}</code></div>
        <div class="form-actions" data-actions>
          <button class="save-btn" data-action="save-entity" data-entity="${entity.entity_id}" ${pendingSave ? "disabled" : ""}>
            ${pendingSave ? this._t("form.saving") : this._t("form.save")}
          </button>
          <button class="ghost-btn" data-action="cancel-edit">${this._t("form.cancel")}</button>
          ${
            entity.tracked
              ? `<button class="ghost-btn" data-action="clear-ask" ${pendingClear ? "disabled" : ""}>${this._t("form.clear")}</button>`
              : ""
          }
          ${
            entity.tracked
              ? `<button class="remove-btn" data-action="remove-ask" ${pendingRemove ? "disabled" : ""}>${this._t("form.remove")}</button>`
              : ""
          }
        </div>
        <div class="confirm-row" data-confirm="clear" hidden>
          <span>${this._t("form.confirm_clear")}</span>
          <button class="remove-btn" data-action="clear-entity" data-entity="${entity.entity_id}" ${pendingClear ? "disabled" : ""}>
            ${pendingClear ? this._t("form.clearing") : this._t("form.confirm_clear_yes")}
          </button>
          <button class="ghost-btn" data-action="clear-cancel">${this._t("form.confirm_no")}</button>
        </div>
        <div class="confirm-row" data-confirm="remove" hidden>
          <span>${this._t("form.confirm_remove", { code: `<code>${entity.history_entity_id}</code>` })}</span>
          <button class="remove-btn" data-action="remove-entity" data-entity="${entity.entity_id}" ${pendingRemove ? "disabled" : ""}>
            ${pendingRemove ? this._t("form.removing") : this._t("form.confirm_yes")}
          </button>
          <button class="ghost-btn" data-action="remove-cancel">${this._t("form.confirm_no")}</button>
        </div>
      </div>`;
  }

  _renderCard(entity) {
    const opened = this._opened === entity.entity_id;
    const editing = this._editing === entity.entity_id;
    const statusClass = entity.tracked ? (entity.enabled ? "ok" : "paused") : "off";
    const statusText = entity.tracked
      ? entity.enabled
        ? this._t("status.tracked")
        : this._t("status.paused")
      : this._t("status.not_tracked");

    let bodyHtml = "";
    if (editing) {
      bodyHtml = this._renderEditForm(entity);
    } else if (opened) {
      bodyHtml = `
        <div class="hist-link-row">
          <button class="icon-btn" data-action="copy-id" data-copy="${entity.history_entity_id}" title="${this._t("card.copy_title")}">
            <ha-icon icon="mdi:content-copy"></ha-icon>
          </button>
          <span class="hist-id clickable" data-action="more-info" data-entity="${entity.history_entity_id}" title="${this._t("card.open_title")}">${entity.history_entity_id}</span>
        </div>
        <div class="preview-host" data-preview-for="${entity.entity_id}">${this._renderPreview(entity)}</div>
        <div class="card-actions">
          <button class="save-btn" data-action="edit-entity" data-entity="${entity.entity_id}">${this._t("card.edit")}</button>
        </div>`;
    }

    return `
      <div class="entity-card ${opened || editing ? "expanded" : ""}" data-search="${this._esc(this._searchText(entity))}" ${this._trackQuery.trim() && !this._searchText(entity).includes(this._trackQuery.trim().toLowerCase()) ? "hidden" : ""}>
        <div class="entity-header" data-action="toggle-open" data-entity="${entity.entity_id}">
          <span class="status-dot ${statusClass}"></span>
          <div class="entity-name">
            <div class="name">${entity.name}</div>
            <div class="id clickable" data-action="more-info" data-entity="${entity.entity_id}">${entity.entity_id}</div>
          </div>
          <div class="entity-value" data-value-for="${entity.entity_id}">${this._fmt(entity.value, entity.unit)}</div>
          <div class="entity-status">${statusText}</div>
        </div>
        ${bodyHtml}
      </div>`;
  }

  _collectForm(container) {
    const get = (f) => container.querySelector(`[data-f="${f}"]`);
    return {
      enabled: get("enabled").checked,
      tracking_mode: get("tracking_mode").value,
      interval_value: parseInt(get("interval_value").value, 10) || 1,
      interval_unit: get("interval_unit").value,
      depth: parseInt(get("depth").value, 10) || 2,
      offset_seconds: parseInt(get("offset_seconds").value, 10) || 0,
      suffix: get("suffix").value.trim(),
      friendly_name: get("friendly_name").value.trim(),
    };
  }

  _renderNav() {
    const item = (view, label, count, extra = "") => `
      <button class="nav-item ${extra} ${this._view === view ? "active" : ""}" data-action="switch-view" data-view="${view}">
        <span>${label}</span>
        ${count === null ? "" : `<span class="count">${count}</span>`}
      </button>`;

    const subs = CATEGORY_KEYS.map((key) => ({ key, n: this._countFor(`cat:${key}`) }))
      .filter((x) => x.n > 0)
      .map((x) => item(`cat:${x.key}`, this._t(`category.${x.key}`), x.n, "sub"))
      .join("");

    return `
      ${item("tracked", this._t("nav.tracked"), this._countFor("tracked"))}
      ${subs}
      <div class="nav-divider"></div>
      ${item("add", this._t("nav.add"), null)}
      ${item("setup", this._t("nav.setup"), null)}`;
  }

  _renderSettings() {
    const d = this._defaults || {};
    return `
      <div class="settings">
        <h2>${this._t("settings.defaults_title")}</h2>
        <p class="hint">${this._t("settings.defaults_hint")}</p>
        <div class="settings-form" data-settings-form>
          <label class="field">
            <span>${this._t("form.mode")}</span>
            <select data-f="tracking_mode">
              <option value="value" ${d.tracking_mode === "value" ? "selected" : ""}>${this._t("mode.value")}</option>
              <option value="counter" ${d.tracking_mode === "counter" ? "selected" : ""}>${this._t("mode.counter")}</option>
            </select>
          </label>
          <label class="field">
            <span>${this._t("form.interval")}</span>
            <span class="inline">
              <input type="number" min="1" data-f="interval_value" value="${d.interval_value}">
              <select data-f="interval_unit">
                ${UNIT_KEYS.map((u) => `<option value="${u}" ${d.interval_unit === u ? "selected" : ""}>${this._t(`unit.${u}`)}</option>`).join("")}
              </select>
            </span>
          </label>
          <label class="field">
            <span>${this._t("form.depth")}</span>
            <input type="number" min="2" max="500" data-f="depth" value="${d.depth}">
          </label>
          <label class="field">
            <span>${this._t("form.offset")}</span>
            <input type="number" step="1" data-f="offset_seconds" value="${d.offset_seconds ?? 0}">
          </label>
          <label class="field">
            <span>${this._t("form.suffix")}</span>
            <input type="text" data-f="suffix" value="${d.suffix}">
          </label>
          <label class="field">
            <span>${this._t("settings.language")}</span>
            <select data-f="language">
              ${LANGUAGES.map((l) => `<option value="${l}" ${this._language === l ? "selected" : ""}>${(LANG_CACHE[l] && LANG_CACHE[l].language_name) || l}</option>`).join("")}
            </select>
          </label>
        </div>
        <button class="save-btn settings-save" data-action="save-settings">${this._t("settings.save")}</button>

        <h2>${this._t("settings.export_import_title")}</h2>
        <p class="hint">${this._t("settings.export_import_hint")}</p>
        <div class="settings-row">
          <button data-action="export-settings">${this._t("settings.export_button")}</button>
          <label class="import-label">
            ${this._t("settings.import_label")}
            <input type="file" accept="application/json" data-action="import-settings">
          </label>
        </div>
      </div>`;
  }

  _addCandidates() {
    const q = this._addQuery.trim().toLowerCase();
    return this._entities.filter((e) => {
      if (e.tracked) return false;
      if (this._addCat !== "all" && this._category(e) !== this._addCat) return false;
      return !q || `${e.name} ${e.entity_id}`.toLowerCase().includes(q);
    });
  }

  _renderAddResults() {
    const q = this._addQuery.trim().toLowerCase();
    if (!q && this._addCat === "all") {
      return `<div class="empty">${this._t("add.hint_choose")}</div>`;
    }
    const list = this._addCandidates();
    const shown = list.slice(0, ADD_RESULTS_LIMIT);
    const row = (id, name, valueText) => `
      <div class="add-row">
        <div class="add-info">
          <div class="name">${this._esc(name)}</div>
          <div class="id">${this._esc(id)}</div>
        </div>
        <div class="entity-value">${this._esc(valueText)}</div>
        <button class="save-btn" data-action="add-from-list" data-entity="${this._esc(id)}" ${this._addPending ? "disabled" : ""}>${this._t("nav.add")}</button>
      </div>`;

    let html = shown.map((e) => row(e.entity_id, e.name, this._fmt(e.value, e.unit))).join("");

    const exact = this._addQuery.trim();
    if (
      /^[a-z_]+\.[a-z0-9_]+$/.test(exact) &&
      this._hass.states[exact] &&
      !this._entities.some((e) => e.entity_id === exact)
    ) {
      const st = this._hass.states[exact];
      html += row(exact, (st.attributes && st.attributes.friendly_name) || exact, st.state);
    }

    if (!html) return `<div class="empty">${this._t("add.no_results")}</div>`;
    if (list.length > ADD_RESULTS_LIMIT) {
      html += `<div class="hint">${this._t("add.showing", { shown: ADD_RESULTS_LIMIT, total: list.length })}</div>`;
    }
    return html;
  }

  _renderAdd() {
    const untracked = this._entities.filter((e) => !e.tracked);
    const chip = (key, label, count) => `
      <button class="chip ${this._addCat === key ? "active" : ""}" data-action="add-cat" data-cat="${key}">
        ${label}<span class="chip-count">${count}</span>
      </button>`;
    const chips =
      chip("all", this._t("add.all_chip"), untracked.length) +
      CATEGORY_KEYS.map((key) => ({ key, n: untracked.filter((e) => this._category(e) === key).length }))
        .filter((x) => x.n > 0)
        .map((x) => chip(x.key, this._t(`category.${x.key}`), x.n))
        .join("");

    return `
      <div class="search-box">
        <input type="search" placeholder="${this._t("add.search_placeholder")}" data-add-search value="${this._esc(this._addQuery)}">
      </div>
      <div class="chips">${chips}</div>
      <div class="add-results" data-add-results>${this._renderAddResults()}</div>`;
  }

  _renderMain() {
    const visible = this._entities.filter((e) => this._matchesView(e, this._view));
    if (visible.length === 0) {
      return `<div class="empty">${this._t("track.nothing")}</div>`;
    }
    return `
      <div class="search-box">
        <input type="search" placeholder="${this._t("track.search_placeholder")}" data-track-search value="${this._esc(this._trackQuery)}">
      </div>
      <div class="list" data-track-list>${visible.map((e) => this._renderCard(e)).join("")}</div>
      <div class="empty" data-track-empty hidden>${this._t("track.no_results")}</div>`;
  }

  _applyTrackFilter() {
    if (!this.shadowRoot) return;
    const q = this._trackQuery.trim().toLowerCase();
    let shown = 0;
    this.shadowRoot.querySelectorAll("[data-track-list] .entity-card").forEach((card) => {
      const hit = !q || card.dataset.search.includes(q);
      card.hidden = !hit;
      if (hit) shown += 1;
    });
    const empty = this.shadowRoot.querySelector("[data-track-empty]");
    if (empty) empty.hidden = shown !== 0;
  }

  _render() {
    if (!this.shadowRoot) return;

    if (this._entities && this._view.startsWith("cat:") && this._countFor(this._view) === 0) {
      this._view = "tracked";
    }

    const body = !this._entities
      ? `<div class="loading">${this._error ? this._error : this._t("loading")}</div>`
      : this._view === "setup"
        ? this._renderSettings()
        : this._view === "add"
          ? this._renderAdd()
          : this._renderMain();

    const nav = !this._entities ? "" : this._renderNav();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100%;
          background: var(--primary-background-color);
          color: var(--primary-text-color);
        }
        .toolbar {
          display: flex;
          align-items: center;
          padding: 0 16px;
          height: 64px;
          background: var(--app-header-background-color, var(--primary-color));
          color: var(--app-header-text-color, white);
        }
        .toolbar h1 { font-size: 1.25em; font-weight: 400; margin: 0; }
        .layout { display: flex; height: calc(100% - 64px); }
        .side-nav {
          width: 200px;
          flex-shrink: 0;
          border-right: 1px solid var(--divider-color, #444);
          padding: 8px 0;
          overflow-y: auto;
        }
        .nav-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 10px 16px;
          background: none;
          border: none;
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 0.95em;
          text-align: left;
        }
        .nav-item:hover { background: var(--secondary-background-color, rgba(255,255,255,0.05)); }
        .nav-item.active {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          font-weight: 500;
        }
        .nav-item .count { opacity: 0.7; font-size: 0.85em; }
        .nav-divider { height: 1px; background: var(--divider-color, #444); margin: 8px 16px; }
        .content { flex: 1; overflow-y: auto; padding: 16px; }
        .loading, .error, .empty { padding: 32px; text-align: center; opacity: 0.7; }
        .error { color: var(--error-color, red); padding: 10px 16px; text-align: left; }
        .error.warning { color: var(--success-color, #4caf50); }
        .list { display: flex; flex-direction: column; gap: 10px; max-width: 720px; }
        .entity-card[hidden] { display: none; }
        .nav-item.sub { padding-left: 30px; font-size: 0.88em; }
        .search-box { max-width: 720px; margin-bottom: 12px; }
        .search-box input {
          width: 100%; box-sizing: border-box;
          background: var(--card-background-color, #1c1c1c);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #444);
          border-radius: 6px; padding: 9px 10px; font-size: 0.95em;
        }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; max-width: 720px; margin-bottom: 14px; }
        .chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 16px; cursor: pointer; font-size: 0.85em;
          background: none; color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #444);
        }
        .chip.active { background: var(--primary-color); color: var(--text-primary-color, white); border-color: var(--primary-color); }
        .chip-count { opacity: 0.7; font-size: 0.85em; }
        .add-results { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
        .add-row {
          display: flex; align-items: center; gap: 12px; padding: 10px 14px;
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
          background: var(--card-background-color, #1c1c1c);
        }
        .add-info { flex: 1; min-width: 0; }
        .add-info .name { font-weight: 500; }
        .add-info .id { font-size: 0.8em; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .entity-card {
          border: 1px solid var(--divider-color, #444);
          border-radius: 8px;
          background: var(--card-background-color, #1c1c1c);
          overflow: hidden;
        }
        .entity-card.expanded { border-color: var(--primary-color); }
        .summary { padding: 0 16px 8px; }
        .summary-grid { display: grid; grid-template-columns: 110px 1fr; gap: 3px 10px; font-size: 0.85em; }
        .summary-grid span { opacity: 0.65; }
        .summary-grid b { font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
        .summary-grid code, .confirm-row code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; }
        .preview-host { padding: 0 16px 8px; }
        .hist-link-row { display: flex; align-items: center; gap: 6px; padding: 0 16px 6px; }
        .hist-id { font-size: 0.85em; font-family: var(--code-font-family, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hist-id.clickable { cursor: pointer; text-decoration: underline dotted; }
        .hist-id.clickable:hover { color: var(--primary-color); }
        .icon-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; padding: 0; border-radius: 6px; cursor: pointer;
          background: none; color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #444);
          --mdc-icon-size: 18px;
        }
        .icon-btn:hover { border-color: var(--primary-color); color: var(--primary-color); }
        .icon-btn.copied { color: var(--success-color, #4caf50); border-color: var(--success-color, #4caf50); }
        .card-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 16px 14px; }
        .ghost-btn {
          padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em;
          background: none; color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #444);
        }
        .confirm-row {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 0.85em; padding: 10px; border-radius: 6px;
          border: 1px solid var(--error-color, #f44336);
        }
        .confirm-row[hidden], .form-actions[hidden] { display: none; }
        .confirm-row span { flex: 1; min-width: 200px; }
        .entity-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
        }
        .status-dot {
          width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
          background: var(--disabled-text-color, #888);
        }
        .status-dot.ok { background: var(--success-color, #4caf50); }
        .status-dot.paused { background: #ff9800; }
        .status-dot.off { background: var(--disabled-text-color, #666); }
        .entity-name { flex: 1; min-width: 0; }
        .entity-name .name { font-weight: 500; }
        .entity-name .id {
          font-size: 0.8em; opacity: 0.6; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap;
        }
        .entity-name .id.clickable { text-decoration: underline dotted; }
        .entity-name .id.clickable:hover { opacity: 1; }
        .entity-value { font-weight: 500; flex-shrink: 0; }
        .entity-status { font-size: 0.8em; opacity: 0.7; width: 90px; text-align: right; flex-shrink: 0; }
        .edit-form {
          padding: 4px 16px 16px;
          border-top: 1px solid var(--divider-color, #444);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .field { display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
        .field.checkbox-field { flex-direction: row; align-items: center; gap: 8px; }
        .field select, .field input[type="text"], .field input[type="number"] {
          background: var(--card-background-color, #1c1c1c);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #444);
          border-radius: 4px;
          padding: 6px 8px;
          font-size: 0.95em;
        }
        .field .inline { display: flex; gap: 8px; }
        .field .inline input[type="number"] { width: 80px; }
        .field .inline select { flex: 1; }
        .hint { font-size: 0.8em; opacity: 0.65; }
        .target-preview { font-size: 0.85em; opacity: 0.8; }
        .target-preview code {
          background: rgba(255,255,255,0.08);
          padding: 1px 5px;
          border-radius: 4px;
        }
        .preview { border-top: 1px dashed var(--divider-color, #444); padding-top: 10px; }
        .preview-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.8em; opacity: 0.8; margin-bottom: 4px; flex-wrap: wrap; gap: 6px; }
        .full-badge {
          display: inline-flex; align-items: center; gap: 4px;
          color: var(--success-color, #4caf50);
          font-weight: 500; opacity: 1;
          --mdc-icon-size: 14px;
        }
        .time-badge {
          display: inline-flex; align-items: center; gap: 4px;
          margin-left: auto;
          font-size: 0.9em; opacity: 0.85;
          --mdc-icon-size: 14px;
        }
        .preview-empty { font-size: 0.8em; opacity: 0.6; }
        .chart-container {
          position: relative;
          touch-action: pan-y;
          user-select: none;
        }
        .sparkline { width: 100%; height: 70px; display: block; border-bottom: 1px solid var(--divider-color, #444); cursor: crosshair; overflow: visible; }
        .chart-tooltip {
          margin-top: 6px;
          padding: 6px 10px;
          background: rgba(0, 0, 0, 0.75);
          border: 1px solid var(--primary-color);
          border-radius: 6px;
          font-size: 0.8em;
          text-align: center;
          color: var(--primary-text-color);
        }
        .chart { display: flex; gap: 8px; margin: 6px 0 2px; }
        .chart-y { display: flex; flex-direction: column; justify-content: space-between; font-size: 0.7em; opacity: 0.7; text-align: right; min-width: 64px; height: 70px; }
        .chart-body { flex: 1; min-width: 0; }
        .chart-x { display: flex; justify-content: space-between; font-size: 0.7em; opacity: 0.7; margin-top: 2px; }
        .preview-sub { font-size: 0.8em; opacity: 0.7; margin-bottom: 2px; margin-top: 8px; }
        .entry-row { display: flex; justify-content: space-between; font-size: 0.85em; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .reset-tag { color: #ff9800; font-style: normal; font-size: 0.85em; }
        .form-actions { display: flex; gap: 10px; margin-top: 4px; }
        .save-btn {
          padding: 8px 16px; border-radius: 6px; border: none;
          background: var(--primary-color); color: var(--text-primary-color, white);
          cursor: pointer; font-size: 0.9em;
        }
        .save-btn:disabled { opacity: 0.5; cursor: default; }
        .remove-btn {
          padding: 8px 16px; border-radius: 6px; border: none;
          background: var(--error-color, #f44336); color: white;
          cursor: pointer; font-size: 0.9em;
        }
        .remove-btn:disabled { opacity: 0.5; cursor: default; }
        .settings { max-width: 560px; }
        .settings h2 { font-size: 1.05em; margin: 20px 0 8px; }
        .settings h2:first-child { margin-top: 0; }
        .settings-form { display: flex; flex-direction: column; gap: 10px; max-width: 320px; }
        .settings-save { margin-top: 14px; }
        .settings-row { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
        .settings-row button, .import-label {
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #444);
          background: none;
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 0.9em;
        }
        .import-label input[type="file"] { display: none; }
      </style>
      <div class="toolbar"><h1>PSB History Engine</h1></div>
      <div class="layout">
        <nav class="side-nav">${nav}</nav>
        <div class="content">
          ${this._error ? `<div class="error ${this._errorIsWarning ? "warning" : ""}">${this._error}</div>` : ""}
          ${body}
        </div>
      </div>
    `;

    const bindActions = (root) => root.querySelectorAll("[data-action]").forEach((el) => {
      const action = el.dataset.action;
      const entityId = el.dataset.entity;

      if (action === "switch-view") {
        el.addEventListener("click", () => this._switchView(el.dataset.view));
      } else if (action === "edit-entity") {
        el.addEventListener("click", () => this._startEdit(entityId));
      } else if (action === "cancel-edit") {
        el.addEventListener("click", () => this._cancelEdit());
      } else if (action === "copy-id") {
        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          const ok = await this._copyText(el.dataset.copy);
          const icon = el.querySelector("ha-icon");
          if (icon) icon.setAttribute("icon", ok ? "mdi:check" : "mdi:alert-circle-outline");
          el.classList.toggle("copied", ok);
          setTimeout(() => {
            if (icon) icon.setAttribute("icon", "mdi:content-copy");
            el.classList.remove("copied");
          }, 1500);
        });
      } else if (action === "toggle-open") {
        el.addEventListener("click", () => this._toggleOpen(entityId));
      } else if (action === "remove-ask") {
        el.addEventListener("click", () => {
          const form = el.closest(".edit-form");
          form.querySelector("[data-actions]").hidden = true;
          form.querySelector('[data-confirm="remove"]').hidden = false;
        });
      } else if (action === "remove-cancel") {
        el.addEventListener("click", () => {
          const form = el.closest(".edit-form");
          form.querySelector('[data-confirm="remove"]').hidden = true;
          form.querySelector("[data-actions]").hidden = false;
        });
      } else if (action === "clear-ask") {
        el.addEventListener("click", () => {
          const form = el.closest(".edit-form");
          form.querySelector("[data-actions]").hidden = true;
          form.querySelector('[data-confirm="clear"]').hidden = false;
        });
      } else if (action === "clear-cancel") {
        el.addEventListener("click", () => {
          const form = el.closest(".edit-form");
          form.querySelector('[data-confirm="clear"]').hidden = true;
          form.querySelector("[data-actions]").hidden = false;
        });
      } else if (action === "clear-entity") {
        el.addEventListener("click", () => this._clearData(entityId));
      } else if (action === "more-info") {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this._openMoreInfo(entityId);
        });
      } else if (action === "save-entity") {
        el.addEventListener("click", () => {
          const container = this.shadowRoot.querySelector(
            `.edit-form[data-entity="${CSS.escape(entityId)}"]`
          );
          const form = this._collectForm(container);
          this._saveEntity(entityId, form);
        });
      } else if (action === "remove-entity") {
        el.addEventListener("click", () => this._removeEntity(entityId));
      } else if (action === "save-settings") {
        el.addEventListener("click", () => {
          const container = this.shadowRoot.querySelector("[data-settings-form]");
          const get = (f) => container.querySelector(`[data-f="${f}"]`);
          this._saveSettings({
            tracking_mode: get("tracking_mode").value,
            interval_value: parseInt(get("interval_value").value, 10) || 1,
            interval_unit: get("interval_unit").value,
            depth: parseInt(get("depth").value, 10) || 2,
            offset_seconds: parseInt(get("offset_seconds").value, 10) || 0,
            suffix: get("suffix").value.trim(),
            language: get("language").value,
          });
        });
      } else if (action === "export-settings") {
        el.addEventListener("click", () => this._exportSettings());
      } else if (action === "import-settings") {
        el.addEventListener("change", (e) => this._importSettings(e.target.files[0]));
      } else if (action === "add-cat") {
        el.addEventListener("click", () => {
          this._addCat = el.dataset.cat;
          this._render();
        });
      } else if (action === "add-from-list") {
        el.addEventListener("click", () => this._addEntity(entityId));
      }
    });
    this._bindActions = bindActions;
    bindActions(this.shadowRoot);

    // Podpięcie zdarzeń celownika dla wykresów przy głównym renderowaniu
    this.shadowRoot.querySelectorAll('.preview-host').forEach((host) => {
      const entityId = host.dataset.previewFor;
      const entity = this._entities && this._entities.find((e) => e.entity_id === entityId);
      if (entity) {
        const state = this._hass.states[entity.history_entity_id];
        const history = state && state.attributes ? state.attributes.history : [];
        this._attachChartEvents(host, history, entity.unit);
      }
    });

    const addSearch = this.shadowRoot.querySelector("[data-add-search]");
    if (addSearch) {
      const refreshResults = () => {
        const host = this.shadowRoot.querySelector("[data-add-results]");
        host.innerHTML = this._renderAddResults();
        this._bindActions(host);
      };
      addSearch.addEventListener("input", (e) => {
        this._addQuery = e.target.value;
        refreshResults();
      });
      addSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const list = this._addCandidates();
          if (list.length === 1) this._addEntity(list[0].entity_id);
        }
      });
    }

    const trackSearch = this.shadowRoot.querySelector("[data-track-search]");
    if (trackSearch) {
      trackSearch.addEventListener("input", (e) => {
        this._trackQuery = e.target.value;
        this._applyTrackFilter();
      });
    }

    this.shadowRoot.querySelectorAll(".edit-form").forEach((container) => {
      const update = () => {
        const iv = container.querySelector('[data-f="interval_value"]').value;
        const iu = container.querySelector('[data-f="interval_unit"]').value;
        const dep = container.querySelector('[data-f="depth"]').value;
        const hintEl = container.querySelector("[data-coverage]");
        if (hintEl) hintEl.textContent = `${this._t("coverage.prefix")}${this._coverageText(iv, iu, dep)}`;
      };
      container
        .querySelectorAll('[data-f="interval_value"],[data-f="interval_unit"],[data-f="depth"]')
        .forEach((el) => {
          el.addEventListener("input", update);
          el.addEventListener("change", update);
        });
    });
  }
}

customElements.define("psb-history-engine-panel", PsbHistoryEnginePanel);
