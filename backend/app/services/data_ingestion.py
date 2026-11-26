from __future__ import annotations

import asyncio
import hashlib
import json
import math
import unicodedata
from typing import Any

import geopandas as gpd
import httpx
import numpy as np
import pandas as pd
from shapely.geometry import Point, box

from backend.app.config import (
    ADM1_CACHE_PATH,
    ADM2_CACHE_PATH,
    DATA_CACHE_DIR,
    WRI_INDIA_CACHE_PATH,
)
from backend.app.db.database import db

GEOBOUNDARIES_ADM1_META = "https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/"
GEOBOUNDARIES_ADM2_META = "https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/"
WRI_GPPD_URL = (
    "https://raw.githubusercontent.com/wri/global-power-plant-database/"
    "master/output_database/global_power_plant_database.csv"
)
NASA_POWER_CLIM_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
OPENTOPODATA_SRTM_URL = "https://api.opentopodata.org/v1/srtm30m"
ELEMENT84_STAC_URL = "https://earth-search.aws.element84.com/v1/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
OSM_CACHE_DIR = DATA_CACHE_DIR / "osm_cache"
OSM_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Institutional MNRE / NIWE published macro reference baselines (distinct from computed tile GIS outputs)
MNRE_NIWE_STATE_BASELINES: dict[str, dict[str, Any]] = {
    "Rajasthan": {"id": "in-rj", "code": "RJ", "solar_gw": 142.31, "wind_gw": 18.77, "focus": "solar"},
    "Gujarat": {"id": "in-gj", "code": "GJ", "solar_gw": 35.77, "wind_gw": 142.56, "focus": "hybrid"},
    "Tamil Nadu": {"id": "in-tn", "code": "TN", "solar_gw": 17.67, "wind_gw": 68.75, "focus": "wind"},
    "Karnataka": {"id": "in-ka", "code": "KA", "solar_gw": 24.70, "wind_gw": 124.15, "focus": "hybrid"},
    "Maharashtra": {"id": "in-mh", "code": "MH", "solar_gw": 64.32, "wind_gw": 98.21, "focus": "hybrid"},
    "Andhra Pradesh": {"id": "in-ap", "code": "AP", "solar_gw": 38.44, "wind_gw": 74.90, "focus": "hybrid"},
    "Madhya Pradesh": {"id": "in-mp", "code": "MP", "solar_gw": 61.66, "wind_gw": 15.40, "focus": "solar"},
    "Ladakh": {"id": "in-la", "code": "LA", "solar_gw": 35.00, "wind_gw": None, "focus": "solar"},
    "Telangana": {"id": "in-tg", "code": "TG", "solar_gw": 20.41, "wind_gw": 24.83, "focus": "solar"},
    "Jammu and Kashmir": {"id": "in-jk", "code": "JK", "solar_gw": 111.05, "wind_gw": None, "focus": "solar"},
    "Uttar Pradesh": {"id": "in-up", "code": "UP", "solar_gw": 22.83, "wind_gw": None, "focus": "solar"},
    "Odisha": {"id": "in-od", "code": "OD", "solar_gw": 25.78, "wind_gw": 12.12, "focus": "hybrid"},
}


def _normalize_name(value: str) -> str:
    nfkd = unicodedata.normalize("NFKD", value)
    ascii_str = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return " ".join(ascii_str.strip().split())


def _slugify(value: str) -> str:
    value = _normalize_name(value)
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")


def _download_geoboundaries(meta_url: str, target_path: Any) -> gpd.GeoDataFrame:
    if target_path.exists():
        return gpd.read_file(target_path)

    with httpx.Client(timeout=45.0, follow_redirects=True) as client:
        meta_resp = client.get(meta_url)
        meta_resp.raise_for_status()
        meta = meta_resp.json()
        geojson_url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
        if not geojson_url:
            raise RuntimeError(f"GeoBoundaries metadata did not include a GeoJSON download URL for {meta_url}")
        gj_resp = client.get(geojson_url)
        gj_resp.raise_for_status()
        target_path.write_bytes(gj_resp.content)

    return gpd.read_file(target_path)


