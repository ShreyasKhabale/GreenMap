import { useEffect, useState } from "react";
import { Database, Layers } from "lucide-react";
import { DATASET_CATALOG } from "@/data/indiaRenewableData";
import { fetchDatasets } from "@/lib/greenmapApi";
import type { DatasetReference } from "@/types/greenmap";

const METHODOLOGY_STEPS = [
  {
    step: "01–03",
    title: "Ingestion, CRS & Raster Preprocessing",
    detail:
      "Ingests GeoBoundaries ADM1/ADM2, NASA POWER, SRTM 30m, Sentinel-2 L2A STAC, OSM Overpass & WRI plants; transforms coordinates to EPSG:7755 and exports LZW GeoTIFFs via Rasterio.",
  },
  {
    step: "04–05",
    title: "Slope, Aspect & Grid Proximity",
    detail:
      "Computes topographic slope (°) and aspect (°) via projected metric gradients alongside Euclidean distance (km) to OSM substations, power corridors, and highways.",
  },
  {
    step: "06–07",
    title: "Land-Use & Exclusion Masking",
    detail:
      "Cross-checks Copernicus Sentinel-2 optical scene availability and excludes protected areas, water bodies, extreme elevation, and slopes exceeding engineering thresholds.",
  },
  {
    step: "08–09",
    title: "Normalization & 5-Class Suitability",
    detail:
      "Normalizes criteria (0–1), applies separate Solar & Wind AHP weights, classifies land into 5 suitability classes, and estimates capacity (35 MW/km² Solar, 5 MW/km² Wind).",
  },
  {
    step: "ML",
    title: "Spatial Cross-Validation & SHAP",
    detail:
      "Trains Random Forest, XGBoost, and K-Means on WRI India ground-truth plants + >=18 km background points evaluated via GroupKFold spatial blocks and SHAP TreeExplainer.",
  },
];

export function MethodologyPage() {
  const [datasets, setDatasets] = useState<DatasetReference[]>(DATASET_CATALOG);

  useEffect(() => {
    fetchDatasets()
      .then((res) => {
        if (res.datasets?.length) setDatasets(res.datasets);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d5e0db] bg-white p-6 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
          <Layers className="h-4 w-4" />
          <span>Academic GIS-MCDA &amp; Spatial ML Architecture</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]">
          Verified Data Sources, Licensing &amp; Methodology
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          GreenMap documents every dataset&apos;s spatial resolution, open license, and physical or
          sampling limitations so academic results remain transparent and reproducible.
        </p>
      </div>

      {/* 5-Stage Methodology Sequence */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {METHODOLOGY_STEPS.map((item) => (
          <div
            key={item.step}
            className="flex flex-col justify-between rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
          >
            <div className="space-y-2">
              <div className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Stage {item.step}
              </div>
              <h2 className="font-display text-base font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                {item.title}
              </h2>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {item.detail}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Verified Dataset Catalog */}
      <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
          <h2 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
            Verified Datasets, Licenses &amp; Known Limitations
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#d5e0db] text-xs text-slate-500 dark:border-[#1a3048] dark:text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Dataset &amp; License</th>
                <th className="py-2.5 pr-4 font-medium">Resolution</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 font-medium">Documented Limitations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
              {datasets.map((ds) => (
                <tr key={ds.id}>
                  <td className="py-3 pr-4 align-top">
                    <div className="font-medium text-[#0b192c] dark:text-[#e6f0ec]">
                      {ds.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {ds.provider} · {ds.licenseType}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                      {ds.integrationEndpoint}
                    </div>
                  </td>
                  <td className="py-3 pr-4 align-top font-mono text-xs tabular-nums">
                    {ds.spatialResolution}
                  </td>
                  <td className="py-3 pr-4 align-top font-mono text-xs text-emerald-700 dark:text-emerald-300">
                    {ds.status ?? "Integrated"}
                  </td>
                  <td className="py-3 align-top text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {ds.limitations ?? "Subject to upstream spatial/temporal coverage."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
