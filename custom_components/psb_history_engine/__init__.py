"""History Engine.

Lightweight RAM history buffer: for any numeric entity the user picks, a
sensor.<name>_history entity is created holding a rolling buffer of
[timestamp, value] points in its attributes, at a user-chosen interval and
depth. No recorder/database queries, no YAML.

Everything is managed from a full sidebar panel (panel_custom), backed by
the WebSocket commands below - same architecture as Auto Energy Meters.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_DEFAULTS,
    CONF_DEPTH,
    CONF_ENABLED,
    CONF_FRIENDLY_NAME,
    CONF_INTERVAL_UNIT,
    CONF_INTERVAL_VALUE,
    CONF_LANGUAGE,
    CONF_OFFSET_SECONDS,
    CONF_SUFFIX,
    CONF_TRACKED,
    CONF_TRACKING_MODE,
    DOMAIN,
    INTERVAL_UNITS,
    LANGUAGES,
    MAX_DEPTH,
    MAX_OFFSET_SECONDS,
    MIN_DEPTH,
    MIN_INTERVAL_VALUE,
    MIN_OFFSET_SECONDS,
    PANEL_ICON,
    PANEL_LANG_URL_BASE,
    PANEL_STATIC_PATH,
    PANEL_TITLE,
    PANEL_WEBCOMPONENT_NAME,
    SYSTEM_DEFAULTS,
    TRACKABLE_DOMAINS,
    TRACKING_MODES,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]

ENTITY_CFG_SCHEMA = {
    vol.Required("entity_id"): str,
    vol.Required(CONF_ENABLED): bool,
    vol.Required(CONF_TRACKING_MODE): vol.In(TRACKING_MODES),
    vol.Required(CONF_INTERVAL_VALUE): vol.All(int, vol.Range(min=MIN_INTERVAL_VALUE)),
    vol.Required(CONF_INTERVAL_UNIT): vol.In(INTERVAL_UNITS),
    vol.Required(CONF_DEPTH): vol.All(int, vol.Range(min=MIN_DEPTH, max=MAX_DEPTH)),
    vol.Optional(CONF_OFFSET_SECONDS): vol.All(
        int, vol.Range(min=MIN_OFFSET_SECONDS, max=MAX_OFFSET_SECONDS)
    ),
    vol.Optional(CONF_SUFFIX): str,
    vol.Optional(CONF_FRIENDLY_NAME): str,
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _get_entry(hass: HomeAssistant) -> ConfigEntry | None:
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _get_defaults(entry: ConfigEntry) -> dict:
    return {**SYSTEM_DEFAULTS, **entry.options.get(CONF_DEFAULTS, {})}


def _get_tracked(entry: ConfigEntry) -> dict:
    return dict(entry.options.get(CONF_TRACKED, {}))


def _numeric(state) -> float | None:
    if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None):
        return None
    try:
        return float(state.state)
    except (TypeError, ValueError):
        return None


def _history_entity_id(source_entity_id: str, cfg: dict, defaults: dict) -> str:
    suffix = cfg.get(CONF_SUFFIX) or defaults[CONF_SUFFIX]
    object_id = source_entity_id.split(".", 1)[-1]
    return f"sensor.{object_id}{suffix}"


def _own_entity_ids(hass: HomeAssistant, entry: ConfigEntry) -> set[str]:
    """entity_ids already created by this integration - excluded from the
    trackable list so you can't create a history-of-a-history loop."""
    ent_reg = er.async_get(hass)
    return {
        e.entity_id
        for e in er.async_entries_for_config_entry(ent_reg, entry.entry_id)
    }


def _build_entity_list(hass: HomeAssistant, entry: ConfigEntry) -> list[dict]:
    defaults = _get_defaults(entry)
    tracked = _get_tracked(entry)
    own_ids = _own_entity_ids(hass, entry)

    items = []
    for state in hass.states.async_all():
        entity_id = state.entity_id
        domain = entity_id.split(".", 1)[0]
        if domain not in TRACKABLE_DOMAINS:
            continue
        if entity_id in own_ids:
            continue

        value = _numeric(state)
        is_tracked = entity_id in tracked
        if value is None and not is_tracked:
            # Not numeric right now and never configured - not worth
            # listing (keeps the panel focused on things that make sense).
            continue

        cfg = {**defaults, **tracked.get(entity_id, {})}

        items.append(
            {
                "entity_id": entity_id,
                "name": state.name or entity_id,
                "domain": domain,
                "unit": state.attributes.get("unit_of_measurement"),
                "value": value,
                "tracked": is_tracked,
                "enabled": tracked.get(entity_id, {}).get(CONF_ENABLED, True),
                "config": {
                    CONF_TRACKING_MODE: cfg[CONF_TRACKING_MODE],
                    CONF_INTERVAL_VALUE: cfg[CONF_INTERVAL_VALUE],
                    CONF_INTERVAL_UNIT: cfg[CONF_INTERVAL_UNIT],
                    CONF_DEPTH: cfg[CONF_DEPTH],
                    CONF_OFFSET_SECONDS: cfg.get(CONF_OFFSET_SECONDS, 0),
                    CONF_SUFFIX: cfg[CONF_SUFFIX],
                    CONF_FRIENDLY_NAME: tracked.get(entity_id, {}).get(CONF_FRIENDLY_NAME, ""),
                },
                "history_entity_id": _history_entity_id(entity_id, cfg, defaults),
            }
        )

    items.sort(key=lambda i: i["name"].lower())
    return items