def ensure_adm1_gdf() -> gpd.GeoDataFrame:
    gdf = _download_geoboundaries(GEOBOUNDARIES_ADM1_META, ADM1_CACHE_PATH)
    gdf = gdf.to_crs("EPSG:4326")
    # Compute accurate projected area using EPSG:7755 (WGS 84 / India NSF LCC)
    proj = gdf.to_crs("EPSG:7755")
    gdf["area_km2"] = (proj.geometry.area / 1e6).round(2)
    centroids_4326 = proj.geometry.centroid.to_crs("EPSG:4326")
    gdf["centroid_lon"] = centroids_4326.x.round(4)
    gdf["centroid_lat"] = centroids_4326.y.round(4)

    bounds = gdf.geometry.bounds
    gdf["bbox"] = [
        [round(float(r.minx), 4), round(float(r.miny), 4), round(float(r.maxx), 4), round(float(r.maxy), 4)]
        for r in bounds.itertuples()
    ]

    ids: list[str] = []
    codes: list[str] = []
    clean_names: list[str] = []
    for _, row in gdf.iterrows():
        raw_name = str(row.get("shapeName", "")).strip()
        norm_name = _normalize_name(raw_name)
        baseline = MNRE_NIWE_STATE_BASELINES.get(norm_name)
        clean_names.append(norm_name)
        if baseline:
            ids.append(baseline["id"])
            codes.append(baseline["code"])
        else:
            iso = str(row.get("shapeISO", "") or "").replace("IN-", "")
            ids.append(f"in-{_slugify(norm_name)}")
            codes.append(iso[:3].upper() if iso else _slugify(norm_name)[:3].upper())
    gdf["shapeName"] = clean_names
    gdf["region_id"] = ids
    gdf["state_code"] = codes
    return gdf


def ensure_adm2_gdf() -> gpd.GeoDataFrame:
    gdf = _download_geoboundaries(GEOBOUNDARIES_ADM2_META, ADM2_CACHE_PATH)
    gdf = gdf.to_crs("EPSG:4326")
    proj = gdf.to_crs("EPSG:7755")
    gdf["area_km2"] = (proj.geometry.area / 1e6).round(2)
    centroids_4326 = proj.geometry.centroid.to_crs("EPSG:4326")
    gdf["centroid_lon"] = centroids_4326.x.round(4)
    gdf["centroid_lat"] = centroids_4326.y.round(4)
    bounds = gdf.geometry.bounds
    gdf["bbox"] = [
        [round(float(r.minx), 4), round(float(r.miny), 4), round(float(r.maxx), 4), round(float(r.maxy), 4)]
        for r in bounds.itertuples()
    ]

    # Spatial join with ADM1 to attach parent state name
    adm1 = ensure_adm1_gdf()[["region_id", "shapeName", "geometry"]].rename(
        columns={"region_id": "state_region_id", "shapeName": "parent_state"}
    )
    centroid_gdf = gpd.GeoDataFrame(
        gdf[["shapeID", "shapeName"]].copy(),
        geometry=centroids_4326,
        crs="EPSG:4326",
    )
    joined = gpd.sjoin(centroid_gdf, adm1, how="left", predicate="within")
    joined = joined.drop_duplicates(subset=["shapeID"])
    state_map = dict(zip(joined["shapeID"], joined["parent_state"]))
    state_id_map = dict(zip(joined["shapeID"], joined["state_region_id"]))

    gdf["shapeName"] = [_normalize_name(str(v)) for v in gdf["shapeName"]]
    gdf["parent_state"] = gdf["shapeID"].map(state_map).fillna("India")
    gdf["state_region_id"] = gdf["shapeID"].map(state_id_map).fillna("in-india")
    gdf["district_id"] = [
        f"dist-{_slugify(str(r.parent_state))}-{_slugify(str(r.shapeName))}"
        for r in gdf.itertuples()
    ]
    return gdf


