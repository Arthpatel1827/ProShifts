# ai/assistant.py
"""
Manager-facing workforce assistant. Read-only: it answers from tool results and can
point managers to the Schedule Copilot, but it cannot create, change or publish anything.
"""
import json
import logging

from ai.client import AIBadResponse, NemotronClient
from ai.tools import AIContext, run_tool, tool_specs
from extensions import db

log = logging.getLogger("proshifts.ai")

MAX_TOOL_ROUNDS = 5
MAX_HISTORY_TURNS = 10
MAX_TOOL_RESULT_CHARS = 12_000


def _system_prompt(ctx: AIContext) -> str:
    today = ctx.today()
    return f"""You are ProShifts AI, a workforce assistant for managers at the location "{ctx.location.loc_name}".
Location timezone: {ctx.tz.key}. Today there is {today.strftime('%A')} {today.isoformat()}. Weeks run Monday–Sunday.

Rules:
- Answer ONLY from tool results in this conversation. Call tools for any fact about staff, shifts, hours, availability, time off or cost. If the tools don't cover something, say so plainly.
- Never invent people, shifts, IDs, hours, rates or availability. Use names from tool results; don't show internal IDs to the manager.
- Resolve relative dates ("Friday", "tomorrow", "next week") from today's date above, in location time.
- You cannot create, change, assign or publish shifts. To act, the manager uses the Schedule page or the AI Schedule Copilot; say so when relevant.
- Separate facts (from tools) from your recommendations, and label recommendations as suggestions.
- Be concise: short paragraphs or bullet lists, times like "5:00 PM", money like "$1,240"."""


def _clean_history(history) -> list[dict]:
    """Only prior user/assistant text — never tool, system or injected structured turns."""
    out = []
    for turn in (history or [])[-MAX_HISTORY_TURNS:]:
        if not isinstance(turn, dict):
            continue
        role, content = turn.get("role"), turn.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content.strip()[:4000]})
    return out


def ask(ctx: AIContext, message: str, history=None, client: NemotronClient | None = None) -> dict:
    client = client or NemotronClient()
    messages = [{"role": "system", "content": _system_prompt(ctx)}, *_clean_history(history),
                {"role": "user", "content": message.strip()[:4000]}]
    specs = tool_specs()
    tools_used = []

    for _ in range(MAX_TOOL_ROUNDS):
        result = client.chat(messages, feature="assistant", tools=specs, max_tokens=1200)
        if not result.tool_calls:
            if not result.content:
                raise AIBadResponse("The AI returned an empty answer.")
            return {"reply": result.content, "tools_used": tools_used, "model": client.model}

        messages.append(result.raw_message)
        for call in result.tool_calls:
            try:
                data = run_tool(ctx, call.name, call.arguments)
            except Exception:  # a tool/database failure must not crash the request
                db.session.rollback()
                log.exception("ai.tool_failed tool=%s", call.name)
                data = {"error": "This data couldn't be loaded right now."}
            ok = "error" not in data
            tools_used.append({"name": call.name, "arguments": {k: v for k, v in call.arguments.items() if not k.startswith("__")}, "ok": ok})
            log.info("ai.tool feature=assistant tool=%s ok=%s", call.name, ok)
            text = json.dumps(data, default=str)
            if len(text) > MAX_TOOL_RESULT_CHARS:
                text = text[:MAX_TOOL_RESULT_CHARS] + '... (truncated)"}'
            messages.append({"role": "tool", "tool_call_id": call.id, "content": text})

    # Still asking for tools after the limit: make it answer with what it has.
    messages.append({"role": "user", "content": "Answer now using only the tool results above."})
    result = client.chat(messages, feature="assistant", max_tokens=1200)
    if not result.content:
        raise AIBadResponse("The AI didn't produce an answer.")
    return {"reply": result.content, "tools_used": tools_used, "model": client.model}
