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
import math
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

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
    MAX_SLOTS,
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
    TRACKING_MODE_ON_OFF,
    LEGACY_MODE_ON_TIME,
    TRACKING_MODE_VALUE,
    TRACKING_MODES,
    BINARY_DOMAINS,
)

from .keys import is_valid_key, make_key, split_key

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

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
        value = float(state.state)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _issue_for(state, mode: str = TRACKING_MODE_VALUE) -> str | None:
    """Why a tracked source can never produce history.

    None = fine (or only unavailable for now - that is temporary and not a reason to remove it),
    "missing" = the source entity no longer exists, "non_numeric" = its state is not a number.
    """
    if state is None:
        return "missing"
    if state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN, None):
        return None
    if mode == TRACKING_MODE_ON_OFF:
        return None          # any known state is fine: "on" counts as ON, everything else as OFF
    return None if _numeric(state) is not None else "non_numeric"


def _history_entity_id(key: str, cfg: dict, defaults: dict) -> str:
    """entity_id of the history sensor for a tracking key.

    Slot 0 -> sensor.<object><suffix>, slot n -> sensor.<object><suffix>_<n>.
    """
    source_entity_id, slot = split_key(key)
    suffix = cfg.get(CONF_SUFFIX) or defaults[CONF_SUFFIX]
    object_id = source_entity_id.split(".", 1)[-1]
    tail = f"_{slot}" if slot else ""
    return f"sensor.{object_id}{suffix}{tail}"


def _target_collision(entry: ConfigEntry, key: str, cfg: dict) -> str | None:
    """Return the history entity_id if another tracking already produces it."""
    defaults = _get_defaults(entry)
    mine = _history_entity_id(key, {**defaults, **cfg}, defaults)
    for other_key, other_cfg in _get_tracked(entry).items():
        if other_key == key:
            continue
        if _history_entity_id(other_key, {**defaults, **other_cfg}, defaults) == mine:
            return mine
    return None


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
    ent_reg = er.async_get(hass)

    def make_item(source_id: str, slot: int, state) -> dict:
        key = make_key(source_id, slot)
        is_tracked = key in tracked
        tcfg = tracked.get(key, {})
        cfg = {**defaults, **tcfg}
        # the registry id is the truth (it can differ from the predicted one);
        # the predicted one is only for trackings that do not exist yet
        history_id = (
            ent_reg.async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_{key}")
            or _history_entity_id(key, cfg, defaults)
        )
        points = None
        hist_state = hass.states.get(history_id) if is_tracked else None
        if hist_state is not None:
            try:
                points = int(hist_state.state)
            except (TypeError, ValueError):
                points = None
        return {
            # "entity_id" carries the tracking KEY (equal to the source entity_id for slot 0,
            # so older panels/saved state still line up); "source_entity_id" is the real entity
            "entity_id": key,
            "source_entity_id": source_id,
            "slot": slot,
            "name": (state.name if state is not None else None) or source_id,
            "domain": source_id.split(".", 1)[0],
            "unit": state.attributes.get("unit_of_measurement") if state is not None else None,
            "value": _numeric(state) if state is not None else None,
            "tracked": is_tracked,
            "enabled": tcfg.get(CONF_ENABLED, True),
            # set only for trackings that can never work (source gone / not a number)
            "issue": _issue_for(state, cfg[CONF_TRACKING_MODE]) if is_tracked else None,
            # raw state (the panel shows ON / OFF for on/off entities, which have no numeric value)
            "state": state.state if state is not None else None,
            "suggested_mode": TRACKING_MODE_ON_OFF if source_id.split(".", 1)[0] in BINARY_DOMAINS else None,
            "points": points,
            "config": {
                CONF_TRACKING_MODE: cfg[CONF_TRACKING_MODE],
                CONF_INTERVAL_VALUE: cfg[CONF_INTERVAL_VALUE],
                CONF_INTERVAL_UNIT: cfg[CONF_INTERVAL_UNIT],
                CONF_DEPTH: cfg[CONF_DEPTH],
                CONF_OFFSET_SECONDS: cfg.get(CONF_OFFSET_SECONDS, 0),
                CONF_SUFFIX: cfg[CONF_SUFFIX],
                CONF_FRIENDLY_NAME: tcfg.get(CONF_FRIENDLY_NAME, ""),
            },
            "history_entity_id": history_id,
        }

    items = []
    present: set[str] = set()
    for state in hass.states.async_all():
        source_id = state.entity_id
        present.add(source_id)
        if source_id in own_ids:
            continue
        domain = source_id.split(".", 1)[0]
        # Offered as a NEW tracking only for numeric sensors of a trackable domain; but a
        # tracking that already exists is always listed, whatever its domain or state, so it
        # can be seen (and removed) in the panel.
        candidate_ok = (domain in TRACKABLE_DOMAINS and _numeric(state) is not None) or (
            domain in BINARY_DOMAINS and state.state in ("on", "off")
        )
        for slot in range(MAX_SLOTS):
            key = make_key(source_id, slot)
            if key not in tracked and (slot > 0 or not candidate_ok):
                continue
            items.append(make_item(source_id, slot, state))

    # Trackings whose source entity no longer exists: they were invisible before, so there
    # was no way to remove them. Listed now (issue = "missing").
    for key in tracked:
        source_id, slot = split_key(key)
        if source_id in present or source_id in own_ids or slot >= MAX_SLOTS:
            continue
        items.append(make_item(source_id, slot, None))

    items.sort(key=lambda i: (i["name"].lower(), i["slot"]))
    return items


