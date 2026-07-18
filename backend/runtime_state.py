"""Process-local runtime flags (not persisted). Survives only while the worker lives."""

LAST_TRIGGER_CHECK_AT: str | None = None
LAST_TRIGGER_CHECK_OK: bool | None = None
