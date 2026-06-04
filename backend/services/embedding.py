import hashlib
import httpx
from config import settings

OPENAI_EMBED_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536

_openai_client: httpx.AsyncClient | None = None


def _require_openai_api_key() -> str:
    api_key = settings.openai_api_key.strip()
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not configured. Set it in .env and restart the backend/worker."
        )
    return api_key


def _get_openai_client() -> httpx.AsyncClient:
    global _openai_client
    if _openai_client is None:
        _openai_client = httpx.AsyncClient(
            base_url="https://api.openai.com",
            headers={
                "Authorization": f"Bearer {_require_openai_api_key()}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
    return _openai_client


async def embed(text: str) -> list[float]:
    client = _get_openai_client()
    resp = await client.post(
        "/v1/embeddings",
        json={"model": OPENAI_EMBED_MODEL, "input": [text]},
    )
    resp.raise_for_status()
    data = resp.json()
    return data["data"][0]["embedding"]


async def embed_batch(texts: list[str]) -> list[list[float]]:
    client = _get_openai_client()
    resp = await client.post(
        "/v1/embeddings",
        json={"model": OPENAI_EMBED_MODEL, "input": texts},
    )
    resp.raise_for_status()
    data = resp.json()
    return [item["embedding"] for item in data["data"]]


def cache_key(
    client_id: str, query: str, limit: int = 10, semantic_ratio: float = 0.5
) -> str:
    query_hash = hashlib.sha256(
        f"{query.lower().strip()}:{limit}:{semantic_ratio}".encode()
    ).hexdigest()
    return f"search:{client_id}:{query_hash}"
