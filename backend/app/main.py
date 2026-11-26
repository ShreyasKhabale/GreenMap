from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.app.config import DATA_CACHE_DIR
from backend.app.db.database import DatabaseConnectionError, db
from backend.app.services.ahp_engine import compute_ahp, get_default_ahp
from backend.app.services.data_ingestion import (
    ensure_adm1_gdf,
    ensure_wri_india_df,
    fetch_nasa_power_climatology,
    get_verified_dataset_catalog,
    list_districts_summary,
    list_states_summary,
    resolve_region_geometry,
)
from backend.app.services.gis_pipeline import run_gis_tile_pipeline
from backend.app.services.job_manager import enqueue_async_job
from backend.app.services.ml_engine import explain_region_with_ml, train_and_evaluate_ml
from backend.app.services.pdf_report import generate_region_pdf_bytes

TILE_CACHE_DIR = DATA_CACHE_DIR / "tile_results"
TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="GreenMap India GIS, AHP & ML Analytics API",
    description=(
        "Verified geospatial, Analytical Hierarchy Process (AHP), and machine learning backend "
        "for India-wide renewable energy suitability mapping."
    ),
    version="1.0.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DatabaseConnectionError)
async def database_connection_exception_handler(_request: Request, exc: DatabaseConnectionError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": str(exc),
            "database": db.status(),
        },
    )


class GisTileRequest(BaseModel):
    region_id: str = Field(..., min_length=2, max_length=120)
    solar_weights: dict[str, float] | None = None
    wind_weights: dict[str, float] | None = None
    grid_size: int = Field(default=8, ge=6, le=12)
    max_solar_slope_deg: float = Field(default=10.0, ge=1.0, le=30.0)
    max_wind_slope_deg: float = Field(default=18.0, ge=1.0, le=35.0)
    force_refresh: bool = False


class AhpComputeRequest(BaseModel):
    scenario: str = Field(default="solar")
    matrix: list[list[float]]
    persist: bool = True


class MlTrainRequest(BaseModel):
    scenario: str = Field(default="hybrid")
    force_rebuild: bool = False


class CompareRegionsRequest(BaseModel):
    region_ids: list[str] = Field(..., min_length=2, max_length=4)


def _tile_cache_key(req: GisTileRequest) -> str:
    payload = {
        "region_id": req.region_id,
        "solar_weights": req.solar_weights or get_default_ahp("solar")["weights"],
        "wind_weights": req.wind_weights or get_default_ahp("wind")["weights"],
        "grid_size": req.grid_size,
        "max_solar_slope_deg": req.max_solar_slope_deg,
        "max_wind_slope_deg": req.max_wind_slope_deg,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _get_or_run_tile(req: GisTileRequest) -> dict[str, Any]:
    ckey = _tile_cache_key(req)
    cache_file = TILE_CACHE_DIR / f"{req.region_id}_{ckey}.json"
    if cache_file.exists() and not req.force_refresh:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    result = run_gis_tile_pipeline(
        region_id=req.region_id,
        solar_weights=req.solar_weights,
        wind_weights=req.wind_weights,
        grid_size=req.grid_size,
        max_solar_slope_deg=req.max_solar_slope_deg,
        max_wind_slope_deg=req.max_wind_slope_deg,
    )
    cache_file.write_text(json.dumps(result), encoding="utf-8")
    return result


@app.get("/api/v1/health")
def health() -> JSONResponse:
    db_status = db.ping()
    if db_status.get("postgis_configured") and not db_status.get("postgres_connected"):
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "service": "greenmap-python-gis-ml",
                "error": db_status.get("postgis_error") or "Configured PostgreSQL/Neon connection failed.",
                "database": db_status,
            },
        )
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "service": "greenmap-python-gis-ml",
            "database": db_status,
        },
    )


@app.get("/api/v1/regions")
def get_regions() -> dict[str, Any]:
    try:
        regions = list_states_summary()
        return {"count": len(regions), "regions": regions}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/regions/geojson")
def get_regions_geojson() -> dict[str, Any]:
    try:
        adm1 = ensure_adm1_gdf()
        features = []
        for _, row in adm1.iterrows():
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": row["region_id"],
                        "name": str(row["shapeName"]),
                        "stateCode": row["state_code"],
                        "areaKm2": float(row["area_km2"]),
                    },
                    "geometry": row["geometry"].__geo_interface__,
                }
            )
        return {"type": "FeatureCollection", "features": features}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/districts")
