import { useEffect, useState } from "react";
import { GitCompare, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDIA_REGIONS } from "@/data/indiaRenewableData";
import { compareRegionsApi, fetchDistricts, fetchRegions } from "@/lib/greenmapApi";
import type { ApiDistrictSummary, ApiRegionSummary, ComparisonEntry } from "@/types/greenmap";

export function LocationComparisonPage() {
  const [granularity, setGranularity] = useState<"states" | "districts">("states");
  const [states, setStates] = useState<ApiRegionSummary[]>([]);
  const [districts, setDistricts] = useState<ApiDistrictSummary[]>([]);
  const [slotA, setSlotA] = useState("in-rj");
  const [slotB, setSlotB] = useState("in-gj");
  const [slotC, setSlotC] = useState("in-tn");
  const [results, setResults] = useState<ComparisonEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchRegions(), fetchDistricts()])
      .then(([regRes, distRes]) => {
        setStates(regRes.regions);
        setDistricts(distRes.districts);
      })
      .catch(() => {});
  }, []);

  const handleGranularityChange = (mode: "states" | "districts") => {
    setGranularity(mode);
    if (mode === "states") {
      setSlotA("in-rj");
      setSlotB("in-gj");
      setSlotC("in-tn");
    } else if (districts.length >= 3) {
      const rjDist = districts.find((d) => d.parentState === "Rajasthan") ?? districts[0];
      const gjDist = districts.find((d) => d.parentState === "Gujarat") ?? districts[1];
      const tnDist = districts.find((d) => d.parentState === "Tamil Nadu") ?? districts[2];
      setSlotA(rjDist.id);
      setSlotB(gjDist.id);
      setSlotC(tnDist.id);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    compareRegionsApi([slotA, slotB, slotC])
      .then((res) => {
        if (active) setResults(res.comparisons);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Comparison failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slotA, slotB, slotC]);

  const options =
    granularity === "states"
      ? (states.length > 0 ? states : INDIA_REGIONS).map((s) => ({
          id: s.id,
          label: s.name,
        }))
      : districts.slice(0, 150).map((d) => ({
          id: d.id,
          label: `${d.name} (${d.parentState})`,
        }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]">
            State &amp; District Spatial Comparison
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live side-by-side comparison computed from NASA POWER, SRTM 30m, OSM Overpass, and
            EPSG:7755 5-class suitability rasters.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#eef4f1] p-1 dark:bg-[#07111e]">
          {(["states", "districts"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleGranularityChange(mode)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                granularity === mode
                  ? "bg-white text-[#0d4a3a] shadow-sm dark:bg-[#12263d] dark:text-emerald-300"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Region Selectors */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#d5e0db] bg-white p-5 md:grid-cols-3 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        {[
          { label: "Location A", value: slotA, onChange: setSlotA },
          { label: "Location B", value: slotB, onChange: setSlotB },
          { label: "Location C", value: slotC, onChange: setSlotC },
        ].map((slot) => (
          <div key={slot.label} className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {slot.label}
            </label>
            <Select value={slot.value} onValueChange={slot.onChange}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-50/70 p-4 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Comparison Matrix Table */}
      <div className="overflow-x-auto rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
            <h2 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
              Multi-Site Resource &amp; Suitability Matrix
            </h2>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
        </div>

        {results.length > 0 && (
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#d5e0db] text-xs text-slate-500 dark:border-[#1a3048] dark:text-slate-400">
                <th className="py-3 pr-4 font-medium">Metric</th>
                {results.map((entry, idx) => (
                  <th
                    key={`${entry.region.id}-${idx}`}
                    className="px-4 py-3 font-semibold text-[#0b192c] dark:text-emerald-300"
                  >
                    {entry.region.name} ({entry.region.admLevel})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d5e0db]/70 font-mono text-xs dark:divide-[#1a3048]/70">
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Projected Area (EPSG:7755)</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.region.areaKm2.toLocaleString()} km²
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Mean Solar GHI</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.resourceSummary.meanGhiKwhM2Day} kWh/m²/day
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">PV Specific Yield</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.resourceSummary.pvSpecificYieldKwhKwpYr?.toLocaleString() ?? "—"} kWh/kWp/yr
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Mean Wind Speed (100m)</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.resourceSummary.meanWs100mMs} m/s ({r.resourceSummary.wpd100mWM2 ?? "—"} W/m²)
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Mean Elevation / Slope</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.resourceSummary.meanElevationM} m · {r.resourceSummary.meanSlopeDeg}°
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Grid / Road Distance</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.resourceSummary.meanDistPowerKm} km / {r.resourceSummary.meanDistRoadKm} km
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Solar Suitable Area (C4–C5)</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    {r.solarSuitability.suitableLandAreaKm2.toLocaleString()} km² ({r.solarSuitability.estimatedCapacityGw} GW)
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Wind Suitable Area (C4–C5)</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                    {r.windSuitability.suitableLandAreaKm2.toLocaleString()} km² ({r.windSuitability.estimatedCapacityGw} GW)
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 pr-4 font-sans font-medium text-slate-500">Sentinel-2 Cloud-Free Scenes</td>
                {results.map((r, i) => (
                  <td key={i} className="px-4 py-3 tabular-nums">
                    {r.sentinel2MatchedScenes} matched
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
