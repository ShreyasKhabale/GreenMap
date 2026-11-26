from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import psycopg

from backend.app.config import (
    DATABASE_URL,
    LOCAL_DB_PATH,
    POSTGIS_DB,
    POSTGIS_HOST,
    POSTGIS_PASSWORD,
    POSTGIS_PORT,
    POSTGIS_SSLMODE,
    POSTGIS_USER,
    get_database_target_info,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DatabaseConnectionError(RuntimeError):
    """Raised when a configured PostgreSQL/Neon connection or query fails."""


def _sanitize_db_error(err: Exception | str) -> str:
    msg = str(err or "Unknown PostgreSQL connection error")
    msg = re.sub(
        r"(postgres(?:ql)?://)([^:@/\s]+):([^@/\s]+)@",
        r"\1***:***@",
        msg,
        flags=re.IGNORECASE,
    )
    msg = re.sub(r"(password\s*=\s*)(\S+)", r"\1***", msg, flags=re.IGNORECASE)
    if POSTGIS_PASSWORD:
        msg = msg.replace(POSTGIS_PASSWORD, "***")
    if DATABASE_URL:
        try:
            parsed = urlsplit(DATABASE_URL)
            if parsed.password:
                msg = msg.replace(parsed.password, "***")
        except Exception:
            pass
    return msg


class GreenMapDatabase:
    """
    PostgreSQL + PostGIS repository (supporting Neon DATABASE_URL, Cloud SQL sockets,
    or TCP PostGIS hosts) via psycopg, with local SQLite fallback ONLY when no external
    PostgreSQL/Neon database is configured.
    """

    def __init__(self) -> None:
        self._target_info = get_database_target_info()
        self._postgis_configured = bool(DATABASE_URL or (POSTGIS_HOST and POSTGIS_USER))
        self._neon_configured = bool(self._target_info.get("neon_configured"))
        self._pg_connected = False
        self._postgis_connected = False
        self._postgis_error: str | None = None
        self._pg_version: str | None = None
        self._postgis_version: str | None = None
        self._schema_tables: list[str] = []
        self._init_local_sqlite()
        if self._postgis_configured:
            self._init_postgis()

    def _get_pg_conn(self) -> psycopg.Connection:
        if DATABASE_URL:
            return psycopg.connect(DATABASE_URL, connect_timeout=4)
        kwargs: dict[str, Any] = {
            "host": POSTGIS_HOST,
            "dbname": POSTGIS_DB,
            "user": POSTGIS_USER,
            "password": POSTGIS_PASSWORD,
            "connect_timeout": 4,
        }
        if not POSTGIS_HOST.startswith("/"):
            kwargs["port"] = POSTGIS_PORT
        if POSTGIS_SSLMODE:
            kwargs["sslmode"] = POSTGIS_SSLMODE
        return psycopg.connect(**kwargs)

    @staticmethod
    def _is_postgis_extension_error(exc: Exception) -> bool:
        low = str(exc).lower()
        return "postgis" in low and any(
            marker in low
            for marker in (
                "extension \"postgis\" is not available",
                "could not open extension control file",
                "permission denied to create extension",
                "type \"geometry\" does not exist",
            )
        )

    def _init_postgis(self) -> None:
        try:
            schema_sql = (Path(__file__).resolve().parent / "schema.sql").read_text(encoding="utf-8")
            with self._get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(schema_sql)
                    cur.execute("SELECT version(), PostGIS_Version()")
                    ver_row = cur.fetchone()
                    cur.execute(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                        ORDER BY table_name
                        """
                    )
                    table_rows = cur.fetchall()
                conn.commit()
            self._pg_connected = True
            self._postgis_connected = True
            self._postgis_error = None
            self._pg_version = str(ver_row[0]).split(",")[0] if ver_row and ver_row[0] else None
            self._postgis_version = str(ver_row[1]) if ver_row and ver_row[1] else None
            self._schema_tables = [str(r[0]) for r in table_rows]
        except Exception as exc:
            if self._is_postgis_extension_error(exc):
                try:
                    with self._get_pg_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute(
                                """
                                CREATE TABLE IF NOT EXISTS nasa_power_cache (
                                    cache_key TEXT PRIMARY KEY,
                                    latitude DOUBLE PRECISION NOT NULL,
                                    longitude DOUBLE PRECISION NOT NULL,
                                    payload_json JSONB NOT NULL,
                                    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                );
                                CREATE TABLE IF NOT EXISTS ahp_configurations (
                                    config_id TEXT PRIMARY KEY,
                                    scenario TEXT NOT NULL CHECK (scenario IN ('solar', 'wind')),
                                    matrix_json JSONB NOT NULL,
                                    weights_json JSONB NOT NULL,
                                    lambda_max DOUBLE PRECISION NOT NULL,
                                    ci DOUBLE PRECISION NOT NULL,
                                    cr DOUBLE PRECISION NOT NULL,
                                    is_consistent BOOLEAN NOT NULL,
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                );
                                CREATE TABLE IF NOT EXISTS analysis_jobs (
                                    job_id TEXT PRIMARY KEY,
                                    job_type TEXT NOT NULL,
                                    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
                                    region_id TEXT,
                                    config_json JSONB NOT NULL,
                                    result_json JSONB,
                                    error_message TEXT,
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                    completed_at TIMESTAMPTZ
                                );
                                CREATE TABLE IF NOT EXISTS ml_model_runs (
                                    run_id TEXT PRIMARY KEY,
                                    scenario TEXT NOT NULL,
                                    dataset_source TEXT NOT NULL,
                                    sample_count INTEGER NOT NULL,
                                    metrics_json JSONB NOT NULL,
                                    shap_json JSONB NOT NULL,
                                    clusters_json JSONB NOT NULL,
                                    ahp_comparison_json JSONB NOT NULL,
                                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                );
                                """
                            )
                            cur.execute("SELECT version()")
                            ver_row = cur.fetchone()
                        conn.commit()
                    self._pg_connected = True
                    self._postgis_connected = False
                    self._pg_version = str(ver_row[0]).split(",")[0] if ver_row and ver_row[0] else None
                    self._postgis_version = None
                    self._postgis_error = f"PostGIS extension unavailable ({_sanitize_db_error(exc)}); relational PostgreSQL active."
                    return
                except Exception as pg_exc:
                    exc = pg_exc

            self._pg_connected = False
            self._postgis_connected = False
            self._pg_version = None
            self._postgis_version = None
            self._schema_tables = []
            self._postgis_error = _sanitize_db_error(exc)

    def _init_local_sqlite(self) -> None:
        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS nasa_power_cache (
                    cache_key TEXT PRIMARY KEY,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    payload_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS srtm_cache (
                    cache_key TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ahp_configurations (
                    config_id TEXT PRIMARY KEY,
                    scenario TEXT NOT NULL,
                    matrix_json TEXT NOT NULL,
                    weights_json TEXT NOT NULL,
                    lambda_max REAL NOT NULL,
                    ci REAL NOT NULL,
                    cr REAL NOT NULL,
                    is_consistent INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analysis_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    region_id TEXT,
                    config_json TEXT NOT NULL,
                    result_json TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS ml_model_runs (
                    run_id TEXT PRIMARY KEY,
                    scenario TEXT NOT NULL,
                    dataset_source TEXT NOT NULL,
                    sample_count INTEGER NOT NULL,
                    metrics_json TEXT NOT NULL,
                    shap_json TEXT NOT NULL,
                    clusters_json TEXT NOT NULL,
                    ahp_comparison_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def _ensure_pg_ready(self) -> None:
        if not self._postgis_configured:
            return
        if not self._pg_connected:
            self._init_postgis()
        if not self._pg_connected:
            target = "Neon PostgreSQL" if self._neon_configured else "PostgreSQL"
            raise DatabaseConnectionError(
                f"{target} connection failed (no SQLite fallback performed): {self._postgis_error or 'connection error'}"
            )

    def ping(self) -> dict[str, Any]:
        if self._postgis_configured:
            if not self._pg_connected:
                self._init_postgis()
            else:
                try:
                    with self._get_pg_conn() as conn, conn.cursor() as cur:
                        if self._postgis_connected:
                            cur.execute("SELECT version(), PostGIS_Version()")
                            ver_row = cur.fetchone()
                            self._pg_version = str(ver_row[0]).split(",")[0] if ver_row and ver_row[0] else self._pg_version
                            self._postgis_version = str(ver_row[1]) if ver_row and ver_row[1] else self._postgis_version
                        else:
                            cur.execute("SELECT version()")
                            ver_row = cur.fetchone()
                            self._pg_version = str(ver_row[0]).split(",")[0] if ver_row and ver_row[0] else self._pg_version
                except Exception as exc:
                    self._pg_connected = False
                    self._postgis_connected = False
                    self._postgis_error = _sanitize_db_error(exc)
        return self.status()

    def status(self) -> dict[str, Any]:
        if self._postgis_configured:
            prefix = "Neon " if self._neon_configured else ""
            if self._postgis_connected:
                engine = f"{prefix}PostgreSQL + PostGIS"
            elif self._pg_connected:
                engine = f"{prefix}PostgreSQL"
            else:
                engine = f"{prefix}PostgreSQL + PostGIS (Connection Failed)"
        else:
            engine = "Local Spatial Cache (PostGIS DDL Ready)"
        return {
            "engine": engine,
            "target": self._target_info.get("target"),
            "host": self._target_info.get("host"),
            "dbname": self._target_info.get("dbname"),
            "sslmode": self._target_info.get("sslmode"),
            "password_configured": self._target_info.get("password_configured"),
            "env_flags": self._target_info.get("env_flags"),
            "postgis_configured": self._postgis_configured,
            "neon_configured": self._neon_configured,
            "postgis_connected": self._postgis_connected,
            "postgres_connected": self._pg_connected,
            "postgres_version": self._pg_version,
            "postgis_version": self._postgis_version,
            "schema_tables": self._schema_tables,
            "fallback_active": not self._postgis_configured,
            "postgis_error": self._postgis_error if self._postgis_configured and not self._postgis_connected else None,
        }

    def get_nasa_cache(self, cache_key: str) -> dict[str, Any] | None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload_json FROM nasa_power_cache WHERE cache_key = %s",
                        (cache_key,),
                    )
                    row = cur.fetchone()
                    if row:
                        return row[0] if isinstance(row[0], dict) else json.loads(row[0])
                return None
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL read failed (nasa_power_cache): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            row = conn.execute(
                "SELECT payload_json FROM nasa_power_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            return json.loads(row[0]) if row else None

    def set_nasa_cache(self, cache_key: str, lat: float, lon: float, payload: dict[str, Any]) -> None:
        serialized = json.dumps(payload)
        now = _utc_now_iso()
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO nasa_power_cache (cache_key, latitude, longitude, payload_json, fetched_at)
                        VALUES (%s, %s, %s, %s::jsonb, NOW())
                        ON CONFLICT (cache_key) DO UPDATE SET payload_json = EXCLUDED.payload_json, fetched_at = NOW()
                        """,
                        (cache_key, lat, lon, serialized),
                    )
                    conn.commit()
                return
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL write failed (nasa_power_cache): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.execute(
                """
                INSERT INTO nasa_power_cache (cache_key, latitude, longitude, payload_json, fetched_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at
                """,
                (cache_key, lat, lon, serialized, now),
            )
            conn.commit()

    def get_srtm_cache(self, cache_key: str) -> dict[str, Any] | None:
        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            row = conn.execute(
                "SELECT payload_json FROM srtm_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
            return json.loads(row[0]) if row else None

    def set_srtm_cache(self, cache_key: str, payload: dict[str, Any]) -> None:
        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.execute(
                """
                INSERT INTO srtm_cache (cache_key, payload_json, fetched_at)
                VALUES (?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at
                """,
                (cache_key, json.dumps(payload), _utc_now_iso()),
            )
            conn.commit()

    def save_ahp_config(self, record: dict[str, Any]) -> None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO ahp_configurations (config_id, scenario, matrix_json, weights_json, lambda_max, ci, cr, is_consistent, created_at)
                        VALUES (%s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s)
                        ON CONFLICT (config_id) DO NOTHING
                        """,
                        (
                            record["config_id"],
                            record["scenario"],
                            json.dumps(record["matrix"]),
                            json.dumps(record["weights"]),
                            record["lambda_max"],
                            record["ci"],
                            record["cr"],
                            record["is_consistent"],
                            record.get("created_at") or _utc_now_iso(),
                        ),
                    )
                    conn.commit()
                return
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL write failed (ahp_configurations): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO ahp_configurations
                (config_id, scenario, matrix_json, weights_json, lambda_max, ci, cr, is_consistent, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["config_id"],
                    record["scenario"],
                    json.dumps(record["matrix"]),
                    json.dumps(record["weights"]),
                    record["lambda_max"],
                    record["ci"],
                    record["cr"],
                    1 if record["is_consistent"] else 0,
                    record["created_at"],
                ),
            )
            conn.commit()

    def list_ahp_configs(self, limit: int = 10) -> list[dict[str, Any]]:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT config_id, scenario, matrix_json, weights_json, lambda_max, ci, cr, is_consistent, created_at
                        FROM ahp_configurations ORDER BY created_at DESC LIMIT %s
                        """,
                        (limit,),
                    )
                    rows = cur.fetchall()
                return [
                    {
                        "config_id": r[0],
                        "scenario": r[1],
                        "matrix": r[2] if isinstance(r[2], list) else json.loads(r[2]),
                        "weights": r[3] if isinstance(r[3], dict) else json.loads(r[3]),
                        "lambda_max": float(r[4]),
                        "ci": float(r[5]),
                        "cr": float(r[6]),
                        "is_consistent": bool(r[7]),
                        "created_at": r[8].isoformat() if hasattr(r[8], "isoformat") else str(r[8]),
                    }
                    for r in rows
                ]
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL read failed (ahp_configurations): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            rows = conn.execute(
                """
                SELECT config_id, scenario, matrix_json, weights_json, lambda_max, ci, cr, is_consistent, created_at
                FROM ahp_configurations ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "config_id": r[0],
                "scenario": r[1],
                "matrix": json.loads(r[2]),
                "weights": json.loads(r[3]),
                "lambda_max": r[4],
                "ci": r[5],
                "cr": r[6],
                "is_consistent": bool(r[7]),
                "created_at": r[8],
            }
            for r in rows
        ]

    def upsert_job(self, job: dict[str, Any]) -> None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO analysis_jobs (job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)
                        ON CONFLICT (job_id) DO UPDATE SET
                            status = EXCLUDED.status,
                            result_json = EXCLUDED.result_json,
                            error_message = EXCLUDED.error_message,
                            completed_at = EXCLUDED.completed_at
                        """,
                        (
                            job["job_id"],
                            job["job_type"],
                            job["status"],
                            job.get("region_id"),
                            json.dumps(job.get("config", {})),
                            json.dumps(job["result"]) if job.get("result") is not None else None,
                            job.get("error_message"),
                            job["created_at"],
                            job.get("completed_at"),
                        ),
                    )
                    conn.commit()
                return
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL write failed (analysis_jobs): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.execute(
                """
                INSERT INTO analysis_jobs (job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    status = excluded.status,
                    result_json = excluded.result_json,
                    error_message = excluded.error_message,
                    completed_at = excluded.completed_at
                """,
                (
                    job["job_id"],
                    job["job_type"],
                    job["status"],
                    job.get("region_id"),
                    json.dumps(job.get("config", {})),
                    json.dumps(job["result"]) if job.get("result") is not None else None,
                    job.get("error_message"),
                    job["created_at"],
                    job.get("completed_at"),
                ),
            )
            conn.commit()

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at
                        FROM analysis_jobs WHERE job_id = %s
                        """,
                        (job_id,),
                    )
                    row = cur.fetchone()
                if not row:
                    return None
                return {
                    "job_id": row[0],
                    "job_type": row[1],
                    "status": row[2],
                    "region_id": row[3],
                    "config": row[4] if isinstance(row[4], dict) else json.loads(row[4]),
                    "result": row[5] if (row[5] is None or isinstance(row[5], dict)) else json.loads(row[5]),
                    "error_message": row[6],
                    "created_at": row[7].isoformat() if hasattr(row[7], "isoformat") else str(row[7]),
                    "completed_at": row[8].isoformat() if hasattr(row[8], "isoformat") else row[8],
                }
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL read failed (analysis_jobs): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            row = conn.execute(
                """
                SELECT job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at
                FROM analysis_jobs WHERE job_id = ?
                """,
                (job_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "job_id": row[0],
            "job_type": row[1],
            "status": row[2],
            "region_id": row[3],
            "config": json.loads(row[4]),
            "result": json.loads(row[5]) if row[5] else None,
            "error_message": row[6],
            "created_at": row[7],
            "completed_at": row[8],
        }

    def list_jobs(self, limit: int = 25) -> list[dict[str, Any]]:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at
                        FROM analysis_jobs ORDER BY created_at DESC LIMIT %s
                        """,
                        (limit,),
                    )
                    rows = cur.fetchall()
                return [
                    {
                        "job_id": r[0],
                        "job_type": r[1],
                        "status": r[2],
                        "region_id": r[3],
                        "config": r[4] if isinstance(r[4], dict) else json.loads(r[4]),
                        "result": r[5] if (r[5] is None or isinstance(r[5], dict)) else json.loads(r[5]),
                        "error_message": r[6],
                        "created_at": r[7].isoformat() if hasattr(r[7], "isoformat") else str(r[7]),
                        "completed_at": r[8].isoformat() if hasattr(r[8], "isoformat") else r[8],
                    }
                    for r in rows
                ]
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL read failed (analysis_jobs): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            rows = conn.execute(
                """
                SELECT job_id, job_type, status, region_id, config_json, result_json, error_message, created_at, completed_at
                FROM analysis_jobs ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "job_id": r[0],
                "job_type": r[1],
                "status": r[2],
                "region_id": r[3],
                "config": json.loads(r[4]),
                "result": json.loads(r[5]) if r[5] else None,
                "error_message": r[6],
                "created_at": r[7],
                "completed_at": r[8],
            }
            for r in rows
        ]

    def save_ml_run(self, run: dict[str, Any]) -> None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO ml_model_runs
                        (run_id, scenario, dataset_source, sample_count, metrics_json, shap_json, clusters_json, ahp_comparison_json, created_at)
                        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                        ON CONFLICT (run_id) DO NOTHING
                        """,
                        (
                            run["run_id"],
                            run["scenario"],
                            run["dataset_source"],
                            run["sample_count"],
                            json.dumps(run["metrics"]),
                            json.dumps(run["shap"]),
                            json.dumps(run["clusters"]),
                            json.dumps(run["ahp_comparison"]),
                            run["created_at"],
                        ),
                    )
                    conn.commit()
                return
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL write failed (ml_model_runs): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO ml_model_runs
                (run_id, scenario, dataset_source, sample_count, metrics_json, shap_json, clusters_json, ahp_comparison_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run["run_id"],
                    run["scenario"],
                    run["dataset_source"],
                    run["sample_count"],
                    json.dumps(run["metrics"]),
                    json.dumps(run["shap"]),
                    json.dumps(run["clusters"]),
                    json.dumps(run["ahp_comparison"]),
                    run["created_at"],
                ),
            )
            conn.commit()

    def get_latest_ml_run(self, scenario: str = "hybrid") -> dict[str, Any] | None:
        if self._postgis_configured:
            self._ensure_pg_ready()
            try:
                with self._get_pg_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT run_id, scenario, dataset_source, sample_count, metrics_json, shap_json, clusters_json, ahp_comparison_json, created_at
                        FROM ml_model_runs WHERE scenario = %s ORDER BY created_at DESC LIMIT 1
                        """,
                        (scenario,),
                    )
                    row = cur.fetchone()
                if not row:
                    return None
                return {
                    "run_id": row[0],
                    "scenario": row[1],
                    "dataset_source": row[2],
                    "sample_count": int(row[3]),
                    "metrics": row[4] if isinstance(row[4], dict) else json.loads(row[4]),
                    "shap": row[5] if isinstance(row[5], dict) else json.loads(row[5]),
                    "clusters": row[6] if isinstance(row[6], list) else json.loads(row[6]),
                    "ahp_comparison": row[7] if isinstance(row[7], dict) else json.loads(row[7]),
                    "created_at": row[8].isoformat() if hasattr(row[8], "isoformat") else str(row[8]),
                }
            except Exception as exc:
                self._pg_connected = False
                self._postgis_error = _sanitize_db_error(exc)
                raise DatabaseConnectionError(f"PostgreSQL read failed (ml_model_runs): {self._postgis_error}") from exc

        with sqlite3.connect(LOCAL_DB_PATH) as conn:
            row = conn.execute(
                """
                SELECT run_id, scenario, dataset_source, sample_count, metrics_json, shap_json, clusters_json, ahp_comparison_json, created_at
                FROM ml_model_runs WHERE scenario = ? ORDER BY created_at DESC LIMIT 1
                """,
                (scenario,),
            ).fetchone()
        if not row:
            return None
        return {
            "run_id": row[0],
            "scenario": row[1],
            "dataset_source": row[2],
            "sample_count": row[3],
            "metrics": json.loads(row[4]),
            "shap": json.loads(row[5]),
            "clusters": json.loads(row[6]),
            "ahp_comparison": json.loads(row[7]),
            "created_at": row[8],
        }


db = GreenMapDatabase()
