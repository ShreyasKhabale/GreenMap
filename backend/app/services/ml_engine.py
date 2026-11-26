from __future__ import annotations

import asyncio
import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import shap
from pyproj import Transformer
from scipy.stats import pearsonr, spearmanr
from shapely.geometry import Point
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from backend.app.config import ML_ARTIFACTS_PATH, ML_TRAINING_CACHE_PATH
from backend.app.db.database import db
from backend.app.services.ahp_engine import get_default_ahp
from backend.app.services.data_ingestion import (
    ensure_adm1_gdf,
    ensure_wri_india_df,
    fetch_nasa_power_batch_async,
    fetch_nasa_power_climatology,
    fetch_srtm_elevations,
)

FEATURE_COLS = [
    "ghi_kwh_m2_day",
    "ws100m_ms",
    "t2m_c",
    "elevation_m",
    "slope_deg",
    "dist_infra_km",
]

FEATURE_LABELS = {
    "ghi_kwh_m2_day": "Solar GHI (kWh/m²/day)",
    "ws100m_ms": "Wind Speed 100m (m/s)",
    "t2m_c": "Ambient Temperature (°C)",
    "elevation_m": "SRTM Elevation (m)",
    "slope_deg": "Terrain Slope (°)",
    "dist_infra_km": "Grid / Corridor Distance (km)",
}


def _nearest_nasa_value(lat: float, lon: float, nasa_grid: dict[tuple[float, float], dict[str, Any]]) -> dict[str, float]:
    best_key = min(
        nasa_grid.keys(),
        key=lambda k: (k[0] - lat) ** 2 + (k[1] - lon) ** 2,
    )
    ann = nasa_grid[best_key].get("annual") or {}
    return {
        "ghi": float(ann.get("ghiKwhM2Day", 5.0)),
        "ws100m": float(ann.get("ws100mMs", 4.5)),
        "t2m": float(ann.get("t2mC", 26.0)),
    }


