"""
Load ~200 popular movies from TMDB into ScubaSearch.

Usage:
  python3 scripts/load_tmdb.py --api-key YOUR_TMDB_KEY --client-key sk_live_YOUR_SCUBA_KEY
  python3 scripts/load_tmdb.py --api-key YOUR_TMDB_KEY --client-key sk_live_YOUR_SCUBA_KEY --mode csv

Modes:
  api  (default) — POST each movie directly via /api/v1/documents (ingest single-doc endpoint)
  csv  — generate movies.csv, then POST to /api/v1/ingest/csv (bulk ingest via Celery)

Requires: pip install requests python-dotenv
"""

import argparse
import csv
import json
import time
import os

import requests
from pathlib import Path

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
SCUBA_BASE = os.environ.get("SCUBA_API_BASE", "http://localhost:8000")


def fetch_popular_movies(api_key: str, pages: int = 10) -> list[dict]:
    """Fetch popular movies from TMDB (20 per page × pages = up to 200)."""
    movies = []
    for page in range(1, pages + 1):
        for attempt in range(3):
            try:
                r = requests.get(
                    f"{TMDB_BASE}/movie/popular",
                    params={"api_key": api_key, "language": "en-US", "page": page},
                    timeout=15,
                )
                r.raise_for_status()
                break
            except Exception as e:
                if attempt == 2:
                    print(f"  Page {page} failed after 3 attempts: {e}")
                    return movies
                time.sleep(1.5)
        results = r.json().get("results", [])
        movies.extend(results)
        print(f"  Fetched page {page}/{pages} — {len(results)} movies")
        time.sleep(0.25)  # polite rate limiting
    return movies


