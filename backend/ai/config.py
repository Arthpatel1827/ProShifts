# ai/config.py
"""Nemotron settings, read from Flask config (which reads the environment)."""
from dataclasses import dataclass

from flask import current_app

DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
# Nemotron 3 Super: NVIDIA's hosted Nemotron model with tool calling. Override with
# NVIDIA_NEMOTRON_MODEL to switch models without code changes.
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b"


@dataclass(frozen=True)
class AISettings:
    api_key: str | None
    base_url: str
    model: str
    timeout_seconds: float
    reasoning: bool

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def get_settings() -> AISettings:
    cfg = current_app.config
    return AISettings(
        api_key=(cfg.get("NVIDIA_API_KEY") or "").strip() or None,
        base_url=(cfg.get("NVIDIA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        model=(cfg.get("NVIDIA_NEMOTRON_MODEL") or DEFAULT_MODEL).strip(),
        timeout_seconds=float(cfg.get("NVIDIA_TIMEOUT_SECONDS") or 60),
        reasoning=bool(cfg.get("NVIDIA_NEMOTRON_REASONING")),
    )
