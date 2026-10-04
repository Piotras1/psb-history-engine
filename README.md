![HACS](https://img.shields.io/badge/HACS-Custom-orange?style=flat-square)
![Downloads](https://img.shields.io/github/downloads/Piotras1/psb-history-engine/psb_history_engine.zip?logo=homeassistant&color=41BDF5&displayAssetName=false)
![GitHub Stars](https://img.shields.io/github/stars/Piotras1/psb-history-engine?style=flat-square&logo=github&label=stars&color=brightgreen)
![GitHub Issues](https://img.shields.io/github/issues/Piotras1/psb-history-engine?style=flat-square&logo=github&label=issues)
[![GitHub Release](https://img.shields.io/github/v/release/Piotras1/psb-history-engine?style=flat-square&logo=github&label=release)](https://github.com/Piotras1/psb-history-engine/releases)
![GitHub Release Date](https://img.shields.io/github/release-date/Piotras1/psb-history-engine?style=flat-square&logo=github&label=released)

# PSB History Engine

<img src="https://raw.githubusercontent.com/Piotras1/psb-history-engine/refs/heads/main/img/PSB-History-Engine.jpg" alt="PSB History Engine Showcase" width="100%">

A lightweight, high-performance, RAM-based history buffer for Home Assistant. Pick any numeric entity, select your sampling frequency and buffer depth, and **PSB History Engine** creates a companion `sensor.<name>_history` entity holding a rolling array of `[timestamp, value]` points directly in its state attributes.

No YAML, no complex automations, no `input_text` hacks, and zero recorder/database queries — everything is managed from a full sidebar panel, serving instant history data to your dashboard cards directly from RAM.

---

## ⚡ Why PSB History Engine?

Home Assistant's built-in history is backed by the recorder database. While essential for long-term storage, querying SQLite/MariaDB just to render a 24-hour daily chart on your dashboard is slow and creates unnecessary disk I/O.

Traditional workarounds (like appending readings to `input_text` via automations) suffer from severe limitations:
- **255-character limit** on `input_text` states.
- **Time drift**: Sampling happens whenever the automation fires rather than on clean clock boundaries.
- **Tight coupling**: Complex parsing logic is embedded directly inside card configurations.

**PSB History Engine** solves this by providing clean, aligned, generic history entities that any card can read instantaneously.

---

## ✨ Features

- **Supports any numeric entity**: `sensor`, `number`, `input_number`, `counter`.
- **Per-entity custom tuning**: Sampling interval (seconds / minutes / hours / days), buffer depth (up to 500 points), and precision alignment offsets.
- **Dual tracking modes**:
  - *Current value*: For temperature, humidity, power, or battery levels.
  - *Increasing counter*: For energy, gas, or water meters. Automatically handles periodic meter resets by flagging them as `"reset"` instead of negative deltas.
- **Zero database overhead**: History buffers live strictly in memory and persist across restarts via Home Assistant's native Restore State mechanism.
- **Dedicated Sidebar Panel**:
  - **Tracked**: Displays entities grouped by auto-detected categories (*Energy, Power, Climate, Batteries, Water/Gas, Other*) with live expanded preview charts and edit controls.
  - **Add**: Fast, search-driven picker designed for instances with hundreds of entities.
  - **Setup**: Global defaults, panel language selector, and configuration backup/restore.
- **Multi-language support**: Built-in translations for 10 languages (*English, Polish, German, French, Spanish, Italian, Czech, Portuguese, Russian, Swedish*).

---

## 🛠️ Installation

### HACS (Recommended)
1. Open **HACS** → **Integrations** → top right menu (⋮) → **Custom repositories**.
2. Paste this repository URL and select **Integration** as the category.
3. Click **Install**, then restart Home Assistant.

### Manual
1. Download the latest release.
2. Copy the `custom_components/history_engine` directory into your Home Assistant `config/custom_components/` folder.
3. Restart Home Assistant.

---

## 🚀 Getting Started

1. Go to **Settings** → **Devices & Services** → **Add Integration** → **PSB History Engine**.
2. Open the new **PSB History Engine** item in your Home Assistant sidebar.
3. Navigate to **Add**, search for an entity (e.g., `sensor.living_room_temperature`), and click **Add**.
4. Navigate to **Tracked**, expand the entity row to fine-tune its tracking mode, interval, or offset.
5. Copy the generated `sensor.<name>_history` entity ID and use it in your **Piotras Smart Button** card!

---

## 📊 Created History Entity Structure

For a tracked source entity `sensor.power_meter`, the integration generates `sensor.power_meter_history` with the following attribute structure:

```yaml
state: 24                    # Number of points currently buffered
attributes:
  source_entity: sensor.power_meter
  tracking_mode: counter     # "value" or "counter"
  interval_seconds: 3600
  offset_seconds: -60
  depth: 48
  last_raw_value: 12.34
  unit_of_measurement: points
  source_unit_of_measurement: kWh
  history:
    - [1735689600, 0.42]
    - [1735693200, 0.51]
    - [1735696800, 0.07, "reset"]   # Meter reset flagged automatically
    - [1735700400, 0.19]
```

Reading attributes.history from a dashboard card is a lightweight, local state read with zero backend query overhead.

## ⏱️ Interval Alignment & Offsets

Readings align automatically with wall-clock grids rather than integration startup times. On an hourly interval, samples occur precisely at HH:00:00.

The offset setting (in seconds) shifts this grid. For example, setting an hourly interval with an offset = -60 forces samples to land at HH:59:00 — capturing the exact final reading before utility tariff changes or daily counter resets.
## 🛡️ Buffer Depth & Safety Limits

Home Assistant logs a warning if entity state attributes exceed 16 KiB. To guarantee long-term stability regardless of entity name length or value size, buffer depth is capped at 500 points per entity (~10–12 KiB).

- Hourly sampling: 500 points = ~21 days of history.
- Daily sampling: 500 points = >1.3 years of history.

### This limit applies strictly to this integration's buffer attributes and does not affect your global Home Assistant Recorder settings.

## 🎨 Dashboards & Visualization

The history is stored in the `history` attribute of the generated entity, so a dashboard card can read it instantly from the frontend, with no database query involved.

Home Assistant's built-in graph cards (History Graph, Statistics Graph, Energy dashboard) read from the recorder and cannot plot an array stored in a state attribute. To visualize `attributes.history`, use a custom card that can read entity attributes through JavaScript templates.

Currently supported:

- **[Piotras Smart Button (PSB)](https://github.com/Piotras1/piotras-smart-button)**: via custom JavaScript templates or ready-made [Custom Data Modules](https://github.com/Piotras1/piotras-smart-button/discussions/categories/custom-data-modules)
- **[Custom Button-card (CB)](https://github.com/custom-cards/button-card)**: via custom JavaScript templates

**Notes for card authors**

- Timestamps are Unix time in **seconds** (not milliseconds).
- In `counter` mode the buffer stores the raw meter values. A sample taken right after a meter reset is flagged with `"reset"`, so a consumer should treat its value as the delta for that interval instead of subtracting the previous value.

For complete YAML configurations, setup guides and ready-made dashboard templates (Energy, Climate, Battery and more), see the visualization guide:

👉 **[History Templates & Card Examples](docs/TEMPLATES.md)**

---

## 📄 License

MIT — free to use, modify, and share.

---

*Created by Piotras. Strictly engineered for reliability.*