def ensure_wri_india_df() -> pd.DataFrame:
    if WRI_INDIA_CACHE_PATH.exists():
        return pd.read_csv(WRI_INDIA_CACHE_PATH)

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        resp = client.get(WRI_GPPD_URL)
        resp.raise_for_status()
        raw_df = pd.read_csv(pd.io.common.BytesIO(resp.content), low_memory=False)

    ind_df = raw_df[
        (raw_df["country"] == "IND") & (raw_df["primary_fuel"].isin(["Solar", "Wind"]))
    ][
        [
            "gppd_idnr",
            "name",
            "capacity_mw",
            "latitude",
            "longitude",
            "primary_fuel",
            "commissioning_year",
            "source",
        ]
    ].dropna(subset=["latitude", "longitude", "capacity_mw"]).copy()

    # Spatial join with ADM1 & ADM2 to enrich verified plants with Indian state & district
    pts = gpd.GeoDataFrame(
        ind_df,
        geometry=gpd.points_from_xy(ind_df["longitude"], ind_df["latitude"]),
        crs="EPSG:4326",
    )
    adm1 = ensure_adm1_gdf()[["region_id", "shapeName", "geometry"]].rename(
        columns={"region_id": "state_region_id", "shapeName": "state_name"}
    )
    joined_s = gpd.sjoin(pts, adm1, how="left", predicate="within").drop(columns=["index_right"], errors="ignore")
    joined_s = joined_s.drop_duplicates(subset=["gppd_idnr"])

    adm2 = ensure_adm2_gdf()[["district_id", "shapeName", "geometry"]].rename(
        columns={"shapeName": "district_name"}
    )
    joined_d = gpd.sjoin(joined_s, adm2, how="left", predicate="within").drop(columns=["index_right"], errors="ignore")
    joined_d = joined_d.drop_duplicates(subset=["gppd_idnr"])

    out_df = pd.DataFrame(joined_d.drop(columns=["geometry"]))
    out_df.to_csv(WRI_INDIA_CACHE_PATH, index=False)
    return out_df


def list_states_summary() -> list[dict[str, Any]]:
    adm1 = ensure_adm1_gdf()
    wri = ensure_wri_india_df()

    plant_stats = (
        wri.groupby(["state_name", "primary_fuel"])["capacity_mw"]
        .agg(["count", "sum"])
        .reset_index()
    )

    records: list[dict[str, Any]] = []
    for _, row in adm1.iterrows():
        name = str(row["shapeName"])
        baseline = MNRE_NIWE_STATE_BASELINES.get(name, {})
        sub_stats = plant_stats[plant_stats["state_name"] == name]
        solar_row = sub_stats[sub_stats["primary_fuel"] == "Solar"]
        wind_row = sub_stats[sub_stats["primary_fuel"] == "Wind"]
        solar_count = int(solar_row["count"].iloc[0]) if len(solar_row) else 0
        solar_mw = round(float(solar_row["sum"].iloc[0]), 2) if len(solar_row) else 0.0
        wind_count = int(wind_row["count"].iloc[0]) if len(wind_row) else 0
        wind_mw = round(float(wind_row["sum"].iloc[0]), 2) if len(wind_row) else 0.0

        records.append(
            {
                "id": row["region_id"],
                "name": name,
                "stateCode": row["state_code"],
                "admLevel": "ADM1",
                "areaKm2": float(row["area_km2"]),
                "centroid": [float(row["centroid_lon"]), float(row["centroid_lat"])],
                "bbox": row["bbox"],
                "focus": baseline.get("focus", "hybrid"),
                "publishedSolarPotentialGw": baseline.get("solar_gw"),
                "publishedWindPotentialGw": baseline.get("wind_gw"),
                "wriVerifiedInstallations": {
                    "solarCount": solar_count,
                    "solarCapacityMw": solar_mw,
                    "windCount": wind_count,
                    "windCapacityMw": wind_mw,
                },
            }
        )
    # Sort major MNRE states first, then alphabetically
    records.sort(
        key=lambda r: (
            0 if r["name"] in MNRE_NIWE_STATE_BASELINES else 1,
            r["name"],
        )
    )
    return records


