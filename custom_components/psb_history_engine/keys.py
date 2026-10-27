"""Tracking keys for History Engine.

One source entity can be tracked several times (different interval / depth /
mode). Every tracking has a key:

* slot 0 -> the plain source entity_id (exactly what older versions stored, so
  existing entities, unique_ids and buffers keep working untouched)
* slot n -> "<source entity_id>#<n>"  ("#" can never occur in an entity_id)
"""
from __future__ import annotations

import re

from .const import MAX_SLOTS, SLOT_SEPARATOR

# Strict format for extra slots (1..99, no leading zero); validated against MAX_SLOTS below.
_EXTRA_KEY_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+#[1-9][0-9]?$")


def split_key(key: str) -> tuple[str, int]:
    """Return (source_entity_id, slot) for a tracking key."""
    source, sep, slot = key.partition(SLOT_SEPARATOR)
    if sep and slot.isdigit():
        return source, int(slot)
    return source, 0


def make_key(source_entity_id: str, slot: int) -> str:
    """Build the tracking key for a source entity and slot number."""
    return source_entity_id if slot <= 0 else f"{source_entity_id}{SLOT_SEPARATOR}{slot}"


def is_valid_key(key: object) -> bool:
    """True for a legacy plain key, or a well-formed extra-slot key within MAX_SLOTS.

    Plain keys (no "#") are accepted as before; only keys that use the slot
    separator are checked strictly.
    """
    if not isinstance(key, str) or not key:
        return False
    if SLOT_SEPARATOR not in key:
        return True
    if not _EXTRA_KEY_RE.match(key):
        return False
    return split_key(key)[1] < MAX_SLOTS
