# ai/client.py
"""
Minimal client for NVIDIA's OpenAI-compatible chat completions API.

Errors are raised as AIError subclasses with a stable `code` and HTTP status, so
controllers can return a clean message ("AI is temporarily unavailable — you can keep
scheduling manually") instead of crashing. Logs carry the feature, model, latency and
outcome only — never the API key, prompts or employee data.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field

import requests

from ai.config import AISettings, get_settings

log = logging.getLogger("proshifts.ai")

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


class AIError(Exception):
    code = "AI_ERROR"
    status = 502
    message = "The AI service returned an error."

    def __init__(self, message: str | None = None):
        super().__init__(message or self.message)
        self.message = message or self.message


class AINotConfigured(AIError):
    code, status = "AI_NOT_CONFIGURED", 503
    message = "AI isn't configured on this server (NVIDIA_API_KEY is not set)."


class AIUnavailable(AIError):
    code, status = "AI_UNAVAILABLE", 503
    message = "AI is temporarily unavailable."


class AITimeout(AIError):
    code, status = "AI_TIMEOUT", 504
    message = "The AI took too long to respond."


class AIRateLimited(AIError):
    code, status = "AI_RATE_LIMITED", 429
    message = "The AI service is busy (rate limited). Try again in a minute."


class AIBadResponse(AIError):
    code, status = "AI_BAD_RESPONSE", 502
    message = "The AI returned a response ProShifts couldn't use."


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatResult:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    usage: dict = field(default_factory=dict)
    # The assistant message exactly as the API expects it back in a follow-up turn.
    raw_message: dict = field(default_factory=dict)


class NemotronClient:
    def __init__(self, settings: AISettings | None = None, session: requests.Session | None = None):
        self.settings = settings or get_settings()
        self.session = session or requests.Session()

    @property
    def model(self) -> str:
        return self.settings.model

    def chat(self, messages: list[dict], *, feature: str, tools: list[dict] | None = None,
             tool_choice=None, max_tokens: int = 1500, temperature: float = 0.6) -> ChatResult:
        s = self.settings
        if not s.configured:
            log.warning("ai.request feature=%s outcome=not_configured", feature)
            raise AINotConfigured()

        payload = {
            "model": s.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.95,
            # Nemotron 3 reasons by default; answers here should be direct and fast.
            "chat_template_kwargs": {"enable_thinking": s.reasoning},
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice or "auto"

        started = time.monotonic()
        log.info("ai.request feature=%s model=%s started", feature, s.model)
        try:
            resp = self.session.post(
                f"{s.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {s.api_key}", "Accept": "application/json"},
                json=payload,
                timeout=s.timeout_seconds,
            )
        except requests.Timeout:
            self._log(feature, started, "timeout")
            raise AITimeout()
        except requests.RequestException as exc:
            self._log(feature, started, f"unreachable:{type(exc).__name__}")
            raise AIUnavailable()

        if resp.status_code == 429:
            self._log(feature, started, "rate_limited", resp.status_code)
            raise AIRateLimited()
        if resp.status_code in (401, 403):
            self._log(feature, started, "auth_rejected", resp.status_code)
            raise AIUnavailable("The NVIDIA API rejected the configured key.")
        if resp.status_code >= 500:
            self._log(feature, started, "upstream_error", resp.status_code)
            raise AIUnavailable()
        if resp.status_code >= 400:
            self._log(feature, started, "request_error", resp.status_code)
            raise AIBadResponse(f"The AI service rejected the request ({resp.status_code}).")

        try:
            body = resp.json()
            choice = body["choices"][0]
            msg = choice["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            self._log(feature, started, "malformed", resp.status_code)
            raise AIBadResponse()

        calls = []
        for tc in msg.get("tool_calls") or []:
            fn = (tc or {}).get("function") or {}
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except (ValueError, TypeError):
                args = {"__invalid_json__": True}
            if not isinstance(args, dict):
                args = {"__invalid_json__": True}
            calls.append(ToolCall(id=tc.get("id") or f"call_{len(calls)}", name=fn.get("name") or "", arguments=args))

        content = _THINK.sub("", msg.get("content") or "").strip()
        usage = body.get("usage") or {}
        self._log(feature, started, "ok", resp.status_code, usage=usage, tool_calls=len(calls))

        raw = {"role": "assistant", "content": msg.get("content") or ""}
        if msg.get("tool_calls"):
            raw["tool_calls"] = msg["tool_calls"]
        return ChatResult(content=content, tool_calls=calls, finish_reason=choice.get("finish_reason"),
                          usage=usage, raw_message=raw)

    def _log(self, feature, started, outcome, status=None, usage=None, tool_calls=0):
        ms = int((time.monotonic() - started) * 1000)
        usage = usage or {}
        log.info(
            "ai.request feature=%s model=%s outcome=%s http=%s latency_ms=%d prompt_tokens=%s completion_tokens=%s tool_calls=%d",
            feature, self.settings.model, outcome, status, ms,
            usage.get("prompt_tokens"), usage.get("completion_tokens"), tool_calls,
        )