# ---------------------------------------------------------------------------
# WebSocket API (used by the panel)
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list_entities"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_list_entities(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return
    integration = await async_get_integration(hass, DOMAIN)
    connection.send_result(
        msg["id"],
        {
            "entities": _build_entity_list(hass, entry),
            "defaults": _get_defaults(entry),
            "max_slots": MAX_SLOTS,
            "version": str(integration.version),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/save_entity", **ENTITY_CFG_SCHEMA})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_entity(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    entity_id = msg["entity_id"]  # tracking key (see keys.py)
    if not is_valid_key(entity_id):
        connection.send_error(
            msg["id"], "invalid_key", f"Nieprawidłowy klucz śledzenia (maks. {MAX_SLOTS} na encję)"
        )
        return
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

    clash = _target_collision(entry, entity_id, cfg)
    if clash:
        connection.send_error(
            msg["id"], "duplicate_target", f"Identyfikator {clash} jest już używany przez inne śledzenie"
        )
        return

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
@websocket_api.require_admin
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
@websocket_api.require_admin
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
@websocket_api.require_admin
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


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/remove_entities", vol.Required("entity_ids"): [str]}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_remove_entities(hass: HomeAssistant, connection, msg) -> None:
    """Remove several trackings at once - only those that currently have an issue.

    Used by the panel's "Incompatible / broken" view. The check is repeated here, so a stale
    panel can never remove a tracking that works by now (it is reported as skipped).
    """
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    tracked = _get_tracked(entry)
    to_remove, skipped = [], 0
    for key in dict.fromkeys(msg["entity_ids"]):          # de-duplicated, order kept
        if key not in tracked:
            continue
        source_id, _slot = split_key(key)
        mode = tracked[key].get(CONF_TRACKING_MODE) or _get_defaults(entry)[CONF_TRACKING_MODE]
        if _issue_for(hass.states.get(source_id), mode) is None:
            skipped += 1
            continue
        to_remove.append(key)

    for key in to_remove:
        tracked.pop(key, None)
    if to_remove:
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_TRACKED: tracked}
        )

    from .sensor import async_remove_tracking

    for key in to_remove:
        await async_remove_tracking(hass, entry, key)

    connection.send_result(
        msg["id"],
        {
            "entities": _build_entity_list(hass, entry),
            "removed": len(to_remove),
            "skipped": skipped,
        },
    )


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_settings"})
@websocket_api.require_admin
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
@websocket_api.require_admin
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
@websocket_api.require_admin
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
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_settings(hass: HomeAssistant, connection, msg) -> None:
    entry = _get_entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_setup", "Integracja nie jest skonfigurowana")
        return

    # keep only well-formed tracking keys (malformed "#" keys are dropped)
    imported = {k: _normalize_cfg(v) for k, v in msg["tracked_entities"].items() if is_valid_key(k)}

    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            CONF_DEFAULTS: _normalize_cfg(msg["defaults"]),
            CONF_TRACKED: imported,
        },
    )

    # Re-apply every imported entity so entities appear immediately.
    from .sensor import async_apply_tracking, async_remove_tracking

    entry = _get_entry(hass)
    defaults = _get_defaults(entry)
    current_ids = set(hass.data.get(DOMAIN, {}).get(entry.entry_id, {}).get("entities", {}))
    wanted_ids = set(imported)

    for stale_id in current_ids - wanted_ids:
        await async_remove_tracking(hass, entry, stale_id)
    for entity_id, cfg in imported.items():
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
    websocket_api.async_register_command(hass, ws_remove_entities)
    websocket_api.async_register_command(hass, ws_get_settings)
    websocket_api.async_register_command(hass, ws_save_settings)
    websocket_api.async_register_command(hass, ws_export_settings)
    websocket_api.async_register_command(hass, ws_import_settings)

    www_dir = Path(__file__).parent / "www"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(PANEL_STATIC_PATH, str(www_dir / "psb-history-engine-panel.js"), True),
            # Card templates imported by the panel (./psb-card-templates.js). No long-lived
            # cache: the import carries no ?v= version, so the browser must revalidate it.
            StaticPathConfig(f"/{DOMAIN}/psb-card-templates.js", str(www_dir / "psb-card-templates.js"), False),
            # Serves www/lang/*.json (pl.json, en.json, de.json, ...) so the
            # panel can fetch its UI text per language without bundling it
            # into the JS file - adding a language is then just a new JSON
            # file, no JS edits.
            StaticPathConfig(PANEL_LANG_URL_BASE, str(www_dir / "lang"), True),
        ]
    )
    # Static files are served with long-lived cache headers, so the panel URL carries the
    # integration version: after an update the browser fetches the new JS by itself.
    integration = await async_get_integration(hass, DOMAIN)
    await async_register_panel(
        hass,
        frontend_url_path=DOMAIN,
        webcomponent_name=PANEL_WEBCOMPONENT_NAME,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{PANEL_STATIC_PATH}?v={integration.version}",
        require_admin=True,
    )

    return True


def _normalize_cfg(cfg):
    """Map the legacy "on_time" mode (1.6 / 1.7) to "on_off"; anything else is returned as is."""
    if isinstance(cfg, dict) and cfg.get(CONF_TRACKING_MODE) == LEGACY_MODE_ON_TIME:
        return {**cfg, CONF_TRACKING_MODE: TRACKING_MODE_ON_OFF}
    return cfg


def _migrate_modes(hass: HomeAssistant, entry: ConfigEntry) -> None:
    tracked = _get_tracked(entry)
    migrated = {key: _normalize_cfg(cfg) for key, cfg in tracked.items()}
    defaults = entry.options.get(CONF_DEFAULTS)
    new_defaults = _normalize_cfg(defaults) if defaults else defaults
    if migrated != tracked or new_defaults != defaults:
        options = {**entry.options, CONF_TRACKED: migrated}
        if defaults:
            options[CONF_DEFAULTS] = new_defaults
        hass.config_entries.async_update_entry(entry, options=options)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the (single) config entry: create the tracked history sensors."""
    _migrate_modes(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the config entry."""
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok
