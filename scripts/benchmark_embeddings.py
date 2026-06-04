#!/usr/bin/env python3
"""
Compare embedding providers on ScubaSearch OTT retrieval cases.

Usage:
  OPENAI_API_KEY=... GEMINI_API_KEY=... python scripts/benchmark_embeddings.py

Optional:
  JINA_API_KEY=... python scripts/benchmark_embeddings.py --providers jina,openai,gemini

The benchmark intentionally embeds only the semantic fields used in production:
title, category, tags, description. Cast/crew/type/year/language stay out of
vectors and are meant for BM25/filter/sort in Meilisearch.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import time
from pathlib import Path
from typing import Any, Iterable

import httpx

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOGS = [
    ROOT / "scripts/movies.csv",
]
DEFAULT_CASES = ROOT / "scripts/embedding_benchmark_cases.json"
DEFAULT_DIMENSIONS = 1024


def clean(value: object) -> str:
    return str(value or "").strip()


def load_catalog(paths: Iterable[Path], language: str | None = None) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for path in paths:
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                doc_id = clean(row.get("id"))
                title = clean(row.get("title"))
                row_language = clean(row.get("language"))
                if language and row_language != language:
                    continue
                if not doc_id or not title or doc_id in seen:
                    continue
                seen.add(doc_id)
                rows.append(
                    {
                        "id": doc_id,
                        "title": title,
                        "description": clean(row.get("description")),
                        "category": clean(row.get("category")),
                        "tags": clean(row.get("tags")),
                        "actors": clean(row.get("actors")),
                        "director": clean(row.get("director")),
                        "writer": clean(row.get("writer")),
                        "content_type": clean(row.get("content_type")),
                        "year": clean(row.get("year")),
                        "language": row_language,
                    }
                )
    return rows


def embed_text(doc: dict) -> str:
    parts = [
        clean(doc.get("title")),
        clean(doc.get("category")),
        clean(doc.get("tags")),
        clean(doc.get("description")),
    ]
    return " ".join(part for part in parts if part)


def cosine(a: list[float], b: list[float]) -> float:
    denom = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    if not denom:
        return 0.0
    return sum(x * y for x, y in zip(a, b)) / denom


def chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


class Provider:
    name: str

    def embed_documents(self, docs: list[dict], dimensions: int) -> list[list[float]]:
        raise NotImplementedError

    def embed_queries(self, queries: list[str], dimensions: int) -> list[list[float]]:
        raise NotImplementedError


class OpenAIProvider(Provider):
    name = "openai-text-embedding-3-small"

    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")

    def _embed(self, texts: list[str], dimensions: int) -> list[list[float]]:
        out: list[list[float]] = []
        headers = {"Authorization": f"Bearer {self.api_key}"}
        with httpx.Client(timeout=60.0) as client:
            for batch in chunks(texts, 100):
                resp = client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers=headers,
                    json={
                        "model": "text-embedding-3-small",
                        "input": batch,
                        "dimensions": dimensions,
                    },
                )
                resp.raise_for_status()
                data = resp.json()["data"]
                out.extend(item["embedding"] for item in sorted(data, key=lambda x: x["index"]))
        return out

    def embed_documents(self, docs: list[dict], dimensions: int) -> list[list[float]]:
        return self._embed([embed_text(doc) for doc in docs], dimensions)

    def embed_queries(self, queries: list[str], dimensions: int) -> list[list[float]]:
        return self._embed(queries, dimensions)


class GeminiProvider(Provider):
    name = "gemini-embedding-001"

    def __init__(self) -> None:
        self.api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.request_delay = float(os.getenv("GEMINI_REQUEST_DELAY", "1.0"))
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")

    def _embed(self, items: list[dict], task_type: str, dimensions: int) -> list[list[float]]:
        out: list[list[float]] = []
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        with httpx.Client(timeout=60.0) as client:
            for batch in chunks(items, 1):
                requests = []
                for item in batch:
                    req = {
                        "model": "models/gemini-embedding-001",
                        "content": {"parts": [{"text": item["text"]}]},
                        "taskType": task_type,
                        "outputDimensionality": dimensions,
                    }
                    if task_type == "RETRIEVAL_DOCUMENT" and item.get("title"):
                        req["title"] = item["title"]
                    requests.append(req)
                for attempt in range(5):
                    resp = client.post(url, headers=headers, json={"requests": requests})
                    if resp.status_code != 429:
                        break
                    time.sleep(2**attempt)
                resp.raise_for_status()
                out.extend(item["values"] for item in resp.json()["embeddings"])
                if self.request_delay:
                    time.sleep(self.request_delay)
        return out

    def embed_documents(self, docs: list[dict], dimensions: int) -> list[list[float]]:
        items = [{"text": embed_text(doc), "title": doc["title"]} for doc in docs]
        return self._embed(items, "RETRIEVAL_DOCUMENT", dimensions)

    def embed_queries(self, queries: list[str], dimensions: int) -> list[list[float]]:
        items = [{"text": query} for query in queries]
        return self._embed(items, "RETRIEVAL_QUERY", dimensions)


class JinaProvider(Provider):
    name = "jina-embeddings-v5-text-small"

    def __init__(self) -> None:
        self.api_key = os.getenv("JINA_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("JINA_API_KEY is not set")

    def _embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        with httpx.Client(base_url="https://api.jina.ai", headers=headers, timeout=60.0) as client:
            for batch in chunks(texts, 100):
                resp = client.post(
                    "/v1/embeddings",
                    json={"model": "jina-embeddings-v5-text-small", "input": batch, "normalized": True},
                )
                resp.raise_for_status()
                out.extend(item["embedding"] for item in resp.json()["data"])
        return out

    def embed_documents(self, docs: list[dict], dimensions: int) -> list[list[float]]:
        return self._embed([embed_text(doc) for doc in docs])

    def embed_queries(self, queries: list[str], dimensions: int) -> list[list[float]]:
        return self._embed(queries)


PROVIDERS = {
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
    "jina": JinaProvider,
}


def evaluate(provider: Provider, docs: list[dict], cases: list[dict], dimensions: int, top_k: int) -> dict:
    started = time.monotonic()
    doc_vectors = provider.embed_documents(docs, dimensions)
    query_vectors = provider.embed_queries([case["query"] for case in cases], dimensions)
    elapsed_ms = int((time.monotonic() - started) * 1000)

    by_case = []
    hits_at_1 = 0
    hits_at_k = 0
    reciprocal_ranks = []
    for case, qvec in zip(cases, query_vectors):
        expected = set(case["expected_ids"])
        ranked = sorted(
            (
                {
                    "id": doc["id"],
                    "title": doc["title"],
                    "category": doc["category"],
                    "language": doc["language"],
                    "score": cosine(qvec, dvec),
                }
                for doc, dvec in zip(docs, doc_vectors)
            ),
            key=lambda item: item["score"],
            reverse=True,
        )
        top = ranked[:top_k]
        hit_positions = [i + 1 for i, item in enumerate(ranked) if item["id"] in expected]
        best_rank = hit_positions[0] if hit_positions else None
        hits_at_1 += int(bool(top and top[0]["id"] in expected))
        hits_at_k += int(any(item["id"] in expected for item in top))
        reciprocal_ranks.append(1 / best_rank if best_rank else 0)
        by_case.append(
            {
                "query": case["query"],
                "expected_ids": case["expected_ids"],
                "best_expected_rank": best_rank,
                "hit_at_1": bool(top and top[0]["id"] in expected),
                f"hit_at_{top_k}": any(item["id"] in expected for item in top),
                "top_results": top,
                "notes": case.get("notes"),
            }
        )

    n = len(cases)
    return {
        "provider": provider.name,
        "dimensions": dimensions if provider.name != "jina-embeddings-v5-text-small" else 1024,
        "catalog_size": len(docs),
        "case_count": n,
        "elapsed_ms": elapsed_ms,
        "hit_at_1": round(hits_at_1 / n, 4),
        f"hit_at_{top_k}": round(hits_at_k / n, 4),
        "mrr": round(sum(reciprocal_ranks) / n, 4),
        "cases": by_case,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--providers", default="openai,gemini", help="Comma-separated: openai,gemini,jina")
    parser.add_argument("--dimensions", type=int, default=DEFAULT_DIMENSIONS)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--catalog", type=Path, nargs="*", default=DEFAULT_CATALOGS)
    parser.add_argument("--language", default="en", help="Catalog language filter; empty string disables filtering")
    parser.add_argument("--max-docs", type=int, default=80, help="Limit docs for slow provider benchmarks; expected docs are always kept")
    args = parser.parse_args()

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    docs = load_catalog(args.catalog, args.language or None)
    if args.max_docs and len(docs) > args.max_docs:
        expected_ids = {doc_id for case in cases for doc_id in case["expected_ids"]}
        expected_docs = [doc for doc in docs if doc["id"] in expected_ids]
        filler = [doc for doc in docs if doc["id"] not in expected_ids]
        docs = expected_docs + filler[: max(0, args.max_docs - len(expected_docs))]
    results = []
    for key in [p.strip() for p in args.providers.split(",") if p.strip()]:
        cls = PROVIDERS.get(key)
        if cls is None:
            print(f"Skipping unknown provider: {key}")
            continue
        try:
            provider = cls()
            result = evaluate(provider, docs, cases, args.dimensions, args.top_k)
        except Exception as exc:
            result = {"provider": key, "error": str(exc)}
        results.append(result)
        if "error" in result:
            print(f"{key}: ERROR {result['error']}")
        else:
            print(
                f"{result['provider']}: hit@1={result['hit_at_1']} "
                f"hit@{args.top_k}={result[f'hit_at_{args.top_k}']} "
                f"mrr={result['mrr']} elapsed={result['elapsed_ms']}ms"
            )

    out_dir = ROOT / "benchmark_results"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"embedding_benchmark_{int(time.time())}.json"
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
