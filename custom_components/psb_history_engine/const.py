"""Constants for History Engine."""
from __future__ import annotations

DOMAIN = "psb_history_engine"

PANEL_STATIC_PATH = f"/{DOMAIN}/psb-history-engine-panel.js"
PANEL_LANG_URL_BASE = f"/{DOMAIN}/lang"
PANEL_WEBCOMPONENT_NAME = "psb-history-engine-panel"
PANEL_TITLE = "PSB History Engine"
PANEL_ICON = "mdi:chart-timeline-variant"

# --- entry.options top-level keys ---
CONF_TRACKED = "tracked_entities"  # dict: tracking key -> per-tracking config (key = source entity_id for slot 0, "<source>#<n>" for extra trackings)
CONF_DEFAULTS = "defaults"  # dict: global defaults for new entities

# --- per-entity config keys (values stored under CONF_TRACKED[entity_id]) ---
CONF_TRACKING_MODE = "tracking_mode"
CONF_INTERVAL_VALUE = "interval_value"
CONF_INTERVAL_UNIT = "interval_unit"
CONF_DEPTH = "depth"
CONF_SUFFIX = "suffix"
CONF_ENABLED = "enabled"
CONF_FRIENDLY_NAME = "friendly_name"
CONF_OFFSET_SECONDS = "offset_seconds"
CONF_LANGUAGE = "language"

LANGUAGES = ("cs", "de", "en", "es", "fr", "it", "pl", "pt", "ru", "sv")

# --- tracking modes ---
TRACKING_MODE_VALUE = "value"
TRACKING_MODE_COUNTER = "counter"
# on/off entities (switch, binary_sensor...): an EVENT LOG, one entry per state change,
# [timestamp, 1 (on) | 0 (off) | -1 (unavailable / unknown)]. No sampling interval at all.
TRACKING_MODE_ON_OFF = "on_off"
LEGACY_MODE_ON_TIME = "on_time"      # 1.6 / 1.7 (percent per interval) - migrated to on_off
TRACKING_MODES = (TRACKING_MODE_VALUE, TRACKING_MODE_COUNTER, TRACKING_MODE_ON_OFF)
ON_STATE = "on"
ON_OFF_ON, ON_OFF_OFF, ON_OFF_UNKNOWN = 1, 0, -1
ON_OFF_DEFAULT_DEPTH = 100           # entries kept for a new on/off tracking

# --- interval units -> seconds ---
UNIT_SECONDS = "seconds"
UNIT_MINUTES = "minutes"
UNIT_HOURS = "hours"
UNIT_DAYS = "days"
INTERVAL_UNITS = (UNIT_SECONDS, UNIT_MINUTES, UNIT_HOURS, UNIT_DAYS)
UNIT_TO_SECONDS = {
    UNIT_SECONDS: 1,
    UNIT_MINUTES: 60,
    UNIT_HOURS: 3600,
    UNIT_DAYS: 86400,
}

# --- system defaults (used until the user overrides them on Setup) ---
SYSTEM_DEFAULTS = {
    CONF_TRACKING_MODE: TRACKING_MODE_VALUE,
    CONF_INTERVAL_VALUE: 15,
    CONF_INTERVAL_UNIT: UNIT_MINUTES,
    CONF_DEPTH: 48,
    CONF_SUFFIX: "_history",
    CONF_OFFSET_SECONDS: 0,
    CONF_LANGUAGE: "en",
}

TRACKABLE_DOMAINS = ("sensor", "number", "input_number", "counter")
# on/off domains, tracked in the "on_off" mode (an event log)
BINARY_DOMAINS = ("binary_sensor", "switch", "light", "input_boolean", "fan")

# one source entity can be tracked several times (slot 0 = classic, 1.. = extra)
MAX_SLOTS = 5
SLOT_SEPARATOR = "#"

RESET_FLAG = "reset"
MIN_DEPTH = 2
MAX_DEPTH = 500
MIN_INTERVAL_VALUE = 1
MIN_OFFSET_SECONDS = -86400
MAX_OFFSET_SECONDS = 86400
