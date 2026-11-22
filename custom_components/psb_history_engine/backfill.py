"""Backfill: rebuild a tracking's buffer from the Home Assistant recorder.

The pure functions (build_*) only turn already-read states into buffer points, with exactly
the same rules the live sampling uses (aligned grid, "reset" flags, on/off event log), so
they can be tested without Home Assistant. The two fetch_* functions read the recorder and
MUST run in the recorder's executor (see HistorySensorEntity.async_backfill_fetch).
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from .const import ON_OFF_OFF, ON_OFF_ON, ON_OFF_UNKNOWN, ON_STATE, RESET_FLAG

_UNAVAILABLE = "unavailable"
_UNKNOWN = "unknown"
_CHUNK_SECONDS = 86400   # read at most one day of states at a time (bounds memory)


class BackfillError(Exception):
    """Expected, user-facing failure. ``code`` is mapped to a translated message in the panel."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# pure: states -> buffer points
# ---------------------------------------------------------------------------
def _to_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError):
        return None


def build_points(
    counter: bool, samples: list[tuple[int, str | None, str | None]], interval: int = 0
) -> tuple[list[list[Any]], float | None, str | None]:
    """samples = [(grid timestamp, state string or None, last_reset or None)], ascending.

    Returns (points, last value, last seen last_reset). Unavailable / unknown / non-numeric
    states are skipped, like in live sampling (no gaps written as zeros).
    """
    points: list[list[Any]] = []
    prev: float | None = None
    prev_ts: int | None = None
    prev_reset: str | None = None
    for ts, state, last_reset in samples:
        if state is None or state in (_UNAVAILABLE, _UNKNOWN):
            continue
        try:
            value = float(state)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        is_reset = False
        if counter:
            if last_reset is not None and prev_reset is not None and last_reset != prev_reset:
                is_reset = True
            # a reset inside the period since the previous point (for the first point: inside
            # the last interval) - this also flags the FIRST point of a once-a-day meter
            reset_ts = _to_ts(last_reset)
            ref = prev_ts if prev_ts is not None else ts - interval
            if not is_reset and reset_ts is not None and interval and reset_ts > ref:
                is_reset = True
            if last_reset is not None:
                prev_reset = last_reset
            if not is_reset and prev is not None and value < prev:
                is_reset = True
        points.append([int(ts), value, RESET_FLAG] if is_reset else [int(ts), value])
        prev = value
        prev_ts = int(ts)
    return points, prev, prev_reset


def build_on_off_points(rows: list[tuple[float, str | None]], depth: int) -> list[list[Any]]:
    """rows = [(timestamp, state string)], ascending -> [[ts, 1|0|-1]] without repeats."""
    points: list[list[Any]] = []
    for ts, state in rows:
        if state is None:
            continue
        if state in (_UNAVAILABLE, _UNKNOWN):
            code = ON_OFF_UNKNOWN
        else:
            code = ON_OFF_ON if state == ON_STATE else ON_OFF_OFF
        if points and points[-1][1] == code:
            continue
        points.append([int(ts), code])
    return points[-depth:]


# ---------------------------------------------------------------------------
# recorder access (blocking - run in the recorder executor)
# ---------------------------------------------------------------------------
def _states(hass, source: str, start: datetime, end: datetime, with_attrs: bool) -> list:
    from homeassistant.components.recorder.history import get_significant_states

    result = get_significant_states(
        hass,
        start,
        end,
        [source],
        include_start_time_state=True,
        significant_changes_only=False,
        minimal_response=False,
        no_attributes=not with_attrs,
    )
    states = result.get(source, []) if result else []
    return sorted(states, key=lambda s: s.last_updated)


def fetch_samples_blocking(
    hass, source: str, targets: list[int], with_attrs: bool
) -> list[tuple[int, str | None, str | None]]:
    """For every grid timestamp: the state the source had at that moment (None = no data yet)."""
    import homeassistant.util.dt as dt_util

    samples: list[tuple[int, str | None, str | None]] = []
    carried: tuple[str | None, str | None] = (None, None)   # last known state across chunks
    n = len(targets)
    i = 0
    while i < n:
        j = i
        while j < n and targets[j] - targets[i] < _CHUNK_SECONDS:
            j += 1
        states = _states(
            hass,
            source,
            dt_util.utc_from_timestamp(targets[i]),
            dt_util.utc_from_timestamp(targets[j - 1] + 1),
            with_attrs,
        )
        times = [s.last_updated.timestamp() for s in states]
        k = -1
        for target in targets[i:j]:
            while k + 1 < len(states) and times[k + 1] <= target:
                k += 1
            if k >= 0:
                st = states[k]
                last_reset = st.attributes.get("last_reset") if with_attrs else None
                carried = (st.state, str(last_reset) if last_reset else None)
            samples.append((target, carried[0], carried[1]))
        i = j
    return samples


def fetch_events_blocking(hass, source: str, start: datetime, end: datetime) -> list[tuple[float, str]]:
    """All state changes of an on/off source in [start, end] (+ its state at start)."""
    states = _states(hass, source, start, end, False)
    return [(s.last_updated.timestamp(), s.state) for s in states]
