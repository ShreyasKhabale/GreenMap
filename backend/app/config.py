import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_CACHE_DIR = Path(os.getenv("GREENMAP_DATA_CACHE", str(BASE_DIR / "data_cache")))
DATA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
RASTER_CACHE_DIR = DATA_CACHE_DIR / "rasters"
RASTER_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_database_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    if not cleaned:
        return ""
    if (cleaned.startswith('"') and cleaned.endswith('"')) or (cleaned.startswith("'") and cleaned.endswith("'")):
        cleaned = cleaned[1:-1].strip()
    if cleaned.lower().startswith("psql "):
        cleaned = cleaned[5:].strip()
    if (cleaned.startswith('"') and cleaned.endswith('"')) or (cleaned.startswith("'") and cleaned.endswith("'")):
        cleaned = cleaned[1:-1].strip()
    if cleaned.startswith("postgres://"):
        cleaned = "postgresql://" + cleaned[len("postgres://") :]

    try:
        parts = urlsplit(cleaned)
        host = (parts.hostname or "").lower()
        if host.endswith(".neon.tech"):
            query_items = dict(parse_qsl(parts.query, keep_blank_values=True))
            if query_items.get("sslmode", "").lower() not in ("require", "verify-ca", "verify-full"):
                query_items["sslmode"] = "require"
            cleaned = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, urlencode(query_items), parts.fragment)
            )
    except Exception:
        pass
    return cleaned


_RAW_DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("NEON_DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or ""
)
DATABASE_URL = _normalize_database_url(_RAW_DATABASE_URL)

_HAS_POSTGIS_OR_PG_HOST = bool((os.getenv("POSTGIS_HOST") or os.getenv("PGHOST") or "").strip())

if _HAS_POSTGIS_OR_PG_HOST:
    POSTGIS_HOST = (os.getenv("POSTGIS_HOST") or os.getenv("PGHOST") or "").strip()
    POSTGIS_PORT = int((os.getenv("POSTGIS_PORT") or os.getenv("PGPORT") or "5432").strip())
    POSTGIS_DB = (os.getenv("POSTGIS_DB") or os.getenv("PGDATABASE") or "greenmap").strip()
    POSTGIS_USER = (os.getenv("POSTGIS_USER") or os.getenv("PGUSER") or "").strip()
    POSTGIS_PASSWORD = (os.getenv("POSTGIS_PASSWORD") or os.getenv("PGPASSWORD") or "").strip()
else:
    POSTGIS_HOST = (os.getenv("SQL_HOST") or "").strip()
    POSTGIS_PORT = int((os.getenv("SQL_PORT") or "5432").strip())
    POSTGIS_DB = (os.getenv("SQL_DB_NAME") or "greenmap").strip()
    POSTGIS_USER = (os.getenv("SQL_USER") or "").strip()
    POSTGIS_PASSWORD = (os.getenv("SQL_PASSWORD") or "").strip()

POSTGIS_SSLMODE = (os.getenv("POSTGIS_SSLMODE") or os.getenv("PGSSLMODE") or "").strip()
if ".neon.tech" in POSTGIS_HOST.lower() and POSTGIS_SSLMODE.lower() not in ("require", "verify-ca", "verify-full"):
    POSTGIS_SSLMODE = "require"


def get_database_target_info() -> dict[str, object]:
    """Return safe, credential-free database target metadata for diagnostics."""
    env_flags = {
        "DATABASE_URL": bool((os.getenv("DATABASE_URL") or "").strip()),
        "NEON_DATABASE_URL": bool((os.getenv("NEON_DATABASE_URL") or "").strip()),
        "POSTGIS_HOST": bool((os.getenv("POSTGIS_HOST") or "").strip()),
        "POSTGIS_PASSWORD": bool((os.getenv("POSTGIS_PASSWORD") or "").strip()),
        "PGHOST": bool((os.getenv("PGHOST") or "").strip()),
        "PGPASSWORD": bool((os.getenv("PGPASSWORD") or "").strip()),
        "SQL_HOST": bool((os.getenv("SQL_HOST") or "").strip()),
    }
    if DATABASE_URL:
        try:
            parts = urlsplit(DATABASE_URL)
            host = parts.hostname or ""
            dbname = (parts.path or "").lstrip("/") or None
            query = dict(parse_qsl(parts.query, keep_blank_values=True))
            is_neon = ".neon.tech" in host.lower()
            return {
                "target": "neon" if is_neon else "postgresql_url",
                "host": host or None,
                "dbname": dbname,
                "sslmode": query.get("sslmode") or "prefer",
                "neon_configured": is_neon,
                "password_configured": bool(parts.password),
                "env_flags": env_flags,
            }
        except Exception:
            return {
                "target": "postgresql_url",
                "host": None,
                "dbname": None,
                "sslmode": None,
                "neon_configured": False,
                "password_configured": False,
                "env_flags": env_flags,
            }
    if POSTGIS_HOST and POSTGIS_USER:
        is_neon = ".neon.tech" in POSTGIS_HOST.lower()
        return {
            "target": "neon" if is_neon else "postgresql_params",
            "host": POSTGIS_HOST if not POSTGIS_HOST.startswith("/") else "unix_socket",
            "dbname": POSTGIS_DB,
            "sslmode": POSTGIS_SSLMODE or "default",
            "neon_configured": is_neon,
            "password_configured": bool(POSTGIS_PASSWORD),
            "env_flags": env_flags,
        }
    return {
        "target": "local_sqlite",
        "host": "local_filesystem",
        "dbname": LOCAL_DB_PATH.name,
        "sslmode": None,
        "neon_configured": False,
        "password_configured": False,
        "env_flags": env_flags,
    }


LOCAL_DB_PATH = DATA_CACHE_DIR / "greenmap_local.sqlite3"
ADM1_CACHE_PATH = DATA_CACHE_DIR / "india_adm1.geojson"
ADM2_CACHE_PATH = DATA_CACHE_DIR / "india_adm2.geojson"
WRI_INDIA_CACHE_PATH = DATA_CACHE_DIR / "wri_india_renewables.csv"
ML_TRAINING_CACHE_PATH = DATA_CACHE_DIR / "ml_training_samples.parquet"
ML_ARTIFACTS_PATH = DATA_CACHE_DIR / "ml_artifacts.json"