def get_districts(state_name: str | None = Query(default=None)) -> dict[str, Any]:
    try:
        districts = list_districts_summary(state_name=state_name)
        return {"count": len(districts), "stateFilter": state_name, "districts": districts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/datasets")
def get_datasets() -> dict[str, Any]:
    catalog = get_verified_dataset_catalog()
    return {"count": len(catalog), "datasets": catalog}


@app.get("/api/v1/installations")
def get_verified_installations(
    fuel: str | None = Query(default=None),
    state_name: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        wri = ensure_wri_india_df()
        if fuel in ("Solar", "Wind"):
            wri = wri[wri["primary_fuel"] == fuel]
        if state_name:
            wri = wri[wri["state_name"].fillna("").str.lower() == state_name.strip().lower()]

        features = [
            {
                "type": "Feature",
                "properties": {
                    "id": str(r.gppd_idnr),
                    "name": str(r.name),
                    "fuel": str(r.primary_fuel),
                    "capacityMw": float(r.capacity_mw),
                    "stateName": str(getattr(r, "state_name", "") or ""),
                    "districtName": str(getattr(r, "district_name", "") or ""),
                    "commissioningYear": None
                    if getattr(r, "commissioning_year", None) != getattr(r, "commissioning_year", None)
                    else float(r.commissioning_year),
                },
                "geometry": {"type": "Point", "coordinates": [float(r.longitude), float(r.latitude)]},
            }
            for r in wri.itertuples()
        ]
        return {"type": "FeatureCollection", "count": len(features), "features": features}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/gis/tile")
async def process_gis_tile(req: GisTileRequest) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_get_or_run_tile, req)
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/gis/tile/{region_id}")
async def get_gis_tile(region_id: str, grid_size: int = Query(default=8, ge=6, le=12)) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=region_id, grid_size=grid_size))
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/solar/analyze")
async def analyze_solar(region_id: str = Query(default="in-rj")) -> dict[str, Any]:
    try:
        tile = await asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=region_id))
        return {
            "region": tile["region"],
            "solarSuitability": tile["solarSuitability"],
            "resourceSummary": tile["resourceSummary"],
            "nasaMonthly": tile["nasaClimatology"].get("monthly", []),
            "nasaStatus": tile["nasaClimatology"].get("status"),
            "sentinel2Verification": tile["sentinel2Verification"],
            "crs": tile["crs"],
        }
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/wind/analyze")
async def analyze_wind(
    region_id: str = Query(default="in-gj"),
    hub_height_m: int = Query(default=100, ge=50, le=180),
) -> dict[str, Any]:
    try:
        tile = await asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=region_id))
        ann = tile["nasaClimatology"].get("annual") or {}
        ws50 = float(ann.get("ws50mMs", 0.0) or 0.0)
        rho = float(ann.get("airDensityKgM3", 1.18) or 1.18)
        alpha = 0.143
        heights = [50, 80, 100, 120, 150]
        if hub_height_m not in heights:
            heights.append(hub_height_m)
            heights.sort()
        shear_profile = []
        for h in heights:
            vh = ws50 * ((h / 50.0) ** alpha)
            wpd = 0.5 * rho * (vh ** 3)
            shear_profile.append({"heightM": h, "windSpeedMs": round(vh, 2), "wpdWM2": round(wpd, 1)})

        return {
            "region": tile["region"],
            "selectedHubHeightM": hub_height_m,
            "windSuitability": tile["windSuitability"],
            "resourceSummary": tile["resourceSummary"],
            "shearProfile": shear_profile,
            "nasaMonthly": tile["nasaClimatology"].get("monthly", []),
            "nasaStatus": tile["nasaClimatology"].get("status"),
            "crs": tile["crs"],
        }
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/ahp/compute")
def post_ahp_compute(req: AhpComputeRequest) -> dict[str, Any]:
    try:
        return compute_ahp(req.matrix, scenario=req.scenario, persist=req.persist)
    except DatabaseConnectionError:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/ahp/defaults")
def get_ahp_defaults() -> dict[str, Any]:
    return {
        "solar": get_default_ahp("solar"),
        "wind": get_default_ahp("wind"),
    }


@app.get("/api/v1/ahp/history")
def get_ahp_history(limit: int = Query(default=12, ge=1, le=50)) -> dict[str, Any]:
    return {"configs": db.list_ahp_configs(limit=limit)}