async def build_verified_training_dataset(max_positives: int = 120, force_rebuild: bool = False) -> pd.DataFrame:
    """
    Constructs a real spatial ML dataset for India:
      - Positive labels (y=1): Verified Indian Solar & Wind installations from WRI Global Power Plant Database v1.3.0
      - Negative/background labels (y=0): Deterministic India land grid points > 15 km away from any WRI plant
      - Features: NASA POWER climatology (GHI, WS100m, T2M), SRTM 30m elevation & local 4-neighbor slope,
        and projected EPSG:7755 distance to nearest state capital / major power evacuation hub.
    """
    csv_fallback = ML_TRAINING_CACHE_PATH.with_suffix(".csv")
    if not force_rebuild:
        if ML_TRAINING_CACHE_PATH.exists():
            try:
                return pd.read_parquet(ML_TRAINING_CACHE_PATH)
            except Exception:
                pass
        if csv_fallback.exists():
            return pd.read_csv(csv_fallback)

    wri = ensure_wri_india_df().copy()
    wri = wri.sort_values("capacity_mw", ascending=False).head(max_positives).copy()

    adm1 = ensure_adm1_gdf()
    from shapely.prepared import prep
    india_union = adm1.geometry.simplify(0.05).union_all()
    india_prep = prep(india_union)
    india_buf_prep = prep(india_union.buffer(1.0))
    to_india_lcc = Transformer.from_crs("EPSG:4326", "EPSG:7755", always_xy=True)

    # Plant coordinates in projected meters for 15 km exclusion buffer
    plant_xy = [to_india_lcc.transform(float(r.longitude), float(r.latitude)) for r in wri.itertuples()]

    # Deterministic India land grid (2.2 deg step) outside 18 km of any WRI renewable plant
    neg_rows: list[dict[str, Any]] = []
    for lat in np.arange(8.5, 34.5, 2.2):
        for lon in np.arange(69.0, 95.0, 2.2):
            pt = Point(float(lon), float(lat))
            if not india_prep.contains(pt):
                continue
            px, py = to_india_lcc.transform(float(lon), float(lat))
            min_plant_dist_km = min(math.hypot(px - wx, py - wy) for wx, wy in plant_xy) / 1000.0
            if min_plant_dist_km >= 18.0:
                neg_rows.append(
                    {
                        "sample_id": f"bg-{lat:.1f}-{lon:.1f}",
                        "name": f"India Background ({lat:.1f}N, {lon:.1f}E)",
                        "fuel_type": "Background",
                        "label": 0,
                        "solar_label": 0,
                        "wind_label": 0,
                        "latitude": float(lat),
                        "longitude": float(lon),
                        "capacity_mw": 0.0,
                        "state_name": "India Grid",
                    }
                )

    pos_rows: list[dict[str, Any]] = []
    for r in wri.itertuples():
        fuel = str(r.primary_fuel)
        pos_rows.append(
            {
                "sample_id": str(r.gppd_idnr),
                "name": str(r.name),
                "fuel_type": fuel,
                "label": 1,
                "solar_label": 1 if fuel == "Solar" else 0,
                "wind_label": 1 if fuel == "Wind" else 0,
                "latitude": float(r.latitude),
                "longitude": float(r.longitude),
                "capacity_mw": float(r.capacity_mw),
                "state_name": str(getattr(r, "state_name", "India") or "India"),
            }
        )

    samples_df = pd.DataFrame(pos_rows + neg_rows).reset_index(drop=True)

    # Fetch NASA POWER across a 3.5 deg India grid in parallel (~28 calls, cached in DB)
    nasa_grid_pts = []
    for lat in np.arange(8.5, 35.5, 3.5):
        for lon in np.arange(69.0, 96.0, 3.5):
            if india_buf_prep.contains(Point(float(lon), float(lat))):
                nasa_grid_pts.append((float(round(lat, 2)), float(round(lon, 2))))

    nasa_map = await fetch_nasa_power_batch_async(nasa_grid_pts)
    if not nasa_map:
        raise RuntimeError("Failed to retrieve NASA POWER climatology grid for ML feature extraction.")

    # Batch SRTM 30m elevation + +/-0.02 deg (~2.2 km) local finite-difference slope
    delta = 0.02
    coords_center = [(float(r.latitude), float(r.longitude)) for r in samples_df.itertuples()]
    coords_east = [(float(r.latitude), float(r.longitude) + delta) for r in samples_df.itertuples()]
    coords_north = [(float(r.latitude) + delta, float(r.longitude)) for r in samples_df.itertuples()]

    elev_c = await asyncio.to_thread(fetch_srtm_elevations, coords_center)
    elev_e = await asyncio.to_thread(fetch_srtm_elevations, coords_east)
    elev_n = await asyncio.to_thread(fetch_srtm_elevations, coords_north)

    # Distance to nearest state centroid / major regional grid evacuation anchor (projected EPSG:7755)
    state_anchors_m = [
        to_india_lcc.transform(float(r.centroid_lon), float(r.centroid_lat))
        for r in adm1.itertuples()
    ]

    ghis, wss, t2ms, elevs, slopes, dists, blocks = [], [], [], [], [], [], []
    for idx, row in enumerate(samples_df.itertuples()):
        nval = _nearest_nasa_value(row.latitude, row.longitude, nasa_map)
        ec = elev_c[idx] if elev_c[idx] is not None else 250.0
        ee = elev_e[idx] if elev_e[idx] is not None else ec
        en = elev_n[idx] if elev_n[idx] is not None else ec
        # 0.02 deg ~ 2220m
        dz_dx = (ee - ec) / 2220.0
        dz_dy = (en - ec) / 2220.0
        slope = math.degrees(math.atan(math.hypot(dz_dx, dz_dy)))

        px, py = to_india_lcc.transform(row.longitude, row.latitude)
        d_km = min(math.hypot(px - ax, py - ay) for ax, ay in state_anchors_m) / 1000.0

        # 4 deg x 4 deg spatial block ID for spatial cross-validation (prevents spatial autocorrelation leakage)
        block_id = f"b_{int(row.latitude // 4)}_{int(row.longitude // 4)}"

        ghis.append(round(nval["ghi"], 3))
        wss.append(round(nval["ws100m"], 3))
        t2ms.append(round(nval["t2m"], 2))
        elevs.append(round(float(ec), 1))
        slopes.append(round(float(slope), 2))
        dists.append(round(float(d_km), 2))
        blocks.append(block_id)

    samples_df["ghi_kwh_m2_day"] = ghis
    samples_df["ws100m_ms"] = wss
    samples_df["t2m_c"] = t2ms
    samples_df["elevation_m"] = elevs
    samples_df["slope_deg"] = slopes
    samples_df["dist_infra_km"] = dists
    samples_df["spatial_block"] = blocks

    samples_df.to_csv(csv_fallback, index=False)
    try:
        samples_df.to_parquet(ML_TRAINING_CACHE_PATH, index=False)
    except Exception:
        pass
    return samples_df


def _ahp_heuristic_score(df: pd.DataFrame, scenario: str = "hybrid") -> np.ndarray:
    sw = get_default_ahp("solar")["weights"]
    ww = get_default_ahp("wind")["weights"]

    norm_ghi = np.clip((df["ghi_kwh_m2_day"].values - 3.5) / (6.8 - 3.5), 0.0, 1.0)
    norm_ws = np.clip((df["ws100m_ms"].values - 3.0) / (8.5 - 3.0), 0.0, 1.0)
    norm_temp = np.clip(1.0 - (df["t2m_c"].values - 15.0) / 30.0, 0.25, 1.0)
    norm_slope = np.clip(1.0 - df["slope_deg"].values / 15.0, 0.0, 1.0)
    norm_infra = np.clip(1.0 - df["dist_infra_km"].values / 150.0, 0.0, 1.0)
    norm_lulc = np.full(len(df), 0.8)

    solar_s = (
        sw["C1"] * norm_ghi
        + sw["C2"] * norm_temp
        + sw["C3"] * norm_slope
        + sw["C4"] * norm_lulc
        + sw["C5"] * norm_infra
        + sw["C6"] * norm_infra
    )
    wind_s = (
        ww["C1"] * norm_ws
        + ww["C2"] * 0.75
        + ww["C3"] * norm_slope
        + ww["C4"] * norm_lulc
        + ww["C5"] * norm_infra
        + ww["C6"] * norm_infra
    )
    if scenario == "solar":
        return solar_s
    if scenario == "wind":
        return wind_s
    return np.maximum(solar_s, wind_s)


def _to_5_class(prob: np.ndarray) -> np.ndarray:
    cls = np.ones(len(prob), dtype=int)
    cls[(prob >= 0.20) & (prob < 0.40)] = 2
    cls[(prob >= 0.40) & (prob < 0.60)] = 3
    cls[(prob >= 0.60) & (prob < 0.80)] = 4
    cls[prob >= 0.80] = 5
    return cls