# ---------------------------------------------------------------------------
# WebSocket API (used by the panel)
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list_entities"})
@websocket_api.async_response
async def ws_list_entities(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return
    connection.send_result(
        msg["id"],
        {
            "entities": _build_entity_list(hass, entry),
            "defaults": _get_defaults(entry),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/save_entity", **ENTITY_CFG_SCHEMA})
@websocket_api.async_response
async def ws_save_entity(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    entity_id = msg["entity_id"]
    cfg = {
        CONF_ENABLED: msg[CONF_ENABLED],
        CONF_TRACKING_MODE: msg[CONF_TRACKING_MODE],
        CONF_INTERVAL_VALUE: msg[CONF_INTERVAL_VALUE],
        CONF_INTERVAL_UNIT: msg[CONF_INTERVAL_UNIT],
        CONF_DEPTH: msg[CONF_DEPTH],
        CONF_OFFSET_SECONDS: msg.get(CONF_OFFSET_SECONDS, 0),
    }
    if msg.get(CONF_SUFFIX):
        cfg[CONF_SUFFIX] = msg[CONF_SUFFIX]
    if msg.get(CONF_FRIENDLY_NAME):
        cfg[CONF_FRIENDLY_NAME] = msg[CONF_FRIENDLY_NAME]

    tracked = _get_tracked(entry)
    tracked[entity_id] = cfg
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_TRACKED: tracked}
    )

    from .sensor import async_apply_tracking  # local import - avoids platform import cycle

    await async_apply_tracking(hass, entry, entity_id, {**_get_defaults(entry), **cfg})

    connection.send_result(msg["id"], {"entities": _build_entity_list(hass, entry)})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/get_entity_state", vol.Required("entity_id"): str}
)
@websocket_api.async_response
async def ws_get_entity_state(hass: HomeAssistant, connection, msg) -> None:
    """Return one entity's current state+attributes straight from the state
    machine - bypasses whatever the frontend's own cached hass object may or
    may not have propagated yet, so the panel's refresh/poll is guaranteed
    fresh rather than trusting push-based liveness it can't verify."""
    state = hass.states.get(msg["entity_id"])
    if state is None:
        connection.send_result(msg["id"], {"state": None, "attributes": None})
        return
    connection.send_result(
        msg["id"], {"state": state.state, "attributes": dict(state.attributes)}
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/clear_entity", vol.Required("entity_id"): str}
)
@websocket_api.async_response
async def ws_clear_entity(hass: HomeAssistant, connection, msg) -> None:
    """Empty a tracked entity's buffer without touching its config."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    from .sensor import async_clear_history

    ok = await async_clear_history(hass, entry, msg["entity_id"])
    if not ok:
        connection.send_error(
            msg["id"], "not_tracked", "Ta encja nie jest obecnie śledzona/załadowana"
        )
        return

    connection.send_result(msg["id"], {"entities": _build_entity_list(hass, entry)})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/remove_entity", vol.Required("entity_id"): str}
)
@websocket_api.async_response
async def ws_remove_entity(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    entity_id = msg["entity_id"]
    tracked = _get_tracked(entry)
    tracked.pop(entity_id, None)
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_TRACKED: tracked}
    )

    from .sensor import async_remove_tracking

    await async_remove_tracking(hass, entry, entity_id)

    connection.send_result(msg["id"], {"entities": _build_entity_list(hass, entry)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_settings"})
@websocket_api.async_response
async def ws_get_settings(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return
    connection.send_result(
        msg["id"],
        {"defaults": _get_defaults(entry), "system_defaults": SYSTEM_DEFAULTS},
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_settings",
        vol.Optional(CONF_TRACKING_MODE): vol.In(TRACKING_MODES),
        vol.Optional(CONF_INTERVAL_VALUE): vol.All(int, vol.Range(min=MIN_INTERVAL_VALUE)),
        vol.Optional(CONF_INTERVAL_UNIT): vol.In(INTERVAL_UNITS),
        vol.Optional(CONF_DEPTH): vol.All(int, vol.Range(min=MIN_DEPTH, max=MAX_DEPTH)),
        vol.Optional(CONF_OFFSET_SECONDS): vol.All(
            int, vol.Range(min=MIN_OFFSET_SECONDS, max=MAX_OFFSET_SECONDS)
        ),
        vol.Optional(CONF_SUFFIX): str,
        vol.Optional(CONF_LANGUAGE): vol.In(LANGUAGES),
    }
)
@websocket_api.async_response
async def ws_save_settings(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    defaults = dict(entry.options.get(CONF_DEFAULTS, {}))
    for key in (
        CONF_TRACKING_MODE,
        CONF_INTERVAL_VALUE,
        CONF_INTERVAL_UNIT,
        CONF_DEPTH,
        CONF_OFFSET_SECONDS,
        CONF_SUFFIX,
        CONF_LANGUAGE,
    ):
        if key in msg:
            defaults[key] = msg[key]

    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_DEFAULTS: defaults}
    )
    connection.send_result(
        msg["id"],
        {"defaults": _get_defaults(entry), "system_defaults": SYSTEM_DEFAULTS},
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/export_settings"})
@websocket_api.async_response
async def ws_export_settings(hass: HomeAssistant, connection, msg) -> None:
    """Export visible config (defaults + per-entity settings) as JSON.
    Does NOT include the buffered history data itself - that lives in the
    entities' own state (Restore State) and is unaffected either way."""
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return
    connection.send_result(
        msg["id"],
        {
            "defaults": entry.options.get(CONF_DEFAULTS, {}),
            "tracked_entities": entry.options.get(CONF_TRACKED, {}),
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_settings",
        vol.Required("defaults"): dict,
        vol.Required("tracked_entities"): dict,
    }
)
@websocket_api.async_response
async def ws_import_settings(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            CONF_DEFAULTS: msg["defaults"],
            CONF_TRACKED: msg["tracked_entities"],
        },
    )

    # Re-apply every imported entity so entities appear immediately.
    from .sensor import async_apply_tracking, async_remove_tracking

    entry = _get_entry(hass)
    defaults = _get_defaults(entry)
    current_ids = set(hass.data.get(DOMAIN, {}).get(entry.entry_id, {}).get("entities", {}))
    wanted_ids = set(msg["tracked_entities"])

    for stale_id in current_ids - wanted_ids:
        await async_remove_tracking(hass, entry, stale_id)
    for entity_id, cfg in msg["tracked_entities"].items():
        await async_apply_tracking(hass, entry, entity_id, {**defaults, **cfg})

    connection.send_result(msg["id"], {"entities": _build_entity_list(hass, entry)})


