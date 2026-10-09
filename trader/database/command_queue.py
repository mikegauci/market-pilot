"""Constants shared by the dashboard command queues (no heavy imports)."""

# A claimed ("processing") command older than this is assumed abandoned and returned to pending.
STALE_PROCESSING_SEC = 120.0