async def train_and_evaluate_ml(scenario: str = "hybrid", force_rebuild: bool = False) -> dict[str, Any]:
    scenario = scenario.lower().strip()
    if scenario not in ("hybrid", "solar", "wind"):
        scenario = "hybrid"

    df = await build_verified_training_dataset(force_rebuild=force_rebuild)
    if scenario == "solar":
        y = df["solar_label"].values.astype(int)
    elif scenario == "wind":
        y = df["wind_label"].values.astype(int)
    else:
        y = df["label"].values.astype(int)

    X = df[FEATURE_COLS].values.astype(float)
    groups = df["spatial_block"].values

    unique_groups = len(np.unique(groups))
    n_splits = min(5, unique_groups)
    gkf = GroupKFold(n_splits=n_splits)

    def _run_cv(model_factory: Any) -> dict[str, Any]:
        fold_metrics = []
        oof_probs = np.zeros(len(y), dtype=float)
        for fold_idx, (train_idx, test_idx) in enumerate(gkf.split(X, y, groups), start=1):
            y_tr, y_te = y[train_idx], y[test_idx]
            if len(np.unique(y_tr)) < 2 or len(np.unique(y_te)) < 2:
                continue
            clf = model_factory()
            clf.fit(X[train_idx], y_tr)
            probs = clf.predict_proba(X[test_idx])[:, 1]
            preds = (probs >= 0.5).astype(int)
            oof_probs[test_idx] = probs
            fold_metrics.append(
                {
                    "fold": fold_idx,
                    "nTest": int(len(test_idx)),
                    "rocAuc": round(float(roc_auc_score(y_te, probs)), 4),
                    "f1": round(float(f1_score(y_te, preds, zero_division=0)), 4),
                    "accuracy": round(float(accuracy_score(y_te, preds)), 4),
                    "balancedAccuracy": round(float(balanced_accuracy_score(y_te, preds)), 4),
                }
            )
        valid_mask = oof_probs > 0
        mean_auc = float(np.mean([m["rocAuc"] for m in fold_metrics])) if fold_metrics else 0.0
        mean_f1 = float(np.mean([m["f1"] for m in fold_metrics])) if fold_metrics else 0.0
        mean_acc = float(np.mean([m["accuracy"] for m in fold_metrics])) if fold_metrics else 0.0
        mean_bacc = float(np.mean([m["balancedAccuracy"] for m in fold_metrics])) if fold_metrics else 0.0
        return {
            "meanRocAuc": round(mean_auc, 4),
            "meanF1": round(mean_f1, 4),
            "meanAccuracy": round(mean_acc, 4),
            "meanBalancedAccuracy": round(mean_bacc, 4),
            "folds": fold_metrics,
            "oofProbs": oof_probs,
            "evaluatedCount": int(np.sum(valid_mask)),
        }

    rf_cv = _run_cv(
        lambda: RandomForestClassifier(
            n_estimators=180, max_depth=7, min_samples_leaf=3, class_weight="balanced", random_state=42
        )
    )
    xgb_cv = _run_cv(
        lambda: XGBClassifier(
            n_estimators=140,
            max_depth=4,
            learning_rate=0.06,
            subsample=0.85,
            colsample_bytree=0.85,
            eval_metric="logloss",
            random_state=42,
        )
    )

    # Fit final full models for SHAP & cluster diagnostics
    rf_full = RandomForestClassifier(
        n_estimators=180, max_depth=7, min_samples_leaf=3, class_weight="balanced", random_state=42
    ).fit(X, y)
    xgb_full = XGBClassifier(
        n_estimators=140,
        max_depth=4,
        learning_rate=0.06,
        subsample=0.85,
        colsample_bytree=0.85,
        eval_metric="logloss",
        random_state=42,
    ).fit(X, y)

    # SHAP TreeExplainer on XGBoost
    explainer = shap.TreeExplainer(xgb_full)
    shap_values = explainer.shap_values(X)
    if isinstance(shap_values, list):
        shap_arr = np.asarray(shap_values[-1])
    else:
        shap_arr = np.asarray(shap_values)

    mean_abs_shap = np.mean(np.abs(shap_arr), axis=0)
    total_shap = float(np.sum(mean_abs_shap)) or 1.0
    global_shap = []
    for i, col in enumerate(FEATURE_COLS):
        corr_sign = 1.0
        if np.std(X[:, i]) > 0 and np.std(shap_arr[:, i]) > 0:
            corr_sign = float(np.corrcoef(X[:, i], shap_arr[:, i])[0, 1])
        global_shap.append(
            {
                "feature": col,
                "label": FEATURE_LABELS[col],
                "meanAbsShap": round(float(mean_abs_shap[i]), 4),
                "relativeImportancePct": round(float(mean_abs_shap[i] / total_shap * 100.0), 1),
                "direction": "positive" if corr_sign >= 0 else "negative",
            }
        )
    global_shap.sort(key=lambda x: x["meanAbsShap"], reverse=True)

    # K-Means Clustering (k=4 agro-climatic resource regimes across India points)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    kmeans = KMeans(n_clusters=4, n_init=10, random_state=42)
    cluster_ids = kmeans.fit_predict(X_scaled)
    df["cluster_id"] = cluster_ids
    df["xgb_prob"] = xgb_cv["oofProbs"]
    df["rf_prob"] = rf_cv["oofProbs"]
    df["ahp_score"] = _ahp_heuristic_score(df, scenario=scenario)

    clusters_summary = []
    for cid in range(4):
        sub = df[df["cluster_id"] == cid]
        mean_ghi = float(sub["ghi_kwh_m2_day"].mean())
        mean_ws = float(sub["ws100m_ms"].mean())
        mean_elev = float(sub["elevation_m"].mean())
        if mean_elev > 1400:
            regime_name = "High-Altitude / Steep Terrain Zone"
        elif mean_ghi >= 5.5 and mean_ws >= 5.0:
            regime_name = "High Solar-Wind Hybrid Corridor"
        elif mean_ghi >= 5.3:
            regime_name = "Solar-Dominant Arid / Plateau Belt"
        elif mean_ws >= 4.8:
            regime_name = "Monsoon Wind-Corridor Belt"
        else:
            regime_name = "Moderate Mixed-Resource Terrain"

        clusters_summary.append(
            {
                "clusterId": cid,
                "regimeName": regime_name,
                "sampleCount": int(len(sub)),
                "verifiedPlantSharePct": round(float(sub["label"].mean() * 100.0), 1),
                "meanGhi": round(mean_ghi, 2),
                "meanWs100m": round(mean_ws, 2),
                "meanElevationM": round(mean_elev, 1),
                "meanSlopeDeg": round(float(sub["slope_deg"].mean()), 2),
                "meanDistInfraKm": round(float(sub["dist_infra_km"].mean()), 1),
            }
        )

    # AHP vs ML Suitability Comparison
    valid_oof = df["xgb_prob"].values > 0
    ahp_vals = df["ahp_score"].values[valid_oof]
    ml_vals = df["xgb_prob"].values[valid_oof]
    if len(ahp_vals) > 5 and np.std(ahp_vals) > 0 and np.std(ml_vals) > 0:
        p_r, p_p = pearsonr(ahp_vals, ml_vals)
        s_rho, s_p = spearmanr(ahp_vals, ml_vals)
        ahp_cls = _to_5_class(ahp_vals)
        ml_cls = _to_5_class(ml_vals)
        exact_agree = float(np.mean(ahp_cls == ml_cls) * 100.0)
        within1_agree = float(np.mean(np.abs(ahp_cls - ml_cls) <= 1) * 100.0)
    else:
        p_r, p_p, s_rho, s_p, exact_agree, within1_agree = 0.0, 1.0, 0.0, 1.0, 0.0, 0.0

    # Sample comparison points (real WRI plants & background) for scatter & inspection
    sample_points = [
        {
            "name": str(r.name),
            "fuelType": str(r.fuel_type),
            "stateName": str(r.state_name),
            "ahpScore": round(float(r.ahp_score), 3),
            "xgbSuitabilityProb": round(float(r.xgb_prob), 3),
            "rfSuitabilityProb": round(float(r.rf_prob), 3),
            "clusterId": int(r.cluster_id),
            "ghi": float(r.ghi_kwh_m2_day),
            "ws100m": float(r.ws100m_ms),
        }
        for r in df.head(40).itertuples()
    ]

    run_id = f"ml-{scenario}-{uuid.uuid4().hex[:8]}"
    payload = {
        "run_id": run_id,
        "scenario": scenario,
        "dataset_source": "WRI Global Power Plant Database v1.3.0 (India) + NASA POWER + SRTM 30m",
        "sample_count": int(len(df)),
        "positive_count": int(np.sum(y == 1)),
        "background_count": int(np.sum(y == 0)),
        "spatial_cv_scheme": f"GroupKFold ({n_splits} folds grouped by 4°×4° spatial blocks)",
        "label_methodology_note": (
            "Positive class (y=1) uses verified WRI India Solar/Wind plants; negative background (y=0) uses "
            "deterministic India land grid points >18 km from any WRI plant. Uncataloged recent parks may act as label noise."
        ),
        "metrics": {
            "randomForest": {k: v for k, v in rf_cv.items() if k != "oofProbs"},
            "xgboost": {k: v for k, v in xgb_cv.items() if k != "oofProbs"},
        },
        "shap": {
            "explainer": "shap.TreeExplainer (XGBoost)",
            "baseValue": round(float(np.mean(explainer.expected_value)), 4),
            "globalFeatures": global_shap,
        },
        "clusters": clusters_summary,
        "ahp_comparison": {
            "pearsonR": round(float(p_r), 4),
            "pearsonPValue": round(float(p_p), 6),
            "spearmanRho": round(float(s_rho), 4),
            "exact5ClassAgreementPct": round(exact_agree, 1),
            "withinOneClassAgreementPct": round(within1_agree, 1),
            "samplePoints": sample_points,
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    db.save_ml_run(payload)
    ML_ARTIFACTS_PATH.write_text(json.dumps(payload), encoding="utf-8")
    return payload


async def explain_region_with_ml(region_id: str, lat: float, lon: float, elev_m: float, slope_deg: float, dist_km: float) -> dict[str, Any]:
    """Computes live NASA POWER + SRTM feature vector and returns real RF/XGBoost prediction + SHAP breakdown."""
    nasa = fetch_nasa_power_climatology(lat, lon, elevation_m=elev_m)
    ann = nasa.get("annual") or {"ghiKwhM2Day": 5.2, "ws100mMs": 4.8, "t2mC": 25.0}

    df = await build_verified_training_dataset()
    X_train = df[FEATURE_COLS].values.astype(float)
    y_train = df["label"].values.astype(int)
    xgb = XGBClassifier(n_estimators=140, max_depth=4, learning_rate=0.06, random_state=42).fit(X_train, y_train)
    rf = RandomForestClassifier(n_estimators=180, max_depth=7, class_weight="balanced", random_state=42).fit(X_train, y_train)

    x_pt = np.array([[ann["ghiKwhM2Day"], ann["ws100mMs"], ann["t2mC"], elev_m, slope_deg, dist_km]], dtype=float)
    xgb_prob = float(xgb.predict_proba(x_pt)[0, 1])
    rf_prob = float(rf.predict_proba(x_pt)[0, 1])

    explainer = shap.TreeExplainer(xgb)
    sv = explainer.shap_values(x_pt)
    sv_row = np.asarray(sv[-1] if isinstance(sv, list) else sv)[0]

    local_shap = [
        {
            "feature": col,
            "label": FEATURE_LABELS[col],
            "value": round(float(x_pt[0, i]), 2),
            "shapContribution": round(float(sv_row[i]), 4),
        }
        for i, col in enumerate(FEATURE_COLS)
    ]
    local_shap.sort(key=lambda item: abs(item["shapContribution"]), reverse=True)

    return {
        "regionId": region_id,
        "xgbSuitabilityProb": round(xgb_prob, 4),
        "rfSuitabilityProb": round(rf_prob, 4),
        "localShap": local_shap,
    }
