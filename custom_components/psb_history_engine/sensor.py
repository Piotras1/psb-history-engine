"""Sensor platform for History Engine.

Each entry in entry.options[CONF_TRACKED] with enabled=True becomes exactly
one HistorySensorEntity, keeping its full history buffer in RAM (list of
[timestamp, value] / [timestamp, value, "reset"] points) exposed through
extra_state_attributes, restored on restart via RestoreEntity.

Entities are added/replaced/removed at runtime (no full config-entry reload
needed) via async_apply_tracking() / async_remove_tracking(), called by the
websocket handlers in __init__.py when the panel saves/removes an entity -
same "no YAML, no restart" spirit as Auto Energy Meters.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.restore_state import RestoreEntity
import homeassistant.util.dt as dt_util

from .const import (
    CONF_DEPTH,
    CONF_FRIENDLY_NAME,
    CONF_INTERVAL_UNIT,
    CONF_INTERVAL_VALUE,
    CONF_OFFSET_SECONDS,
    CONF_SUFFIX,
    CONF_TRACKED,
    CONF_TRACKING_MODE,
    DOMAIN,
    RESET_FLAG,
    SYSTEM_DEFAULTS,
    TRACKING_MODE_COUNTER,
    UNIT_TO_SECONDS,
)

_LOGGER = logging.getLogger(__name__)


def _store(hass: HomeAssistant, entry: ConfigEntry) -> dict:
    return hass.data.setdefault(DOMAIN, {}).setdefault(
        entry.entry_id, {"add_entities": None, "entities": {}}
    )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create one HistorySensorEntity per enabled tracked entity."""
    store = _store(hass, entry)
    store["add_entities"] = async_add_entities

    tracked: dict[str, dict] = entry.options.get(CONF_TRACKED, {})
    entities = []
    for source_entity, cfg in tracked.items():
        if not cfg.get("enabled", True):
            continue
        entity = HistorySensorEntity(hass, entry, source_entity, cfg)
        store["entities"][source_entity] = entity
        entities.append(entity)

    if entities:
        async_add_entities(entities)


async def async_apply_tracking(
    hass: HomeAssistant, entry: ConfigEntry, source_entity: str, cfg: dict
) -> None:
    """Create (or replace, e.g. after an edit) the entity for one tracked source.

    Called by the panel's websocket save handler - takes effect immediately,
    no integration reload needed.
    """
    await async_remove_tracking(hass, entry, source_entity, _keep_history=True)

    if not cfg.get("enabled", True):
        return

    store = _store(hass, entry)
    if store["add_entities"] is None:
        _LOGGER.warning("PSB History Engine: sensor platform not ready yet for %s", source_entity)
        return

    entity = HistorySensorEntity(hass, entry, source_entity, cfg)
    store["entities"][source_entity] = entity
    store["add_entities"]([entity])


async def async_remove_tracking(
    hass: HomeAssistant,
    entry: ConfigEntry,
    source_entity: str,
    *,
    _keep_history: bool = False,
) -> None:
    """Remove the history entity for one tracked source, if it exists.

    When _keep_history is True (internal use from async_apply_tracking) the
    entity_registry entry is left alone, since a fresh entity with the same
    unique_id/entity_id is about to be re-added right after and RestoreEntity
    will pick the buffer back up. On a real "stop tracking" from the panel,
    the registry entry is purged too so the entity fully disappears.
    """
    store = _store(hass, entry)
    entity = store["entities"].pop(source_entity, None)
    if entity is None:
        return

    entity_id = entity.entity_id
    await entity.async_remove()

    if not _keep_history and entity_id:
        ent_reg = er.async_get(hass)
        if ent_reg.async_get(entity_id) is not None:
            ent_reg.async_remove(entity_id)


async def async_clear_history(hass: HomeAssistant, entry: ConfigEntry, source_entity: str) -> bool:
    """Empty the buffer of an already-loaded tracked entity, in place.

    Unlike async_remove_tracking, tracking config and the entity itself are
    untouched - only its buffered points and reset-detection state reset.
    Returns False if the entity isn't currently loaded (e.g. disabled).
    """
    store = _store(hass, entry)
    entity = store["entities"].get(source_entity)
    if entity is None:
        return False
    entity.clear_buffer()
    return True