def list_districts_summary(state_name: str | None = None) -> list[dict[str, Any]]:
    adm2 = ensure_adm2_gdf()
    wri = ensure_wri_india_df()

    if state_name:
        target = _normalize_name(state_name).lower()
        adm2 = adm2[adm2["parent_state"].str.lower() == target]

    plant_stats = (
        wri.groupby(["district_name", "primary_fuel"])["capacity_mw"]
        .agg(["count", "sum"])
        .reset_index()
    )

    records: list[dict[str, Any]] = []
    for _, row in adm2.iterrows():
        dname = str(row["shapeName"])
        sub_stats = plant_stats[plant_stats["district_name"] == dname]
        solar_row = sub_stats[sub_stats["primary_fuel"] == "Solar"]
        wind_row = sub_stats[sub_stats["primary_fuel"] == "Wind"]
        records.append(
            {
                "id": row["district_id"],
                "name": dname,
                "parentState": row["parent_state"],
                "stateRegionId": row["state_region_id"],
                "admLevel": "ADM2",
                "areaKm2": float(row["area_km2"]),
                "centroid": [float(row["centroid_lon"]), float(row["centroid_lat"])],
                "bbox": row["bbox"],
                "wriSolarPlants": int(solar_row["count"].iloc[0]) if len(solar_row) else 0,
                "wriSolarMw": round(float(solar_row["sum"].iloc[0]), 2) if len(solar_row) else 0.0,
                "wriWindPlants": int(wind_row["count"].iloc[0]) if len(wind_row) else 0,
                "wriWindMw": round(float(wind_row["sum"].iloc[0]), 2) if len(wind_row) else 0.0,
            }
        )
    records.sort(key=lambda r: (r["parentState"], r["name"]))
    return records


def resolve_region_geometry(region_id: str) -> dict[str, Any]:
    adm1 = ensure_adm1_gdf()
    match1 = adm1[adm1["region_id"] == region_id]
    if len(match1):
        row = match1.iloc[0]
        return {
            "id": row["region_id"],
            "name": str(row["shapeName"]),
            "adm_level": "ADM1",
            "parent_state": str(row["shapeName"]),
            "area_km2": float(row["area_km2"]),
            "centroid": [float(row["centroid_lon"]), float(row["centroid_lat"])],
            "bbox": row["bbox"],
            "geometry": row["geometry"],
        }

    adm2 = ensure_adm2_gdf()
    match2 = adm2[adm2["district_id"] == region_id]
    if len(match2):
        row = match2.iloc[0]
        return {
            "id": row["district_id"],
            "name": str(row["shapeName"]),
            "adm_level": "ADM2",
            "parent_state": str(row["parent_state"]),
            "area_km2": float(row["area_km2"]),
            "centroid": [float(row["centroid_lon"]), float(row["centroid_lat"])],
            "bbox": row["bbox"],
            "geometry": row["geometry"],
        }

    raise KeyError(f"Region ID '{region_id}' not found in India ADM1 or ADM2 boundaries.")


