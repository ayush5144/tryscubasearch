"""
Seed Meilisearch from OTT content CSV (movies.csv format).
Run: python seed_csv.py [--csv path/to/file.csv] [--client testclient]

Uses OpenAI text-embedding-3-small embeddings (1536 dims).
"""

import asyncio
import csv
import os
import re
import time
import httpx
import meilisearch

MEILI_HOST = "http://localhost:7700"
MEILI_KEY = "local_dev_key"
CLIENT_ID = "testclient"
CSV_PATH = "/Users/ayush/dev/scubasearch/scripts/movies.csv"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_EMBED_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable not set")

embedding_client = httpx.AsyncClient(
    base_url="https://api.openai.com",
    headers={
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    },
    timeout=30.0,
)


def parse_price(raw: str) -> float:
    """'Rs. 18,699.00' → 18699.0  |  '₹1,299' → 1299.0  |  '$49.99' → 49.99"""
    cleaned = re.sub(r"[^\d.]", "", str(raw).strip())
    if cleaned.count(".") > 1:
        parts = cleaned.split(".")
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


def load_csv(path: str) -> list[dict]:
    products = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # Parse OTT content fields (movies.csv format)
            title = row.get("title", "").strip()

            # product_id from CSV (e.g., tmdb_1234567)
            product_id = row.get("id", f"prod_{i}").strip()

            # Movie/OTT fields
            description = row.get("description", "").strip()
            category = row.get("category", "").strip()
            tags_str = row.get("tags", "").strip()
            tags = [t.strip() for t in tags_str.split(",")] if tags_str else []
            actors = row.get("actors", "").strip()
            director = row.get("director", "").strip()
            writer = row.get("writer", "").strip()
            content_type = row.get("content_type", "movie").strip()
            year = row.get("year", "2024").strip()
            language = row.get("language", "en").strip()

            # Image and URL
            image_url = row.get("image_url", "").strip()
            product_url = row.get("product_url", row.get("button href", "")).strip()

            # Try to parse price (some CSVs have it, some don't)
            price_str = row.get("price", "0").strip()
            price = parse_price(price_str) if price_str else 0.0

            if not title:
                continue

            products.append(
                {
                    "id": product_id,
                    "title": title,
                    "description": description,
                    "category": category,
                    "tags": tags,
                    "actors": actors,
                    "director": director,
                    "writer": writer,
                    "content_type": content_type,
                    "year": int(year) if year.isdigit() else 2024,
                    "language": language,
                    "price": price,
                    "image_url": image_url,
                    "product_url": product_url,
                }
            )

    return products


async def generate_embeddings(products: list[dict]) -> list[dict]:
    print(f"Generating embeddings for {len(products)} products using OpenAI...")
    docs = []

    for i in range(0, len(products), 20):
        batch = products[i : i + 20]
        # Build embedding text with title, description, tags, category
        texts = []
        for p in batch:
            parts = [p.get("title", "")]
            if p.get("description"):
                parts.append(p["description"])
            if p.get("tags"):
                parts.append(" ".join(p["tags"]))
            if p.get("category"):
                parts.append(p["category"])
            text = " ".join([str(x) for x in parts if x])
            texts.append(text)

        resp = await embedding_client.post(
            "/v1/embeddings",
            json={"model": OPENAI_EMBED_MODEL, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()

        for j, product in enumerate(batch):
            embedding = data["data"][j]["embedding"]
            doc = {**product, "_vectors": {"default": embedding}}
            docs.append(doc)

        print(f"  Embedded {min(i + 20, len(products))}/{len(products)}")
        time.sleep(0.3)

    return docs


def configure_index(meili: meilisearch.Client, index_name: str) -> None:
    print(f"Configuring index: {index_name}")

    # Enable vector store experimental feature (required for hybrid search)
    meili.http.patch("/experimental-features", {"vectorStore": True})

    try:
        meili.create_index(index_name, {"primaryKey": "id"})
    except Exception:
        pass

    index = meili.index(index_name)
    task = index.update_settings(
        {
            "searchableAttributes": [
                "title",
                "description",
                "actors",
                "director",
                "writer",
                "content_type",
                "year",
                "language",
                "tags",
                "category",
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
                "default": {"source": "userProvided", "dimensions": EMBEDDING_DIMS}
            },
        }
    )
    meili.wait_for_task(task.task_uid)
    print("  Settings applied")


def insert_documents(
    meili: meilisearch.Client, index_name: str, docs: list[dict]
) -> None:
    print(f"Inserting {len(docs)} documents...")
    index = meili.index(index_name)
    task = index.add_documents(docs)
    meili.wait_for_task(task.task_uid, timeout_in_ms=120000)
    stats = index.get_stats()
    print(f"  Documents in index: {stats.number_of_documents}")


async def main():
    index_name = f"products_{CLIENT_ID}"
    meili = meilisearch.Client(MEILI_HOST, MEILI_KEY)

    print(f"Meilisearch: {meili.health()}")

    products = load_csv(CSV_PATH)
    print(f"Loaded {len(products)} products from CSV")

    # Preview first 3
    for p in products[:3]:
        print(f"  {p['id']} | {p['title'][:50]} | {p.get('category', 'N/A')}")

    configure_index(meili, index_name)
    docs = await generate_embeddings(products)
    insert_documents(meili, index_name, docs)

    print(f"\nDone! {len(docs)} movies indexed in '{index_name}'")
    print("\nTest queries to try:")
    print('  {"query": "action"}')
    print('  {"query": "comedy drama"}')
    print('  {"query": "adventure 2026"}')


if __name__ == "__main__":
    asyncio.run(main())
