from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.ahp_engine import DEFAULT_SOLAR_MATRIX, DEFAULT_WIND_MATRIX, compute_ahp


def test_ahp_consistent_solar_and_wind_scenarios() -> None:
    res_solar = compute_ahp(DEFAULT_SOLAR_MATRIX, scenario="solar", persist=False)
    assert res_solar["is_consistent"] is True
    assert res_solar["cr"] < 0.10
    assert abs(sum(res_solar["weights"].values()) - 1.0) < 1e-4

    res_wind = compute_ahp(DEFAULT_WIND_MATRIX, scenario="wind", persist=False)
    assert res_wind["is_consistent"] is True
    assert res_wind["cr"] < 0.10
    assert abs(sum(res_wind["weights"].values()) - 1.0) < 1e-4


def test_ahp_inconsistent_matrix_flagged() -> None:
    # Deliberately intransitive matrix (C1 >> C2, C2 >> C3, C3 >> C1) -> CR >= 0.10
    inconsistent = [
        [1.0, 9.0, 1 / 9, 1.0, 1.0, 1.0],
        [1 / 9, 1.0, 9.0, 1.0, 1.0, 1.0],
        [9.0, 1 / 9, 1.0, 1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    ]
    res = compute_ahp(inconsistent, scenario="solar", persist=False)
    assert res["cr"] >= 0.10
    assert res["is_consistent"] is False
    assert res["warning"] is not None


def test_fastapi_endpoints_end_to_end() -> None:
    client = TestClient(app)

    # Health & Datasets
    h = client.get("/api/v1/health")
    assert h.status_code == 200
    assert h.json()["status"] == "ok"

    ds = client.get("/api/v1/datasets")
    assert ds.status_code == 200
    assert ds.json()["count"] >= 7

    # India States ADM1 & Districts ADM2 (real GeoBoundaries + WRI)
    reg = client.get("/api/v1/regions")
    assert reg.status_code == 200
    assert reg.json()["count"] >= 28

    dist = client.get("/api/v1/districts", params={"state_name": "Rajasthan"})
    assert dist.status_code == 200
    assert dist.json()["count"] >= 20

    # Full 9-step GIS Tile Pipeline on Rajasthan
    tile = client.post("/api/v1/gis/tile", json={"region_id": "in-rj", "grid_size": 6})
    assert tile.status_code == 200
    tdata = tile.json()
    assert len(tdata["pipelineStepsExecuted"]) == 9
    assert len(tdata["solarSuitability"]["classes"]) == 5
    assert len(tdata["windSuitability"]["classes"]) == 5
    assert tdata["solarSuitability"]["suitableLandAreaKm2"] >= 0
    assert len(tdata["suitabilityGeoJson"]["features"]) > 0
    assert tdata["crs"]["projectedMetric"].startswith("EPSG:7755")

    # Solar & Wind analysis endpoints
    sol = client.get("/api/v1/solar/analyze", params={"region_id": "in-rj"})
    assert sol.status_code == 200
    assert len(sol.json()["nasaMonthly"]) == 12

    wnd = client.get("/api/v1/wind/analyze", params={"region_id": "in-gj", "hub_height_m": 120})
    assert wnd.status_code == 200
    assert len(wnd.json()["shearProfile"]) >= 5

    # ML Training (RF + XGBoost + KMeans + Spatial CV + SHAP + AHP vs ML)
    ml = client.post("/api/v1/ml/train", json={"scenario": "hybrid"})
    assert ml.status_code == 200
    mdata = ml.json()
    assert mdata["sample_count"] > 50
    assert 0.0 <= mdata["metrics"]["xgboost"]["meanRocAuc"] <= 1.0
    assert len(mdata["shap"]["globalFeatures"]) == 6
    assert len(mdata["clusters"]) == 4
    assert "pearsonR" in mdata["ahp_comparison"]

    # Comparison & PDF export
    cmp_resp = client.post("/api/v1/compare", json={"region_ids": ["in-rj", "in-gj"]})
    assert cmp_resp.status_code == 200
    assert cmp_resp.json()["count"] == 2

    pdf_resp = client.get("/api/v1/reports/in-rj/pdf")
    assert pdf_resp.status_code == 200
    assert pdf_resp.headers["content-type"] == "application/pdf"
    assert pdf_resp.content[:5] == b"%PDF-"
