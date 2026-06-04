import asyncio
from functools import partial
import meilisearch
from meilisearch.errors import MeilisearchApiError
from config import settings

_client: meilisearch.Client | None = None


def get_client() -> meilisearch.Client:
    global _client
    if _client is None:
        _client = meilisearch.Client(
            settings.meilisearch_host, settings.meilisearch_master_key
        )
    return _client


async def run_sync(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(fn, *args, **kwargs))


async def hybrid_search(
    client_id: str,
    query: str,
    vector: list[float],
    limit: int = 10,
    semantic_ratio: float = 0.5,
) -> list[dict]:
    meili = get_client()
    index_name = f"products_{client_id}"
    ratio = max(0.0, min(1.0, semantic_ratio))  # clamp to [0, 1]

    def _search():
        index = meili.index(index_name)
        params: dict = {
            "vector": vector,
            "hybrid": {"semanticRatio": ratio, "embedder": "default"},
            "limit": limit,
        }
        return index.search(query, params)

    try:
        result = await run_sync(_search)
    except MeilisearchApiError as exc:
        # Index does not exist yet (client has no products ingested) — return
        # empty results rather than propagating a 500 to the widget.
        if exc.code == "index_not_found":
            return []
        raise

    hits = result.get("hits", [])

    # Strip internal vector field from response
    for hit in hits:
        hit.pop("_vectors", None)

    return hits


async def configure_index(client_id: str) -> None:
    meili = get_client()
    index_name = f"products_{client_id}"

    def _configure():
        meili.create_index(index_name, {"primaryKey": "id"})
        index = meili.index(index_name)
        index.update_settings(
            {
                "searchableAttributes": [
                    "title",
                    "actors",
                    "director",
                    "writer",
                    "content_type",
                    "year",
                    "language",
                    "tags",
                    "category",
                    "description",
                ],
                "filterableAttributes": [
                    "category",
                    "content_type",
                    "language",
                    "year",
                    "tags",
                ],
                "sortableAttributes": ["year"],
                "typoTolerance": {
                    "enabled": True,
                    "minWordSizeForTypos": {"oneTypo": 3, "twoTypos": 7},
                },
                "searchCutoffMs": 150,
            }
        )

    await run_sync(_configure)


async def ensure_index(client_id: str) -> None:
    """Create the client's product index with correct settings if it does not
    already exist.  Safe to call on every upsert — swallows
    ``index_already_exists`` so it is idempotent."""
    meili = get_client()
    index_name = f"products_{client_id}"

    def _ensure():
        try:
            meili.http.patch("/experimental-features", {"vectorStore": True})
        except Exception:
            pass  # best-effort; already enabled is fine
        try:
            meili.create_index(index_name, {"primaryKey": "id"})
        except MeilisearchApiError as exc:
            if exc.code != "index_already_exists":
                raise
        index = meili.index(index_name)
        index.update_settings(
            {
                "searchableAttributes": [
                    "title",
                    "actors",
                    "director",
                    "writer",
                    "content_type",
                    "year",
                    "language",
                    "tags",
                    "category",
                    "description",
                ],
                "filterableAttributes": [
                    "category",
                    "content_type",
                    "language",
                    "year",
                    "tags",
                ],
                "sortableAttributes": ["year"],
                "typoTolerance": {
                    "enabled": True,
                    "minWordSizeForTypos": {"oneTypo": 3, "twoTypos": 7},
                },
                "searchCutoffMs": 150,
                "embedders": {
                    "default": {
                        "source": "userProvided",
                        "dimensions": 1536,
                    }
                },
            }
        )

    await run_sync(_ensure)


async def add_documents(client_id: str, documents: list[dict]) -> None:
    meili = get_client()
    index_name = f"products_{client_id}"

    def _add():
        index = meili.index(index_name)
        task = index.add_documents(documents)
        meili.wait_for_task(task.task_uid, timeout_in_ms=10_000)

    await run_sync(_add)


async def delete_index_if_exists(index_name: str) -> None:
    meili = get_client()

    def _delete():
        try:
            task = meili.delete_index(index_name)
            meili.wait_for_task(task.task_uid, timeout_in_ms=10_000)
        except MeilisearchApiError as exc:
            if exc.code != "index_not_found":
                raise

    await run_sync(_delete)


async def clear_client_indexes(client_id: str) -> None:
    await delete_index_if_exists(f"products_{client_id}")
    await delete_index_if_exists(f"products_{client_id}_pending")