class HistorySensorEntity(RestoreEntity, SensorEntity):
    """A RAM-buffered history sensor tracking one source entity."""

    _attr_should_poll = False
    _attr_icon = "mdi:history"

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, source_entity: str, cfg: dict
    ) -> None:
        self.hass = hass
        self._entry = entry
        self._source_entity = source_entity
        self._cfg = cfg

        self._tracking_mode: str = cfg.get(
            CONF_TRACKING_MODE, SYSTEM_DEFAULTS[CONF_TRACKING_MODE]
        )
        self._depth: int = int(cfg.get(CONF_DEPTH, SYSTEM_DEFAULTS[CONF_DEPTH]))
        unit = cfg.get(CONF_INTERVAL_UNIT, SYSTEM_DEFAULTS[CONF_INTERVAL_UNIT])
        value = int(cfg.get(CONF_INTERVAL_VALUE, SYSTEM_DEFAULTS[CONF_INTERVAL_VALUE]))
        self._interval_seconds: int = max(1, value * UNIT_TO_SECONDS.get(unit, 60))
        self._offset_seconds: int = int(
            cfg.get(CONF_OFFSET_SECONDS, SYSTEM_DEFAULTS[CONF_OFFSET_SECONDS])
        )

        suffix = cfg.get(CONF_SUFFIX) or SYSTEM_DEFAULTS[CONF_SUFFIX]
        base_object_id = source_entity.split(".", 1)[-1]
        self.entity_id = f"sensor.{base_object_id}{suffix}"

        friendly = cfg.get(CONF_FRIENDLY_NAME)
        self._attr_name = friendly or f"{base_object_id} history"
        self._attr_unique_id = f"{entry.entry_id}_{source_entity}"
        self._source_unit: str | None = None

        self._history: list[list[Any]] = []
        self._previous_value: float | None = None
        self._unsub_timer = None

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name="PSB History Engine",
            entry_type="service",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()

        last_state = await self.async_get_last_state()
        if last_state is not None:
            raw_history = last_state.attributes.get("history")
            if isinstance(raw_history, list):
                self._history = [list(point) for point in raw_history][-self._depth :]

            last_raw = last_state.attributes.get("last_raw_value")
            if last_raw is not None:
                try:
                    self._previous_value = float(last_raw)
                except (TypeError, ValueError):
                    self._previous_value = None

            # Odczytujemy nową nazwę z opcją zapasową do starej (kompatybilność wsteczna)
            uom = last_state.attributes.get("source_unit_of_measurement") or last_state.attributes.get("unit_of_measurement")
            if uom:
                self._source_unit = uom

        # Self-heal entities created before native_unit_of_measurement was
        # fixed to the constant "points": the entity registry can keep a
        # stale cached unit ("%", "kWh", ...) from back then, which a plain
        # code fix + restart does not clear on its own. Cheap no-op once
        # the registry already agrees.
        ent_reg = er.async_get(self.hass)
        reg_entry = ent_reg.async_get(self.entity_id)
        if reg_entry is not None and reg_entry.unit_of_measurement != "points":
            ent_reg.async_update_entity(self.entity_id, unit_of_measurement="points")

        # No sample here on purpose: taking one at creation time (restart,
        # reload, Save in the panel) would insert an off-grid point at a
        # random time. Points are written only on the aligned schedule.
        self._unsub_timer = self._schedule_next(dt_util.utcnow())

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub_timer is not None:
            self._unsub_timer()
            self._unsub_timer = None

    def _next_aligned_time(self, after: datetime) -> datetime:
        """Next wall-clock time to sample at, aligned to the interval grid
        (e.g. interval=1h -> boundaries at HH:00:00) and shifted by
        offset_seconds (e.g. -60 -> HH:59:00, so a reading lands just
        before an hourly tariff/cycle boundary instead of drifting with
        whatever time the entity happened to be added).

        Alignment is anchored to the Unix epoch (UTC), so it lines up with
        real wall-clock hours/days for any fixed whole-hour UTC offset
        (this covers Poland/CET-CEST); for interval units smaller than an
        hour this is exact everywhere.
        """
        period = self._interval_seconds
        after_epoch = after.timestamp()

        boundary = (int(after_epoch // period)) * period
        if boundary <= after_epoch:
            boundary += period

        target = boundary + self._offset_seconds
        while target <= after_epoch:
            target += period

        return dt_util.utc_from_timestamp(target)

    def _schedule_next(self, after: datetime):
        next_time = self._next_aligned_time(after)
        return async_track_point_in_time(self.hass, self._handle_scheduled_tick, next_time)

    @callback
    def _handle_scheduled_tick(self, now) -> None:
        self._tick(now)
        self._unsub_timer = self._schedule_next(now)

    def _tick(self, now) -> None:
        state = self.hass.states.get(self._source_entity)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            # Skip silently rather than writing a gap/zero that would
            # distort a chart built from this buffer.
            return

        try:
            value = float(state.state)
        except (TypeError, ValueError):
            return

        timestamp = int(now.timestamp())

        if (
            self._tracking_mode == TRACKING_MODE_COUNTER
            and self._previous_value is not None
            and value < self._previous_value
        ):
            point = [timestamp, value, RESET_FLAG]
        else:
            point = [timestamp, value]

        # Tworzenie nowej instancji listy przełamuje cache referencji w HA
        new_history = list(self._history)
        new_history.append(point)
        if len(new_history) > self._depth:
            new_history = new_history[-self._depth :]
        self._history = new_history

        self._previous_value = value

        if self._source_unit is None:
            uom = state.attributes.get("unit_of_measurement")
            if uom:
                self._source_unit = uom

        self.async_write_ha_state()

    def clear_buffer(self) -> None:
        """Empty the history buffer in place, keeping tracking config intact.

        Used by the panel's "Clear data" action - distinct from stopping
        tracking, which removes the entity entirely.
        """
        self._history = []
        self._previous_value = None
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        """Stan główny = liczba zgromadzonych punktów w buforze."""
        return len(self._history)

    @property
    def native_unit_of_measurement(self) -> str:
        """Jednostka dla stanu głównego encji historii (ilość wpisów/cykli)."""
        return "points"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "source_entity": self._source_entity,
            "source_unit_of_measurement": self._source_unit,
            "tracking_mode": self._tracking_mode,
            "interval_seconds": self._interval_seconds,
            "offset_seconds": self._offset_seconds,
            "depth": self._depth,
            "last_raw_value": self._previous_value,
            "history": self._history,
        }