def _parse_nasa_payload(lat: float, lon: float, raw_json: dict[str, Any], elevation_m: float = 250.0) -> dict[str, Any]:
    params = raw_json.get("properties", {}).get("parameter", {})
    ghi_m = params.get("ALLSKY_SFC_SW_DWN", {})
    dni_m = params.get("ALLSKY_SFC_SW_DNI", {})
    ws50_m = params.get("WS50M", {})
    t2m_m = params.get("T2M", {})
    precip_m = params.get("PRECTOTCORR", {})

    monthly = []
    for m in MONTH_KEYS:
        ghi_val = float(ghi_m.get(m, 0.0) or 0.0)
        dni_val = float(dni_m.get(m, 0.0) or 0.0)
        ws50_val = float(ws50_m.get(m, 0.0) or 0.0)
        t2m_val = float(t2m_m.get(m, 25.0) or 25.0)
        precip_val = float(precip_m.get(m, 0.0) or 0.0)

        # Hellmann wind shear extrapolation from 50m -> 100m & 120m (alpha=0.143 open terrain)
        alpha = 0.143
        ws100 = ws50_val * ((100.0 / 50.0) ** alpha)
        ws120 = ws50_val * ((120.0 / 50.0) ** alpha)

        # Air density adjusted for elevation and monthly air temperature
        temp_k = t2m_val + 273.15
        rho = 1.225 * math.exp(-elevation_m / 8500.0) * (288.15 / temp_k)
        wpd_100 = 0.5 * rho * (ws100 ** 3)

        # Temperature-derated daily PV yield (kWh/kWp/day) using standard NOCT=45°C, gamma=-0.004/°C, PR=0.80
        t_cell = t2m_val + 18.0
        temp_factor = max(0.75, 1.0 - 0.004 * max(0.0, t_cell - 25.0))
        pv_daily = ghi_val * 0.80 * temp_factor

        monthly.append(
            {
                "month": m,
                "ghi": round(ghi_val, 2),
                "dni": round(dni_val, 2),
                "ws50m": round(ws50_val, 2),
                "ws100m": round(ws100, 2),
                "ws120m": round(ws120, 2),
                "wpd100m": round(wpd_100, 1),
                "t2m": round(t2m_val, 1),
                "precipMmDay": round(precip_val, 2),
                "pvDailyKwhKwp": round(pv_daily, 2),
            }
        )

    ann_ghi = float(ghi_m.get("ANN") or np.mean([x["ghi"] for x in monthly]))
    ann_dni = float(dni_m.get("ANN") or np.mean([x["dni"] for x in monthly]))
    ann_ws50 = float(ws50_m.get("ANN") or np.mean([x["ws50m"] for x in monthly]))
    ann_t2m = float(t2m_m.get("ANN") or np.mean([x["t2m"] for x in monthly]))
    ann_ws100 = ann_ws50 * ((100.0 / 50.0) ** 0.143)
    ann_ws120 = ann_ws50 * ((120.0 / 50.0) ** 0.143)
    rho_ann = 1.225 * math.exp(-elevation_m / 8500.0) * (288.15 / (ann_t2m + 273.15))
    ann_wpd100 = 0.5 * rho_ann * (ann_ws100 ** 3)
    ann_pv_yield = sum(x["pvDailyKwhKwp"] * days for x, days in zip(monthly, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]))

    return {
        "status": "ok",
        "source": "NASA POWER Climatology API (1984–2020 RE Community)",
        "coordinates": {"lat": round(lat, 4), "lon": round(lon, 4)},
        "annual": {
            "ghiKwhM2Day": round(ann_ghi, 3),
            "dniKwhM2Day": round(ann_dni, 3),
            "ws50mMs": round(ann_ws50, 3),
            "ws100mMs": round(ann_ws100, 3),
            "ws120mMs": round(ann_ws120, 3),
            "wpd100mWM2": round(ann_wpd100, 2),
            "t2mC": round(ann_t2m, 2),
            "airDensityKgM3": round(rho_ann, 3),
            "pvSpecificYieldKwhKwpYr": round(ann_pv_yield, 1),
        },
        "monthly": monthly,
    }


