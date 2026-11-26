from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

from backend.app.db.database import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _execute_job(job_id: str, job_type: str, region_id: str | None, config: dict[str, Any], runner: Callable[[], Coroutine[Any, Any, dict[str, Any]]]) -> None:
    db.upsert_job(
        {
            "job_id": job_id,
            "job_type": job_type,
            "status": "running",
            "region_id": region_id,
            "config": config,
            "result": None,
            "error_message": None,
            "created_at": config["created_at"],
            "completed_at": None,
        }
    )
    try:
        result = await runner()
        db.upsert_job(
            {
                "job_id": job_id,
                "job_type": job_type,
                "status": "completed",
                "region_id": region_id,
                "config": config,
                "result": result,
                "error_message": None,
                "created_at": config["created_at"],
                "completed_at": _now(),
            }
        )
    except Exception as exc:
        db.upsert_job(
            {
                "job_id": job_id,
                "job_type": job_type,
                "status": "failed",
                "region_id": region_id,
                "config": config,
                "result": None,
                "error_message": str(exc),
                "created_at": config["created_at"],
                "completed_at": _now(),
            }
        )


def enqueue_async_job(
    job_type: str,
    region_id: str | None,
    config: dict[str, Any],
    runner: Callable[[], Coroutine[Any, Any, dict[str, Any]]],
) -> dict[str, Any]:
    job_id = f"job-{uuid.uuid4().hex[:10]}"
    created_at = _now()
    enriched_config = {**config, "created_at": created_at}
    record = {
        "job_id": job_id,
        "job_type": job_type,
        "status": "queued",
        "region_id": region_id,
        "config": enriched_config,
        "result": None,
        "error_message": None,
        "created_at": created_at,
        "completed_at": None,
    }
    db.upsert_job(record)
    asyncio.create_task(_execute_job(job_id, job_type, region_id, enriched_config, runner))
    return record