@app.post("/api/v1/ml/train")
async def post_ml_train(req: MlTrainRequest) -> dict[str, Any]:
    try:
        return await train_and_evaluate_ml(scenario=req.scenario, force_rebuild=req.force_rebuild)
    except DatabaseConnectionError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/ml/summary")
async def get_ml_summary(scenario: str = Query(default="hybrid")) -> dict[str, Any]:
    latest = db.get_latest_ml_run(scenario=scenario)
    if latest:
        return latest
    try:
        return await train_and_evaluate_ml(scenario=scenario, force_rebuild=False)
    except DatabaseConnectionError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/ml/explain/{region_id}")
async def get_ml_explain_region(region_id: str) -> dict[str, Any]:
    try:
        tile = await asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=region_id))
        reg = tile["region"]
        res = tile["resourceSummary"]
        return await explain_region_with_ml(
            region_id=region_id,
            lat=reg["centroid"][1],
            lon=reg["centroid"][0],
            elev_m=float(res["meanElevationM"]),
            slope_deg=float(res["meanSlopeDeg"]),
            dist_km=float(res["meanDistPowerKm"]),
        )
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/compare")
async def compare_regions(req: CompareRegionsRequest) -> dict[str, Any]:
    try:
        tasks = [
            asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=rid))
            for rid in req.region_ids
        ]
        results = await asyncio.gather(*tasks)
        compared = [
            {
                "region": r["region"],
                "resourceSummary": r["resourceSummary"],
                "solarSuitability": {
                    "suitableLandAreaKm2": r["solarSuitability"]["suitableLandAreaKm2"],
                    "estimatedCapacityGw": r["solarSuitability"]["estimatedCapacityGw"],
                    "meanAhpScore": r["solarSuitability"]["meanAhpScore"],
                    "classes": r["solarSuitability"]["classes"],
                },
                "windSuitability": {
                    "suitableLandAreaKm2": r["windSuitability"]["suitableLandAreaKm2"],
                    "estimatedCapacityGw": r["windSuitability"]["estimatedCapacityGw"],
                    "meanAhpScore": r["windSuitability"]["meanAhpScore"],
                    "classes": r["windSuitability"]["classes"],
                },
                "sentinel2MatchedScenes": r["sentinel2Verification"].get("matchedScenes", 0),
                "osmCounts": r["osmInfrastructure"].get("counts", {}),
            }
            for r in results
        ]
        return {"count": len(compared), "comparisons": compared}
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/reports/{region_id}/pdf")
async def download_region_pdf(region_id: str) -> Response:
    try:
        tile = await asyncio.to_thread(_get_or_run_tile, GisTileRequest(region_id=region_id))
        ahp_history = db.list_ahp_configs(limit=20)
        ahp_solar = next((c for c in ahp_history if c["scenario"] == "solar"), None) or get_default_ahp("solar")
        ahp_wind = next((c for c in ahp_history if c["scenario"] == "wind"), None) or get_default_ahp("wind")
        ml_run = db.get_latest_ml_run(scenario="hybrid")
        pdf_bytes = generate_region_pdf_bytes(tile, ahp_solar, ahp_wind, ml_run)
        safe_name = region_id.replace("/", "_")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="greenmap-{safe_name}-report.pdf"'},
        )
    except DatabaseConnectionError:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/jobs/gis-tile")
async def enqueue_gis_job(req: GisTileRequest) -> dict[str, Any]:
    # Verify region exists before queuing
    try:
        resolve_region_geometry(req.region_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    job = enqueue_async_job(
        job_type="gis_tile_pipeline",
        region_id=req.region_id,
        config=req.model_dump(),
        runner=lambda: asyncio.to_thread(_get_or_run_tile, req),
    )
    return job


@app.post("/api/v1/jobs/ml-train")
async def enqueue_ml_job(req: MlTrainRequest) -> dict[str, Any]:
    job = enqueue_async_job(
        job_type=f"ml_spatial_cv_{req.scenario}",
        region_id="in-national",
        config=req.model_dump(),
        runner=lambda: train_and_evaluate_ml(scenario=req.scenario, force_rebuild=req.force_rebuild),
    )
    return job


@app.get("/api/v1/jobs")
def list_jobs(limit: int = Query(default=25, ge=1, le=100)) -> dict[str, Any]:
    return {"jobs": db.list_jobs(limit=limit)}


@app.get("/api/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job