def fetch_nasa_power_climatology(lat: float, lon: float, elevation_m: float = 250.0) -> dict[str, Any]:
    cache_key = f"nasa:{lat:.2f}:{lon:.2f}"
    cached = db.get_nasa_cache(cache_key)
    if cached:
        return _parse_nasa_payload(lat, lon, cached, elevation_m=elevation_m)

    params = {
        "parameters": "ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,WS50M,T2M,PRECTOTCORR",
        "community": "RE",
        "longitude": round(lon, 4),
        "latitude": round(lat, 4),
        "format": "JSON",
    }
    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.get(NASA_POWER_CLIM_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        db.set_nasa_cache(cache_key, lat, lon, data)
        return _parse_nasa_payload(lat, lon, data, elevation_m=elevation_m)
    except Exception as exc:
        return {
            "status": "unavailable",
            "source": "NASA POWER Climatology API",
            "error": str(exc),
            "coordinates": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "annual": None,
            "monthly": [],
        }


async def fetch_nasa_power_batch_async(points: list[tuple[float, float]]) -> dict[tuple[float, float], dict[str, Any]]:
    results: dict[tuple[float, float], dict[str, Any]] = {}
    to_fetch: list[tuple[float, float, str]] = []

    for lat, lon in points:
        key = f"nasa:{lat:.2f}:{lon:.2f}"
        cached = db.get_nasa_cache(key)
        if cached:
            results[(lat, lon)] = _parse_nasa_payload(lat, lon, cached)
        else:
            to_fetch.append((lat, lon, key))

    if not to_fetch:
        return results

    sem = asyncio.Semaphore(4)
    fetched_pairs: list[tuple[float, float, str, dict[str, Any]]] = []

    async def _one(client: httpx.AsyncClient, lat: float, lon: float, key: str) -> None:
        async with sem:
            try:
                resp = await client.get(
                    NASA_POWER_CLIM_URL,
                    params={
                        "parameters": "ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,WS50M,T2M,PRECTOTCORR",
                        "community": "RE",
                        "longitude": round(lon, 4),
                        "latitude": round(lat, 4),
                        "format": "JSON",
                    },
                )
                if resp.status_code == 200:
                    payload = resp.json()
                    fetched_pairs.append((lat, lon, key, payload))
            except Exception:
                pass

    async with httpx.AsyncClient(timeout=15.0) as client:
        await asyncio.gather(*[_one(client, lat, lon, key) for lat, lon, key in to_fetch])

    for lat, lon, key, payload in fetched_pairs:
        db.set_nasa_cache(key, lat, lon, payload)
        results[(lat, lon)] = _parse_nasa_payload(lat, lon, payload)

    return results


def fetch_srtm_elevations(coords: list[tuple[float, float]]) -> list[float | None]:
    """
    Fetch real 30m SRTM elevation values in batches of up to 100 points via OpenTopoData.
    Never invents fake elevations on error; returns None for failed samples.
    """
    if not coords:
        return []

    elevations: list[float | None] = [None] * len(coords)
    missing_indices: list[int] = []

    for idx, (lat, lon) in enumerate(coords):
        ckey = f"srtm:{lat:.4f}:{lon:.4f}"
        cached = db.get_srtm_cache(ckey)
        if cached is not None and "elevation" in cached:
            elevations[idx] = cached["elevation"]
        else:
            missing_indices.append(idx)

    if not missing_indices:
        return elevations

    with httpx.Client(timeout=25.0) as client:
        for start in range(0, len(missing_indices), 100):
            batch_idxs = missing_indices[start : start + 100]
            loc_str = "|".join(f"{coords[i][0]:.5f},{coords[i][1]:.5f}" for i in batch_idxs)
            try:
                resp = client.get(OPENTOPODATA_SRTM_URL, params={"locations": loc_str})
                if resp.status_code == 200:
                    rows = resp.json().get("results", [])
                    for idx, item in zip(batch_idxs, rows):
                        val = item.get("elevation")
                        elev_f = float(val) if val is not None else None
                        elevations[idx] = elev_f
                        lat, lon = coords[idx]
                        db.set_srtm_cache(f"srtm:{lat:.4f}:{lon:.4f}", {"elevation": elev_f})
            except Exception:
                continue

    return elevations


def fetch_sentinel2_stac_metadata(bbox: list[float]) -> dict[str, Any]:
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": bbox,
        "limit": 5,
        "query": {"eo:cloud_cover": {"lt": 25}},
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(ELEMENT84_STAC_URL, json=body)
            resp.raise_for_status()
            payload = resp.json()
        features = payload.get("features", [])
        scenes = [
            {
                "id": f.get("id"),
                "datetime": f.get("properties", {}).get("datetime"),
                "cloudCoverPct": f.get("properties", {}).get("eo:cloud_cover"),
                "platform": f.get("properties", {}).get("platform"),
            }
            for f in features[:5]
        ]
        matched = payload.get("numberMatched") or payload.get("context", {}).get("matched") or len(scenes)
        return {
            "status": "ok",
            "collection": "sentinel-2-l2a",
            "matchedScenes": int(matched),
            "sampleScenes": scenes,
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "collection": "sentinel-2-l2a",
            "matchedScenes": 0,
            "sampleScenes": [],
            "error": str(exc),
        }


def fetch_osm_overpass_features(bbox: list[float]) -> dict[str, Any]:
    """
    Query real OSM Overpass API for HV substations/lines, major highways, water bodies,
    and protected areas within a bounded regional tile window (capped to ~1.2 deg span).
    """
    minx, miny, maxx, maxy = bbox
    cx = (minx + maxx) / 2.0
    cy = (miny + maxy) / 2.0
    half_lon = min(0.6, max(0.15, (maxx - minx) / 2.0))
    half_lat = min(0.6, max(0.15, (maxy - miny) / 2.0))
    s, w, n, e = round(cy - half_lat, 3), round(cx - half_lon, 3), round(cy + half_lat, 3), round(cx + half_lon, 3)

    cache_hash = hashlib.md5(f"{s}:{w}:{n}:{e}".encode()).hexdigest()
    cache_file = OSM_CACHE_DIR / f"{cache_hash}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    query = f"""
    [out:json][timeout:18];
    (
      node["power"="substation"]({s},{w},{n},{e});
      way["power"="substation"]({s},{w},{n},{e});
      way["highway"~"motorway|trunk|primary"]({s},{w},{n},{e});
      way["natural"="water"]({s},{w},{n},{e});
      relation["boundary"~"protected_area|national_park"]({s},{w},{n},{e});
    );
    out center 250;
    """
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(OVERPASS_URL, data={"data": query})
            if resp.status_code == 429:
                return {"status": "rate_limited", "power_points": [], "road_points": [], "exclusion_boxes": []}
            resp.raise_for_status()
            data = resp.json()

        power_points: list[tuple[float, float]] = []
        road_points: list[tuple[float, float]] = []
        exclusion_boxes: list[list[float]] = []

        for el in data.get("elements", []):
            tags = el.get("tags", {})
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None or lon is None:
                continue
            if tags.get("power") == "substation":
                power_points.append((float(lon), float(lat)))
            elif "highway" in tags:
                road_points.append((float(lon), float(lat)))
            elif tags.get("natural") == "water" or "boundary" in tags:
                # 1.5km approximate exclusion buffer box around identified feature center
                exclusion_boxes.append([float(lon) - 0.015, float(lat) - 0.015, float(lon) + 0.015, float(lat) + 0.015])

        result = {
            "status": "ok",
            "queryBbox": [w, s, e, n],
            "power_points": power_points,
            "road_points": road_points,
            "exclusion_boxes": exclusion_boxes,
            "counts": {
                "substations": len(power_points),
                "highwayNodes": len(road_points),
                "exclusionFeatures": len(exclusion_boxes),
            },
        }
        cache_file.write_text(json.dumps(result), encoding="utf-8")
        return result
    except Exception as exc:
        return {
            "status": "unavailable",
            "error": str(exc),
            "power_points": [],
            "road_points": [],
            "exclusion_boxes": [],
            "counts": {"substations": 0, "highwayNodes": 0, "exclusionFeatures": 0},
        }


def get_verified_dataset_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": "ds-nasa-power",
            "name": "NASA POWER Renewable Energy Climatology",
            "provider": "NASA Langley Research Center",
            "spatialResolution": "0.5° × 0.625° (MERRA-2 / CERES)",
            "temporalCoverage": "1984 – 2020 Long-Term Climatology",
            "parameters": ["ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "WS50M", "T2M", "PRECTOTCORR"],
            "format": "REST JSON",
            "integrationEndpoint": "https://power.larc.nasa.gov/api/temporal/climatology/point",
            "licenseType": "Public Domain (NASA Open Data)",
            "limitations": "Coarse 0.5° (~55 km) horizontal resolution smooths micro-scale ridge winds and local valley shading.",
            "status": "Connected (Live Cached API)",
        },
        {
            "id": "ds-gsa",
            "name": "Global Solar Atlas (Solargis Methodology)",
            "provider": "World Bank / ESMAP / Solargis",
            "spatialResolution": "250m (9 arc-seconds)",
            "temporalCoverage": "1999 – 2018 Multi-Year Mean",
            "parameters": ["GHI", "DNI", "PVOUT", "OPTA"],
            "format": "Cloud Optimized GeoTIFF (COG) / Tile Output",
            "integrationEndpoint": "/api/v1/gis/tile (Derived PVOUT & GHI GeoTIFF)",
            "licenseType": "CC BY 4.0",
            "limitations": "High-resolution 250m global Solargis COGs require local GeoTIFF ingest; tile API falls back to NASA POWER + SRTM terrain derating.",
            "status": "Methodology Integrated",
        },
        {
            "id": "ds-gwa-niwe",
            "name": "Global Wind Atlas / NIWE Hub-Height Model",
            "provider": "DTU Wind Energy / World Bank / NIWE",
            "spatialResolution": "250m microscale; 50m–150m Hellmann Shear",
            "temporalCoverage": "Multi-Year Mesoscale–Microscale Baseline",
            "parameters": ["Wind Speed (80m/100m/120m/150m)", "Wind Power Density (W/m²)", "Air Density"],
            "format": "GeoTIFF / Computed Tile Grid",
            "integrationEndpoint": "/api/v1/wind/analyze",
            "licenseType": "CC BY 4.0 / Academic Reference",
            "limitations": "Power-law shear extrapolation (alpha=0.143) assumes neutral atmospheric stability; complex Western Ghats passes require CFD mast calibration.",
            "status": "Connected (Physical Shear Model)",
        },
        {
            "id": "ds-srtm",
            "name": "SRTM 30m Digital Elevation Model",
            "provider": "NASA / USGS via OpenTopoData",
            "spatialResolution": "1 arc-second (~30m)",
            "temporalCoverage": "Static Topographic Baseline (2000)",
            "parameters": ["Elevation (m)", "Slope (°)", "Aspect (°)"],
            "format": "REST Batch & GeoTIFF Export",
            "integrationEndpoint": "https://api.opentopodata.org/v1/srtm30m",
            "licenseType": "Public Domain (USGS)",
            "limitations": "Radar reflective surface can include dense canopy height; batch API rate limits cap per-tile sampling resolution.",
            "status": "Connected (Live Cached API)",
        },
        {
            "id": "ds-sentinel2",
            "name": "Copernicus Sentinel-2 L2A STAC Catalog",
            "provider": "ESA / Copernicus via Element84 Earth Search",
            "spatialResolution": "10m – 20m Multispectral",
            "temporalCoverage": "2017 – Present",
            "parameters": ["Scene Count", "Cloud Cover %", "Footprint Metadata"],
            "format": "STAC GeoJSON",
            "integrationEndpoint": "https://earth-search.aws.element84.com/v1/search",
            "licenseType": "Copernicus Open Access",
            "limitations": "Queries verify optical land-cover scene availability & cloud fraction; full 10m pixel LULC classification requires COG band streaming.",
            "status": "Connected (Live STAC Metadata)",
        },
        {
            "id": "ds-osm",
            "name": "OpenStreetMap Infrastructure & Exclusions",
            "provider": "OpenStreetMap Contributors (Overpass API)",
            "spatialResolution": "Vector Nodes, Ways & Relations",
            "temporalCoverage": "Live Crowd-Mapped Snapshot",
            "parameters": ["power=substation", "highway=motorway/trunk/primary", "natural=water", "boundary=protected_area"],
            "format": "Overpass JSON / Shapely Geometries",
            "integrationEndpoint": "https://overpass-api.de/api/interpreter",
            "licenseType": "ODbL 1.0",
            "limitations": "Rural substation and protected boundary completeness varies by district; subject to Overpass public API rate limits.",
            "status": "Connected (Bounded Tile Query)",
        },
        {
            "id": "ds-wri-gppd",
            "name": "WRI Global Power Plant Database (India)",
            "provider": "World Resources Institute",
            "spatialResolution": "Point Coordinates + MW Capacity",
            "temporalCoverage": "v1.3.0 Verified Installations",
            "parameters": ["primary_fuel (Solar/Wind)", "capacity_mw", "latitude", "longitude", "commissioning_year"],
            "format": "CSV + PostGIS Point Geometry",
            "integrationEndpoint": "/api/v1/ml/train (Ground-Truth Labels)",
            "licenseType": "CC BY 4.0",
            "limitations": "Captures utility-scale plants cataloged up to v1.3.0; newer ultra-mega solar parks may not yet appear in WRI v1.3.0.",
            "status": "Connected (Ground-Truth ML Labels)",
        },
        {
            "id": "ds-geoboundaries",
            "name": "geoBoundaries India ADM1 & ADM2",
            "provider": "William & Mary geoLab",
            "spatialResolution": "36 States/UTs (ADM1) & 700+ Districts (ADM2)",
            "temporalCoverage": "gbOpen Current Release",
            "parameters": ["Polygon Boundaries", "EPSG:7755 Projected Area (km²)", "Centroids"],
            "format": "GeoJSON / GeoPandas",
            "integrationEndpoint": "/api/v1/regions & /api/v1/districts",
            "licenseType": "CC BY 4.0",
            "limitations": "Simplified open administrative polygons may differ slightly from Survey of India cadastral demarcations.",
            "status": "Connected (Cached National Vector)",
        },
    ]
