"""
Generate manual upload test catalogs from TMDB.

Creates:
  - scripts/manual_test_movies_20.json
  - scripts/manual_test_movies_20.ndjson

Each file contains 20 different movies with ScubaSearch-compatible OTT fields.

Usage:
  python3 scripts/generate_tmdb_test_catalogs.py
"""

from __future__ import annotations

import json
import os
import time
import csv
from pathlib import Path

import requests

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
OUTPUT_JSON = ROOT / "scripts" / "manual_test_movies_20.json"
OUTPUT_NDJSON = ROOT / "scripts" / "manual_test_movies_20.ndjson"
FALLBACK_CSV = ROOT / "scripts" / "movies.csv"


def load_tmdb_key() -> str:
    env_key = os.environ.get("TMDB_API_KEY", "").strip()
    if env_key:
        return env_key

    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("TMDB_API_KEY="):
                return line.split("=", 1)[1].strip()

    raise RuntimeError("TMDB_API_KEY not found in environment or .env")


def fetch_popular_movies(api_key: str, pages: int = 3) -> list[dict]:
    movies: list[dict] = []
    seen_ids: set[int] = set()

    for page in range(1, pages + 1):
        resp = requests.get(
            f"{TMDB_BASE}/movie/popular",
            params={"api_key": api_key, "language": "en-US", "page": page},
            timeout=20,
        )
        resp.raise_for_status()
        for item in resp.json().get("results", []):
            movie_id = item.get("id")
            if not movie_id or movie_id in seen_ids:
                continue
            seen_ids.add(movie_id)
            movies.append(item)
        time.sleep(0.2)

    return movies


def fetch_movie_detail(api_key: str, movie_id: int) -> dict:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(
                f"{TMDB_BASE}/movie/{movie_id}",
                params={"api_key": api_key, "append_to_response": "credits"},
                timeout=20,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"TMDB detail fetch failed for {movie_id}: {last_error}")


def normalize_movie(raw: dict, suffix: str) -> dict:
    credits = raw.get("credits", {}) or {}
    cast = credits.get("cast", []) or []
    crew = credits.get("crew", []) or []

    actors = ", ".join(member["name"] for member in cast[:5] if member.get("name"))
    directors = ", ".join(
        sorted({member["name"] for member in crew if member.get("job") == "Director"})
    )
    writers = ", ".join(
        sorted(
            {
                member["name"]
                for member in crew
                if member.get("job") in {"Screenplay", "Writer", "Story"}
            }
        )
    )

    genres = ", ".join(genre["name"] for genre in raw.get("genres", []) if genre.get("name"))
    release_date = raw.get("release_date") or ""
    year = int(release_date[:4]) if release_date[:4].isdigit() else None
    poster_path = raw.get("poster_path") or ""
    image_url = f"{TMDB_IMAGE_BASE}{poster_path}" if poster_path else ""
    product_url = f"https://www.themoviedb.org/movie/{raw['id']}"

    tag_parts: list[str] = []
    vote_average = raw.get("vote_average")
    if isinstance(vote_average, (int, float)):
        if vote_average >= 8.0:
            tag_parts.append("highly rated")
        elif vote_average >= 7.0:
            tag_parts.append("well rated")
    if genres:
        tag_parts.extend(part.strip() for part in genres.split(",") if part.strip())

    return {
        "id": f"tmdb_manual_{suffix}_{raw['id']}",
        "title": raw.get("title", ""),
        "description": raw.get("overview", ""),
        "category": genres,
        "tags": ", ".join(tag_parts),
        "actors": actors,
        "director": directors,
        "writer": writers,
        "content_type": "movie",
        "year": year,
        "language": raw.get("original_language", ""),
        "duration_mins": raw.get("runtime"),
        "image_url": image_url,
        "product_url": product_url,
    }


def load_fallback_movies() -> list[dict]:
    if not FALLBACK_CSV.exists():
        raise RuntimeError("TMDB fetch failed and fallback scripts/movies.csv was not found")

    with FALLBACK_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if len(rows) < 40:
        raise RuntimeError(f"Expected at least 40 rows in fallback CSV, got {len(rows)}")

    return rows[:40]


def main() -> None:
    api_key = load_tmdb_key()
    try:
        popular = fetch_popular_movies(api_key, pages=3)
        if len(popular) < 40:
            raise RuntimeError(f"Expected at least 40 movies, got {len(popular)}")

        details = []
        for item in popular[:40]:
            details.append(fetch_movie_detail(api_key, int(item["id"])))
            time.sleep(0.2)

        json_docs = [normalize_movie(movie, "json") for movie in details[:20]]
        ndjson_docs = [normalize_movie(movie, "ndjson") for movie in details[20:40]]
        source = "live TMDB"
    except Exception as exc:
        print(f"Live TMDB fetch failed ({exc}). Falling back to scripts/movies.csv")
        fallback_rows = load_fallback_movies()
        json_docs = []
        ndjson_docs = []
        for i, row in enumerate(fallback_rows[:20], start=1):
            doc = dict(row)
            doc["id"] = f"tmdb_manual_json_{i}_{row['id'].removeprefix('tmdb_')}"
            json_docs.append(doc)
        for i, row in enumerate(fallback_rows[20:40], start=1):
            doc = dict(row)
            doc["id"] = f"tmdb_manual_ndjson_{i}_{row['id'].removeprefix('tmdb_')}"
            ndjson_docs.append(doc)
        source = "fallback scripts/movies.csv"

    OUTPUT_JSON.write_text(json.dumps(json_docs, indent=2, ensure_ascii=False), encoding="utf-8")
    OUTPUT_NDJSON.write_text(
        "\n".join(json.dumps(doc, ensure_ascii=False) for doc in ndjson_docs) + "\n",
        encoding="utf-8",
    )

    print(f"Source: {source}")
    print(f"Wrote {len(json_docs)} movies to {OUTPUT_JSON}")
    print(f"Wrote {len(ndjson_docs)} movies to {OUTPUT_NDJSON}")


if __name__ == "__main__":
    main()
