import os
import sys

# Ensure backend/ is on the path when running celery from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from celery import Celery
from config import settings

celery_app = Celery(
    "scubasearch",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "sync-due-api-sources-every-5-min": {
            "task": "workers.tasks.sync_due_api_sources",
            "schedule": 300.0,
        }
    },
)
