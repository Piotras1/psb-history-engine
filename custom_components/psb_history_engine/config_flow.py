"""Config flow for History Engine."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow
from homeassistant.data_entry_flow import FlowResult

from . import DOMAIN


class HistoryEngineConfigFlow(ConfigFlow, domain=DOMAIN):
    """Single-instance setup - all real configuration happens in the panel."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="PSB History Engine", data={})
        return self.async_show_form(step_id="user")