def fetch_movie_credits(api_key: str, movie_id: int) -> tuple[str, str, str]:
    """Return (actors_csv, director, writer) for a movie."""
    try:
        r = requests.get(
            f"{TMDB_BASE}/movie/{movie_id}/credits",
            params={"api_key": api_key},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        cast = data.get("cast", [])
        crew = data.get("crew", [])

        # Top 5 billed actors
        actors = ", ".join(m["name"] for m in cast[:5] if m.get("name"))

        # Director(s)
        directors = [m["name"] for m in crew if m.get("job") == "Director"]
        director = ", ".join(directors[:2])

        # Writer(s) — Screenplay or Story credit
        writers = [
            m["name"] for m in crew if m.get("job") in ("Screenplay", "Writer", "Story")
        ]
        writer = ", ".join(writers[:2])

        return actors, director, writer
    except Exception as e:
        print(f"    Credits fetch failed for {movie_id}: {e}")
        return "", "", ""


def normalize_movie(raw: dict, actors: str, director: str, writer: str) -> dict:
    """Convert TMDB movie dict to ScubaSearch document format."""
    genre_names = ", ".join(g["name"] for g in raw.get("genres", []))
    # popular endpoint doesn't include genres — use genre_ids mapping
    if not genre_names and raw.get("genre_ids"):
        # Simple static map for common genre IDs
        genre_map = {
            28: "Action",
            12: "Adventure",
            16: "Animation",
            35: "Comedy",
            80: "Crime",
            99: "Documentary",
            18: "Drama",
            10751: "Family",
            14: "Fantasy",
            36: "History",
            27: "Horror",
            10402: "Music",
            9648: "Mystery",
            10749: "Romance",
            878: "Science Fiction",
            10770: "TV Movie",
            53: "Thriller",
            10752: "War",
            37: "Western",
        }
        genre_names = ", ".join(
            genre_map[gid] for gid in raw["genre_ids"] if gid in genre_map
        )

    poster = raw.get("poster_path", "")
    image_url = f"{TMDB_IMAGE_BASE}{poster}" if poster else ""

    release = raw.get("release_date", "")
    year = int(release[:4]) if release and release[:4].isdigit() else None

    tags_parts = []
    if raw.get("vote_average"):
        rating = float(raw["vote_average"])
        if rating >= 8.0:
            tags_parts.append("highly rated")
        elif rating >= 7.0:
            tags_parts.append("well rated")
    # Add genre as tags too for richer semantic search
    if genre_names:
        tags_parts.extend(g.strip() for g in genre_names.split(",") if g.strip())

    return {
        "id": f"tmdb_{raw['id']}",
        "title": raw.get("title", ""),
        "description": raw.get("overview", ""),
        "category": genre_names,  # genre
        "tags": ", ".join(tags_parts),
        "actors": actors,
        "director": director,
        "writer": writer,
        "content_type": "movie",
        "year": year,
        "language": raw.get("original_language", ""),
        "image_url": image_url,  # thumbnail/poster
        "product_url": f"https://www.themoviedb.org/movie/{raw['id']}",  # content URL
        "in_stock": True,  # available
    }


def load_via_api(movies: list[dict], scuba_key: str) -> None:
    """POST each movie to /api/v1/push/document one by one."""
    headers = {
        "Authorization": f"Bearer {scuba_key}",
        "Content-Type": "application/json",
    }
    success = 0
    for i, doc in enumerate(movies):
        r = requests.post(
            f"{SCUBA_BASE}/api/v1/push/document",
            headers=headers,
            json=doc,
            timeout=30,
        )
        if r.status_code in (200, 201):
            success += 1
        else:
            print(f"  [{i + 1}] FAIL {r.status_code}: {doc['title']} — {r.text[:100]}")
        if (i + 1) % 20 == 0:
            print(f"  Progress: {i + 1}/{len(movies)} ({success} OK)")
    print(f"\nDone: {success}/{len(movies)} documents indexed via API")


def load_via_csv(movies: list[dict], scuba_key: str) -> None:
    """Write to movies.csv then POST to /api/v1/ingest/csv."""
    csv_path = Path("scripts/movies.csv")
    fieldnames = [
        "id",
        "title",
        "description",
        "category",
        "tags",
        "actors",
        "director",
        "writer",
        "content_type",
        "year",
        "language",
        "image_url",
        "product_url",
        "in_stock",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(movies)
    print(f"Wrote {len(movies)} rows to {csv_path}")

    # POST to ingest
    headers = {"Authorization": f"Bearer {scuba_key}"}
    with open(csv_path, "rb") as f:
        r = requests.post(
            f"{SCUBA_BASE}/api/v1/ingest/csv",
            headers=headers,
            files={"file": ("movies.csv", f, "text/csv")},
            params={"mode": "replace"},
            timeout=30,
        )
    if r.ok:
        data = r.json()
        job_id = data.get("job_id")
        print(f"Ingest job queued: {job_id}")
        print("Polling job status...")
        poll_job(job_id, scuba_key)
    else:
        print(f"Ingest failed {r.status_code}: {r.text}")


def poll_job(job_id: str, scuba_key: str, max_wait: int = 300) -> None:
    headers = {"Authorization": f"Bearer {scuba_key}"}
    for _ in range(max_wait // 3):
        time.sleep(3)
        r = requests.get(
            f"{SCUBA_BASE}/api/v1/ingest/jobs/{job_id}",
            headers=headers,
            timeout=10,
        )
        if not r.ok:
            print(f"  Poll error: {r.status_code}")
            continue
        data = r.json()
        status = data.get("status")
        processed = data.get("processed", 0)
        total = data.get("total", 0)
        print(f"  Status: {status} — {processed}/{total}")
        if status == "done":
            print(
                f"  Added: {data.get('added_count')}  Updated: {data.get('updated_count')}  Skipped: {data.get('skipped_count')}"
            )
            return
        if status == "failed":
            print(f"  Error: {data.get('error_log')}")
            return
    print("  Timed out waiting for job")


def test_search(scuba_key: str) -> None:
    """Run a few test searches to verify OTT content is indexed."""
    queries = [
        "mind bending thriller",
        "christopher nolan",
        "animated family movie",
        "romantic comedy",
        "action movie 2023",
    ]
    headers = {"Authorization": f"Bearer {scuba_key}"}
    print("\n--- Search Tests ---")
    for q in queries:
        r = requests.post(
            f"{SCUBA_BASE}/api/v1/search",
            headers=headers,
            json={"query": q, "limit": 3, "semantic_ratio": 0.7},
            timeout=15,
        )
        if r.ok:
            hits = r.json().get("results", [])
            titles = [h.get("title", "?") for h in hits[:3]]
            print(f'  "{q}" → {titles}')
        else:
            print(f'  "{q}" → ERROR {r.status_code}')


def main():
    parser = argparse.ArgumentParser(description="Load TMDB movies into ScubaSearch")
    parser.add_argument(
        "--api-key",
        default=os.environ.get("TMDB_API_KEY", ""),
        help="TMDB API key (v3). Falls back to TMDB_API_KEY from env.",
    )
    parser.add_argument(
        "--client-key", required=True, help="ScubaSearch API key (sk_live_...)"
    )
    parser.add_argument(
        "--mode",
        choices=["api", "csv"],
        default="api",
        help="api = direct single-doc POST, csv = bulk ingest via Celery",
    )
    parser.add_argument(
        "--pages", type=int, default=10, help="TMDB pages to fetch (20 movies each)"
    )
    parser.add_argument(
        "--credits",
        action="store_true",
        help="Fetch cast/crew per movie (slower, ~200 extra API calls)",
    )
    args = parser.parse_args()

    if not args.api_key:
        raise SystemExit(
            "TMDB API key missing. Pass --api-key or set TMDB_API_KEY in the environment."
        )

    print(f"Fetching {args.pages * 20} movies from TMDB...")
    raw_movies = fetch_popular_movies(args.api_key, args.pages)
    print(f"Fetched {len(raw_movies)} movies total\n")

    movies = []
    for i, raw in enumerate(raw_movies):
        if not raw.get("title"):
            continue
        actors, director, writer = "", "", ""
        if args.credits:
            print(f"  [{i + 1}/{len(raw_movies)}] Fetching credits for: {raw['title']}")
            actors, director, writer = fetch_movie_credits(args.api_key, raw["id"])
            time.sleep(0.15)
        doc = normalize_movie(raw, actors, director, writer)
        movies.append(doc)

    print(f"\nNormalized {len(movies)} documents")
    print(f"Sample: {json.dumps(movies[0], indent=2)}\n")

    if args.mode == "api":
        load_via_api(movies, args.client_key)
    else:
        load_via_csv(movies, args.client_key)

    # Test searches
    test_search(args.client_key)


if __name__ == "__main__":
    main()