# ---------------------------------------------------------------------------
# Integration setup
# ---------------------------------------------------------------------------


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register WebSocket commands and the sidebar panel (once)."""
    websocket_api.async_register_command(hass, ws_list_entities)
    websocket_api.async_register_command(hass, ws_save_entity)
    websocket_api.async_register_command(hass, ws_get_entity_state)
    websocket_api.async_register_command(hass, ws_clear_entity)
    websocket_api.async_register_command(hass, ws_remove_entity)
    websocket_api.async_register_command(hass, ws_get_settings)
    websocket_api.async_register_command(hass, ws_save_settings)
    websocket_api.async_register_command(hass, ws_export_settings)
    websocket_api.async_register_command(hass, ws_import_settings)

    www_dir = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(PANEL_STATIC_PATH, str(www_dir / "psb-history-engine-panel.js"), True),
            # Serves www/lang/*.json (pl.json, en.json, de.json, ...) so the
            # panel can fetch its UI text per language without bundling it
            # into the JS file - adding a language is then just a new JSON
            # file, no JS edits.
            StaticPathConfig(PANEL_LANG_URL_BASE, str(www_dir / "lang"), True),
        ]
    )
    await async_register_panel(
        hass,
        frontend_url_path=DOMAIN,
        webcomponent_name=PANEL_WEBCOMPONENT_NAME,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=PANEL_STATIC_PATH,
        require_admin=True,
    )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the (single) config entry: create the tracked history sensors."""
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the config entry."""
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok
