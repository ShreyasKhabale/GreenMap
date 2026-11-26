import { useEffect, useState } from "react";
import { Loader2, Wind } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Spotlight } from "@/components/ui/spotlight";
import { NumberTicker } from "@/components/ui/number-ticker";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDIA_REGIONS, WIND_IMAGE_PATH } from "@/data/indiaRenewableData";
import { analyzeWind, fetchRegions } from "@/lib/greenmapApi";
import type { ApiRegionSummary, IndiaRegionRecord, WindAnalyzeResult } from "@/types/greenmap";

interface WindAnalysisPageProps {
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
}

export function WindAnalysisPage({
  selectedRegion,
  onSelectRegion,
}: WindAnalysisPageProps) {
  const [hubHeight, setHubHeight] = useState("100");
  const [cutInSpeed, setCutInSpeed] = useState([3.0]);
  const [rotorDiameter, setRotorDiameter] = useState([136]);
  const [regionsList, setRegionsList] = useState<ApiRegionSummary[]>([]);
  const [windData, setWindData] = useState<WindAnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchRegions()
      .then((res) => setRegionsList(res.regions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    analyzeWind(selectedRegion.id, Number(hubHeight))
      .then((res) => {
        if (active) setWindData(res);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Failed to load wind analysis");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.id, hubHeight]);

  const monthly = windData?.nasaMonthly ?? [];
  const shear = windData?.shearProfile ?? [];
  const maxMonthlyWs = Math.max(9.0, ...monthly.map((m) => m.ws120m));
  const sweptAreaM2 = Math.PI * Math.pow(rotorDiameter[0] / 2, 2);
  const activeShear =
    shear.find((s) => s.heightM === Number(hubHeight)) ?? shear[shear.length - 1];
  const rotorPowerKw = activeShear
    ? Math.round((0.40 * activeShear.wpdWM2 * sweptAreaM2) / 1000)
    : 0;

  return (
    <div className="space-y-6">
      {/* Documentary Header */}
      <div className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-[#0c1b2e] dark:border-[#1a3048]">
        <img
          src={WIND_IMAGE_PATH}
          alt="Wind turbines along a misty green ridge in southern India"
          referrerPolicy="no-referrer"
          className="h-44 w-full object-cover opacity-75"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07111e]/95 via-[#07111e]/75 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-end p-6 text-white">
          <div className="flex items-center gap-2 text-xs text-sky-300">
            <Wind className="h-3.5 w-3.5" />
            <span>Hellmann Hub-Height Wind Shear &amp; GIS Suitability Modeling</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold">
            Wind Power Density &amp; Shear Profile — {windData?.region.name ?? selectedRegion.name}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-300">
            Extrapolated from NASA POWER 50m winds with air-density correction from SRTM 30m
            elevation and ambient temperature.
          </p>
        </div>
      </div>

      {/* Wind Modeling Parameters */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#d5e0db] bg-white p-5 md:grid-cols-2 xl:grid-cols-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Indian State Domain
          </label>
          <Select
            value={selectedRegion.id}
            onValueChange={(id) => {
              const found = INDIA_REGIONS.find((r) => r.id === id);
              const apiMatch = regionsList.find((r) => r.id === id);
              if (found) onSelectRegion(found);
              else if (apiMatch) {
                onSelectRegion({
                  ...selectedRegion,
                  id: apiMatch.id,
                  name: apiMatch.name,
                  stateCode: apiMatch.stateCode,
                  corridorName: `${apiMatch.name} State Domain`,
                  centroid: apiMatch.centroid,
                  bbox: apiMatch.bbox,
                });
              }
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(regionsList.length > 0 ? regionsList : INDIA_REGIONS).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Hub Height
          </label>
          <Select value={hubHeight} onValueChange={setHubHeight}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="80">80 m (Legacy Mast)</SelectItem>
              <SelectItem value="100">100 m (NIWE Standard)</SelectItem>
              <SelectItem value="120">120 m (Modern Utility)</SelectItem>
              <SelectItem value="150">150 m (High-Tower)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-300">Rotor Diameter</span>
            <span className="font-mono font-semibold tabular-nums">{rotorDiameter[0]} m</span>
          </div>
          <Slider
            value={rotorDiameter}
            min={90}
            max={170}
            step={2}
            onValueChange={setRotorDiameter}
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-300">Cut-in Velocity</span>
            <span className="font-mono font-semibold tabular-nums">
              {cutInSpeed[0].toFixed(1)} m/s
            </span>
          </div>
          <Slider
            value={cutInSpeed}
            min={2.0}
            max={4.5}
            step={0.5}
            onValueChange={setCutInSpeed}
          />
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-50/70 p-4 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {loading && !windData ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-[#d5e0db] bg-white dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-sky-500" />
          <span className="text-sm">Computing wind shear profile &amp; 5-class suitability...</span>
        </div>
      ) : (
        windData && (
          <Tabs defaultValue="monthly" className="space-y-4">
            <TabsList className="bg-[#eef4f1] dark:bg-[#0c1b2e]">
              <TabsTrigger value="monthly">Monthly Wind Speed &amp; Shear</TabsTrigger>
              <TabsTrigger value="suitability">5-Class Wind Suitability</TabsTrigger>
            </TabsList>

            <TabsContent value="monthly" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="relative rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <GlowingEffect
                  spread={30}
                  glow={true}
                  disabled={false}
                  proximity={56}
                  inactiveZone={0.01}
                  borderWidth={1.5}
                />
                <h2 className="relative z-10 font-display text-base font-semibold">
                  Monthly Hub-Height Wind Speed (50m vs 100m vs 120m)
                </h2>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Shows monsoon peak &amp; dry-season trough from NASA POWER RE Climatology.
                </p>

                <svg viewBox="0 0 560 220" className="h-56 w-full">
                  {monthly.map((m, idx) => {
                    const xBase = 24 + idx * 44;
                    const wsTarget = Number(hubHeight) >= 120 ? m.ws120m : m.ws100m;
                    const hTarget = (wsTarget / maxMonthlyWs) * 165;
                    const aboveCutIn = wsTarget >= cutInSpeed[0];
                    return (
                      <g key={m.month}>
                        <rect
                          x={xBase + 4}
                          y={185 - hTarget}
                          width={24}
                          height={hTarget}
                          rx={3}
                          fill={aboveCutIn ? "#0284c7" : "#94a3b8"}
                        />
                        <text
                          x={xBase + 16}
                          y={204}
                          textAnchor="middle"
                          className="fill-slate-500 text-[10px] font-mono"
                        >
                          {m.month}
                        </text>
                        <text
                          x={xBase + 16}
                          y={180 - hTarget}
                          textAnchor="middle"
                          className="fill-slate-400 text-[9px] font-mono"
                        >
                          {wsTarget.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="space-y-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-base font-semibold">
                      Vertical Shear Profile &amp; Turbine Output
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Swept Area: {Math.round(sweptAreaM2).toLocaleString()} m² · Extractable
                      Power (Cp=0.40): {rotorPowerKw.toLocaleString()} kW
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AnimatedCircularProgressBar
                      max={100}
                      value={Math.round(windData.windSuitability.meanAhpScore * 100)}
                      gaugePrimaryColor="#0284c7"
                      gaugeSecondaryColor="rgba(148,163,184,0.2)"
                      className="size-12 text-[11px]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      AHP Index
                    </span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {windData.shearProfile.map((row) => (
                    <div key={row.heightM} className="space-y-1">
                      <div className="flex justify-between font-mono text-xs">
                        <span>{row.heightM} m Hub</span>
                        <span>
                          {row.windSpeedMs.toFixed(2)} m/s · {row.wpdWM2.toFixed(1)} W/m²
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef4f1] dark:bg-[#07111e]">
                        <div
                          className="h-full rounded-full bg-sky-500 transition-all duration-500"
                          style={{ width: `${Math.min(100, (row.windSpeedMs / 9.5) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-sky-400/20 via-transparent to-transparent" />
                    <div className="text-slate-500">Suitable Area (C4–C5)</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                      <NumberTicker
                        value={windData.windSuitability.suitableLandAreaKm2}
                        decimalPlaces={0}
                      />{" "}
                      km²
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-emerald-400/20 via-transparent to-transparent" />
                    <div className="text-slate-500">Installable Capacity</div>
                    <div className="mt-0.5 font-mono text-lg font-bold tabular-nums">
                      <NumberTicker
                        value={windData.windSuitability.estimatedCapacityGw}
                        decimalPlaces={1}
                      />{" "}
                      GW
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="suitability">
              <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <h3 className="mb-3 font-display text-base font-semibold">
                  Five-Class Wind Suitability Breakdown ({windData.region.name})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#d5e0db] text-xs text-slate-500 dark:border-[#1a3048] dark:text-slate-400">
                        <th className="py-2 pr-4 font-medium">Class</th>
                        <th className="py-2 pr-4 font-medium">Score Band</th>
                        <th className="py-2 pr-4 text-right font-medium">Area (km²)</th>
                        <th className="py-2 text-right font-medium">Installable Capacity (MW)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
                      {windData.windSuitability.classes.map((c) => (
                        <tr key={c.classId}>
                          <td className="py-2.5 pr-4 font-medium">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="inline-block h-3 w-3 rounded-sm"
                                style={{ backgroundColor: c.color }}
                              />
                              Class {c.classId}: {c.label}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-slate-500">{c.range}</td>
                          <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                            {c.areaKm2.toLocaleString()}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold tabular-nums">
                            {c.estimatedCapacityMw.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )
      )}
    </div>
  );
}
