from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def generate_region_pdf_bytes(
    gis_result: dict[str, Any],
    ahp_solar: dict[str, Any],
    ahp_wind: dict[str, Any],
    ml_run: dict[str, Any] | None = None,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.8 * cm, bottomMargin=1.8 * cm)
    styles = getSampleStyleSheet()
    story: list[Any] = []

    reg = gis_result["region"]
    res = gis_result["resourceSummary"]
    sol = gis_result["solarSuitability"]
    wnd = gis_result["windSuitability"]

    story.append(Paragraph(f"GreenMap India — Renewable Energy GIS & ML Assessment", styles["Title"]))
    story.append(
        Paragraph(
            f"<b>Region:</b> {reg['name']} ({reg['admLevel']}) &nbsp;|&nbsp; "
            f"<b>Parent State:</b> {reg['parentState']} &nbsp;|&nbsp; "
            f"<b>Projected Area:</b> {reg['areaKm2']:,.2f} km² (EPSG:7755)",
            styles["Normal"],
        )
    )
    story.append(
        Paragraph(
            f"Generated UTC: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} | "
            f"Centroid: {reg['centroid'][1]:.3f}°N, {reg['centroid'][0]:.3f}°E",
            styles["Italic"],
        )
    )
    story.append(Spacer(1, 14))

    # Resource & Terrain Summary Table
    story.append(Paragraph("1. Verified Climate, Terrain & Infrastructure Summary", styles["Heading2"]))
    summary_rows = [
        ["Metric", "Value", "Source / CRS"],
        ["Mean Solar GHI", f"{res['meanGhiKwhM2Day']} kWh/m²/day", "NASA POWER Climatology"],
        ["PV Specific Yield (Est.)", f"{res['pvSpecificYieldKwhKwpYr']} kWh/kWp/yr", "IEC Temp-Derated Model"],
        ["Mean Wind Speed (100m)", f"{res['meanWs100mMs']} m/s", "NASA POWER WS50M + Hellmann"],
        ["Wind Power Density (100m)", f"{res['wpd100mWM2']} W/m²", "Air-Density Corrected"],
        ["Mean Elevation / Slope", f"{res['meanElevationM']} m / {res['meanSlopeDeg']}°", "SRTM 30m DEM (EPSG:7755)"],
        ["Mean Grid / Road Distance", f"{res['meanDistPowerKm']} km / {res['meanDistRoadKm']} km", "OSM Overpass + WRI Anchors"],
        ["Solar Suitable Land (Class 4–5)", f"{sol['suitableLandAreaKm2']:,.2f} km² ({sol['estimatedCapacityGw']} GW)", "35 MW/km² Packing"],
        ["Wind Suitable Land (Class 4–5)", f"{wnd['suitableLandAreaKm2']:,.2f} km² ({wnd['estimatedCapacityGw']} GW)", "5 MW/km² Packing"],
    ]
    t1 = Table(summary_rows, colWidths=[6.0 * cm, 5.5 * cm, 5.5 * cm])
    t1.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d4a3a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(t1)
    story.append(Spacer(1, 14))

    # 5-Class Suitability Breakdown
    story.append(Paragraph("2. Five-Class Solar & Wind Suitability Breakdown", styles["Heading2"]))
    cls_rows = [["Suitability Class", "Solar Area (km²)", "Solar Cap (MW)", "Wind Area (km²)", "Wind Cap (MW)"]]
    for sc, wc in zip(sol["classes"], wnd["classes"]):
        cls_rows.append(
            [
                f"Class {sc['classId']}: {sc['label']}",
                f"{sc['areaKm2']:,.2f}",
                f"{sc['estimatedCapacityMw']:,.1f}",
                f"{wc['areaKm2']:,.2f}",
                f"{wc['estimatedCapacityMw']:,.1f}",
            ]
        )
    t2 = Table(cls_rows, colWidths=[5.8 * cm, 2.8 * cm, 2.8 * cm, 2.8 * cm, 2.8 * cm])
    t2.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0b192c")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(t2)
    story.append(Spacer(1, 14))

    # AHP Configuration
    story.append(Paragraph("3. AHP Multi-Criteria Weights & Consistency Verification", styles["Heading2"]))
    ahp_rows = [
        ["Scenario", "C1", "C2", "C3", "C4", "C5", "C6", "CR", "Status"],
        [
            "Solar PV",
            *(f"{ahp_solar['weights'].get(f'C{i}', 0):.3f}" for i in range(1, 7)),
            f"{ahp_solar['cr']:.4f}",
            "Consistent" if ahp_solar["is_consistent"] else "Inconsistent (>=0.10)",
        ],
        [
            "Wind 100m",
            *(f"{ahp_wind['weights'].get(f'C{i}', 0):.3f}" for i in range(1, 7)),
            f"{ahp_wind['cr']:.4f}",
            "Consistent" if ahp_wind["is_consistent"] else "Inconsistent (>=0.10)",
        ],
    ]
    t3 = Table(ahp_rows, colWidths=[2.3 * cm, *([1.5 * cm] * 6), 1.7 * cm, 4.0 * cm])
    t3.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d4a3a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("PADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t3)
    story.append(Spacer(1, 14))

    if ml_run:
        story.append(Paragraph("4. Spatial Cross-Validation & SHAP ML Diagnostics", styles["Heading2"]))
        xgb_m = ml_run["metrics"]["xgboost"]
        rf_m = ml_run["metrics"]["randomForest"]
        comp = ml_run["ahp_comparison"]
        story.append(
            Paragraph(
                f"Dataset: {ml_run['dataset_source']} (N={ml_run['sample_count']} points, "
                f"{ml_run.get('spatial_cv_scheme', 'GroupKFold Spatial CV')}). "
                f"XGBoost Mean Spatial-CV ROC-AUC: <b>{xgb_m['meanRocAuc']:.3f}</b> (F1: {xgb_m['meanF1']:.3f}) | "
                f"Random Forest Mean Spatial-CV ROC-AUC: <b>{rf_m['meanRocAuc']:.3f}</b> (F1: {rf_m['meanF1']:.3f}). "
                f"AHP vs ML Pearson r = {comp['pearsonR']:.3f}, Spearman rho = {comp['spearmanRho']:.3f}.",
                styles["Normal"],
            )
        )
        story.append(Spacer(1, 6))

    story.append(
        Paragraph(
            "<b>Methodological Limitations:</b> NASA POWER climatology is 0.5° (~55 km) gridded; "
            "OSM substation coverage varies by district; WRI v1.3.0 plant labels omit very recent ultra-mega parks. "
            "Results represent reproducible macro-tile academic screening rather than engineering micro-siting.",
            styles["Italic"],
        )
    )

    doc.build(story)
    return buf.getvalue()
