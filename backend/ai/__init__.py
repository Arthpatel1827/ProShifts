"""
ProShifts AI layer (NVIDIA Nemotron).

The model never touches the database. Flow:

    request → controllers/ai_controller.py (auth, tenant, manager role)
            → ai.assistant / ai.schedule_copilot / ai.insights
            → ai.client (Nemotron, OpenAI-compatible chat completions)
            → ai.tools (read-only queries over this location's data)
            → ai.validators (deterministic checks, reusing ShiftService rules)
            → draft shifts via ShiftService, only after a manager applies them

Every ID the model sees comes from a tool result, and every ID it sends back is
re-checked against the caller's location before anything is read or written.
"""
