"""
Intent extraction from session query buffers.

ScubaSearch logs only settled search intents. A settle event produces one
canonical query: the final meaningful query for that session.
"""


def extract_intents(snapshots: list[dict]) -> list[str]:
    """Return only the final non-empty query from a session snapshot list.

    The frontend may keep a short history of executed searches for UX reasons,
    but analytics should only persist the terminal intent query that actually
    represents what the viewer ended up browsing, searching, or clicking on.
    """
    if not snapshots:
        return []

    for entry in reversed(snapshots):
        value = (entry.get("value") or "").strip()
        if value:
            return [value]

    return []
