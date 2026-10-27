[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/default)
![Downloads](https://img.shields.io/github/downloads/Piotras1/psb-history-engine/psb_history_engine.zip?logo=homeassistant&color=41BDF5&displayAssetName=false)
![GitHub Stars](https://img.shields.io/github/stars/Piotras1/psb-history-engine?style=flat-square&logo=github&label=stars&color=brightgreen)
![GitHub Issues](https://img.shields.io/github/issues/Piotras1/psb-history-engine?style=flat-square&logo=github&label=issues)
[![GitHub Release](https://img.shields.io/github/v/release/Piotras1/psb-history-engine?style=flat-square&logo=github&label=release)](https://github.com/Piotras1/psb-history-engine/releases)
![GitHub Release Date](https://img.shields.io/github/release-date/Piotras1/psb-history-engine?style=flat-square&logo=github&label=released)

# PSB History Engine

<img src="https://raw.githubusercontent.com/Piotras1/psb-history-engine/refs/heads/main/img/PSB-History-Engine.jpg" alt="PSB History Engine Showcase" width="100%">

A lightweight, high-performance, RAM-based history buffer for Home Assistant. Pick any numeric entity (or a switch / binary sensor), select your sampling frequency and buffer depth, and **PSB History Engine** creates a companion `sensor.<name>_history` entity holding a rolling array of `[timestamp, value]` points directly in its state attributes.

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

## 🆕 What's new in 1.1.0

- **On / off tracking**: switches, lights, binary sensors and other on/off entities are saved as an event log — one entry per switch-on / switch-off, with its exact time.
- **Several trackings per entity**: track the same source entity up to 5 times with different mode, interval and depth.
- **Copy to PSB**: one click generates a ready-to-paste Piotras Smart Button card, with a separate, shorter card for each tracking mode.
- **Incompatible / broken view**: trackings whose source entity disappeared (or stopped being numeric) are listed and can be removed in one go.
- **Security hardening**: the panel and all of its commands are restricted to administrators, and every value shown in the panel is escaped.
- **Fix**: changing the number of entries of an on/off tracking no longer switches it to another mode.

---

## ✨ Features

- **Supports numeric and on/off entities**:
  - Numeric: `sensor`, `number`, `input_number`, `counter`.
  - On / off: `binary_sensor`, `switch`, `light`, `input_boolean`, `fan`.
- **Per-entity custom tuning**: Sampling interval (seconds / minutes / hours / days), buffer depth (up to 500 points), and precision alignment offsets.
- **Three tracking modes**:
  - *Current value*: For temperature, humidity, power, or battery levels.
  - *Increasing counter*: For energy, gas, or water meters. Automatically handles periodic meter resets by flagging them as `"reset"` instead of negative deltas.
  - *On / off*: For switches, lights and binary sensors. An event log with one entry per state change — no sampling interval and no offset, the number of entries is the only setting (100 by default).
- **Multiple trackings per entity**: Up to 5 independent trackings of the same source entity (for example a 15-minute and a daily buffer), each with its own history entity.
- **Zero database overhead**: History buffers live strictly in memory and persist across restarts via Home Assistant's native Restore State mechanism.
- **Dedicated Sidebar Panel** (administrators only):
  - **Tracked**: Displays entities grouped by auto-detected categories (*Energy, Power, Temperature, Humidity, Batteries, Water/Gas, On/off, Other*) with live expanded preview charts and edit controls. Entities with several trackings can also be browsed together in the **Families** view.
  - **Incompatible / broken**: Appears when a tracking can no longer work (source entity removed or no longer numeric), so it can be cleaned up.
  - **Add**: Fast, search-driven picker designed for instances with hundreds of entities.
  - **Setup**: Global defaults, panel language selector, and configuration backup/restore (export and import).
- **Copy to PSB**: Generates a ready-to-paste card for [Piotras Smart Button](https://github.com/Piotras1/piotras-smart-button) (see [below](#-copy-to-psb)).
- **Multi-language support**: Built-in translations for 10 languages (*English, Polish, German, French, Spanish, Italian, Czech, Portuguese, Russian, Swedish*).


## 🛠️ Installation

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Piotras1&repository=psb-history-engine&category=integration)

### HACS (Recommended)
1. Open **HACS** → **Integrations** → top right menu (⋮) → **Custom repositories**.
2. Paste this repository URL and select **Integration** as the category.
3. Click **Install**, then restart Home Assistant.

### Manual
1. Download the latest release.
2. Copy the `custom_components/psb_history_engine` directory into your Home Assistant `config/custom_components/` folder.
3. Restart Home Assistant.


## 🚀 Getting Started

1. Go to **Settings** → **Devices & Services** → **Add Integration** → **PSB History Engine**.
2. Open the new **PSB History Engine** item in your Home Assistant sidebar.
3. Navigate to **Add**, search for an entity (e.g., `sensor.living_room_temperature`), and click **Add**.
4. Navigate to **Tracked**, expand the entity row to fine-tune its tracking mode, interval, or offset.
5. Click **Copy to PSB** to get a ready-made card, or copy the generated `sensor.<name>_history` entity ID and use it in your **Piotras Smart Button** card!

> Switches, lights and binary sensors are added the same way and are tracked automatically as on / off.

---

## 📋 Copy to PSB

Every tracked entity has a **Copy to PSB** button. It opens a short dialog where you can set the card title, colour and unit and switch parts of the card on or off, then copies the card code to the clipboard. Paste it as a manual card in your dashboard (Piotras Smart Button must be installed).

The card is chosen by the tracking mode, so you only copy the code that kind of entity needs:

| Tracking mode | Card |
|---|---|
| Current value | Line chart of the sampled values |
| Increasing counter | Line chart of consumption per hour (complete hours only, reset-safe) |
| On / off | Bar of ON and OFF periods built from the saved changes |

The dialog offers only the options that make sense for the chosen card.

---

## 📊 Created History Entity Structure

For a tracked source entity `sensor.power_meter`, the integration generates `sensor.power_meter_history` with the following attribute structure:

```yaml
state: 24                    # Number of points currently buffered
attributes:
  source_entity: sensor.power_meter
  tracking_slot: 0           # 0 = first tracking, 1-4 = extra trackings of the same entity
  tracking_mode: counter     # "value", "counter" or "on_off"
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

An **on / off** tracking stores one entry per state change instead of one per interval: `1` = on, `0` = off, `-1` = unavailable / unknown.

```yaml
state: 4
attributes:
  source_entity: switch.boiler
  tracking_slot: 0
  tracking_mode: on_off
  interval_seconds: null     # no sampling interval in this mode
  offset_seconds: null
  depth: 100
  last_raw_value: 0
  history:
    - [1735689600, 1]        # switched on
    - [1735693200, 0]        # switched off
    - [1735696800, -1]       # unavailable / unknown
    - [1735700400, 1]
```

The first tracking of an entity is `sensor.<name>_history`. Extra trackings of the same entity get a number added: `sensor.<name>_history_2`, `sensor.<name>_history_3`, and so on. The `_history` ending can be changed per tracking (or globally in **Setup**).

Reading `attributes.history` from a dashboard card is a lightweight, local state read with zero backend query overhead.


## ⏱️ Interval Alignment & Offsets

Readings align automatically with wall-clock grids rather than integration startup times. On an hourly interval, samples occur precisely at HH:00:00.

The offset setting (in seconds) shifts this grid. For example, setting an hourly interval with an offset = -60 forces samples to land at HH:59:00 — capturing the exact final reading before utility tariff changes or daily counter resets.

Interval and offset apply to the *current value* and *increasing counter* modes. An *on / off* tracking has neither: it records a change at the moment it happens.

## 🛡️ Buffer Depth & Safety Limits

Home Assistant logs a warning if entity state attributes exceed 16 KiB. To guarantee long-term stability regardless of entity name length or value size, buffer depth is capped at 500 points per entity (~10–12 KiB).

- Hourly sampling: 500 points = ~21 days of history.
- Daily sampling: 500 points = >1.3 years of history.

> **This limit applies strictly to this integration's buffer attributes and does not affect your global Home Assistant Recorder settings.**

---

## 🔒 Security

The sidebar panel and every command it uses (adding, editing and removing trackings, clearing buffers, saving, exporting and importing settings) require a Home Assistant **administrator**. Non-admin users cannot read or change the integration's configuration, even over the websocket API.

---

## 🎨 Visualization & Dashboard Integration

**PSB History Engine** is primarily tailored as the official backend for **[Piotras Smart Button (PSB)](https://github.com/Piotras1/piotras-smart-button)**:

* 🥇 **Piotras Smart Button (Recommended)**: Native, zero-overhead rendering via JavaScript templates, the ready-made cards from **Copy to PSB**, and [Custom Data Modules](https://github.com/Piotras1/piotras-smart-button/discussions/categories/custom-data-modules).
* ⚙️ **Other Custom Cards**: Can also be consumed by `custom:button-card` or any advanced card capable of reading entity state attributes via JS templates.

👉 **[History Templates & Card Examples](docs/TEMPLATES.md)**

---

## 📄 License

MIT — free to use, modify, and share.

---

*Created by Piotras. Strictly engineered for reliability.*

