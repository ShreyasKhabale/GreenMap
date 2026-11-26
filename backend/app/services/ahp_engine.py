from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np

from backend.app.db.database import db

SAATY_RI: dict[int, float] = {
    1: 0.00,
    2: 0.00,
    3: 0.58,
    4: 0.90,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49,
}

SOLAR_CRITERIA_META = [
    {"id": "c1", "code": "C1", "name": "Solar Irradiance (GHI)", "unit": "kWh/m²/day"},
    {"id": "c2", "code": "C2", "name": "Temperature Stability (PV Thermal)", "unit": "°C"},
    {"id": "c3", "code": "C3", "name": "Terrain Slope", "unit": "degrees (°)"},
    {"id": "c4", "code": "C4", "name": "Land Use / Exclusion Compatibility", "unit": "class"},
    {"id": "c5", "code": "C5", "name": "Grid Substation Proximity", "unit": "km"},
    {"id": "c6", "code": "C6", "name": "Road & Logistics Access", "unit": "km"},
]

WIND_CRITERIA_META = [
    {"id": "c1", "code": "C1", "name": "Wind Speed & Power Density (100m)", "unit": "m/s"},
    {"id": "c2", "code": "C2", "name": "Air Density & Seasonal Stability", "unit": "kg/m³"},
    {"id": "c3", "code": "C3", "name": "Terrain Slope & Ridge Accessibility", "unit": "degrees (°)"},
    {"id": "c4", "code": "C4", "name": "Land Use / Exclusion Compatibility", "unit": "class"},
    {"id": "c5", "code": "C5", "name": "Grid Substation Proximity", "unit": "km"},
    {"id": "c6", "code": "C6", "name": "Heavy-Haul Road Access", "unit": "km"},
]

# Validated Saaty baseline matrices (CR < 0.10) for Solar & Wind scenarios
DEFAULT_SOLAR_MATRIX = [
    [1.0, 3.0, 2.0, 4.0, 5.0, 7.0],
    [1 / 3, 1.0, 0.5, 2.0, 3.0, 4.0],
    [0.5, 2.0, 1.0, 2.0, 3.0, 5.0],
    [0.25, 0.5, 0.5, 1.0, 2.0, 3.0],
    [0.2, 1 / 3, 1 / 3, 0.5, 1.0, 2.0],
    [1 / 7, 0.25, 0.2, 1 / 3, 0.5, 1.0],
]

DEFAULT_WIND_MATRIX = [
    [1.0, 3.0, 4.0, 4.0, 5.0, 7.0],
    [1 / 3, 1.0, 2.0, 2.0, 3.0, 4.0],
    [0.25, 0.5, 1.0, 1.0, 2.0, 3.0],
    [0.25, 0.5, 1.0, 1.0, 2.0, 3.0],
    [0.2, 1 / 3, 0.5, 0.5, 1.0, 2.0],
    [1 / 7, 0.25, 1 / 3, 1 / 3, 0.5, 1.0],
]


def compute_ahp(
    matrix: list[list[float]],
    scenario: str = "solar",
    persist: bool = True,
) -> dict[str, Any]:
    scenario_clean = scenario.lower().strip()
    if scenario_clean not in ("solar", "wind"):
        raise ValueError("AHP scenario must be 'solar' or 'wind'.")

    mat = np.array(matrix, dtype=float)
    if mat.ndim != 2 or mat.shape[0] != mat.shape[1]:
        raise ValueError("AHP pairwise matrix must be square.")
    n = mat.shape[0]
    if n < 2 or n > 10:
        raise ValueError("AHP matrix dimension must be between 2 and 10.")

    # Enforce reciprocal positive Saaty scale within tolerance [1/9, 9]
    if np.any(mat <= 0) or np.any(mat > 9.0001) or np.any(mat < (1.0 / 9.0) - 1e-4):
        raise ValueError("All pairwise comparison entries must be within Saaty's 1/9 to 9 scale.")

    # Enforce exact diagonal = 1 and reciprocal symmetry A[j,i] = 1/A[i,j] from upper triangle
    cleaned = mat.copy()
    for i in range(n):
        cleaned[i, i] = 1.0
        for j in range(i + 1, n):
            cleaned[j, i] = 1.0 / cleaned[i, j]

    # Exact principal right eigenvector via np.linalg.eig
    eigenvalues, eigenvectors = np.linalg.eig(cleaned)
    max_idx = int(np.argmax(eigenvalues.real))
    lambda_max = float(eigenvalues[max_idx].real)
    principal_vec = np.abs(eigenvectors[:, max_idx].real)
    weights = principal_vec / np.sum(principal_vec)

    ci = (lambda_max - n) / (n - 1) if n > 1 else 0.0
    ci = max(0.0, float(ci))
    ri = SAATY_RI.get(n, 1.49)
    cr = float(ci / ri) if ri > 0 else 0.0
    is_consistent = bool(cr < 0.10)

    criteria_meta = SOLAR_CRITERIA_META if scenario_clean == "solar" else WIND_CRITERIA_META
    weights_dict = {
        criteria_meta[i]["code"]: round(float(weights[i]), 6)
        for i in range(min(n, len(criteria_meta)))
    }

    result = {
        "config_id": f"ahp-{scenario_clean}-{uuid.uuid4().hex[:8]}",
        "scenario": scenario_clean,
        "matrix": [[round(float(v), 6) for v in row] for row in cleaned.tolist()],
        "criteria": criteria_meta[:n],
        "weights": weights_dict,
        "weights_vector": [round(float(w), 6) for w in weights.tolist()],
        "lambda_max": round(lambda_max, 5),
        "ci": round(ci, 5),
        "ri": ri,
        "cr": round(cr, 5),
        "is_consistent": is_consistent,
        "warning": (
            None
            if is_consistent
            else f"Inconsistent pairwise matrix (CR = {cr:.3f} >= 0.10). Revise Saaty judgments before applying weighted overlay."
        ),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if persist:
        db.save_ahp_config(result)

    return result


def get_default_ahp(scenario: str = "solar") -> dict[str, Any]:
    mat = DEFAULT_SOLAR_MATRIX if scenario == "solar" else DEFAULT_WIND_MATRIX
    return compute_ahp(mat, scenario=scenario, persist=False)
