import { useEffect, useState } from "react";
import { Loader2, Satellite, Sun } from "lucide-react";
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
import { INDIA_REGIONS, SOLAR_IMAGE_PATH } from "@/data/indiaRenewableData";
import { analyzeSolar, fetchRegions } from "@/lib/greenmapApi";
import type { ApiRegionSummary, IndiaRegionRecord, SolarAnalyzeResult } from "@/types/greenmap";

interface SolarAnalysisPageProps {
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
}

export function SolarAnalysisPage({
  selectedRegion,
  onSelectRegion,
}: SolarAnalysisPageProps) {
  const [tiltDeg, setTiltDeg] = useState([24]);
  const [performanceRatio, setPerformanceRatio] = useState([80]);
  const [minGhi, setMinGhi] = useState([5.0]);
  const [regionsList, setRegionsList] = useState<ApiRegionSummary[]>([]);
  const [solarData, setSolarData] = useState<SolarAnalyzeResult | null>(null);
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
    analyzeSolar(selectedRegion.id)
      .then((res) => {
        if (active) setSolarData(res);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Failed to load solar analysis");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.id]);

  const monthly = solarData?.nasaMonthly ?? [];
  const maxGhiVal = Math.max(7.5, ...monthly.map((m) => Math.max(m.ghi, m.dni)));
  const prScale = performanceRatio[0] / 80.0;
  const baseYield = solarData?.resourceSummary.pvSpecificYieldKwhKwpYr ?? 0;
  const adjustedYield = Math.round(baseYield * prScale);

  return (
    <div className="space-y-6">
      {/* Documentary Header */}
      <div className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-[#0c1b2e] dark:border-[#1a3048]">
        <img
          src={SOLAR_IMAGE_PATH}
          alt="Utility-scale solar photovoltaic array in western India"
          referrerPolicy="no-referrer"
          className="h-44 w-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07111e]/95 via-[#07111e]/75 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-end p-6 text-white">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Sun className="h-3.5 w-3.5" />
            <span>NASA POWER Climatology &amp; GIS Photovoltaic Suitability</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold">
            Solar Irradiance &amp; PV Suitability — {solarData?.region.name ?? selectedRegion.name}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-300">
            Live NASA POWER GHI/DNI climatology, SRTM 30m slope exclusion, and 5-class PV land
            suitability computed in EPSG:7755.
          </p>
        </div>
      </div>

      {/* Parameter Control Bar */}
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
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-300">Reference Array Tilt</span>
            <span className="font-mono font-semibold tabular-nums">{tiltDeg[0]}°</span>
          </div>
          <Slider value={tiltDeg} min={5} max={45} step={1} onValueChange={setTiltDeg} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-300">Performance Ratio (PR)</span>
            <span className="font-mono font-semibold tabular-nums">{performanceRatio[0]}%</span>
          </div>
          <Slider
            value={performanceRatio}
            min={65}
            max={90}
            step={1}
            onValueChange={setPerformanceRatio}
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-300">Min GHI Cutoff Filter</span>
            <span className="font-mono font-semibold tabular-nums">
              {minGhi[0].toFixed(1)} kWh/m²
            </span>
          </div>
          <Slider value={minGhi} min={3.5} max={6.5} step={0.1} onValueChange={setMinGhi} />
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-50/70 p-4 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {loading && !solarData ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-[#d5e0db] bg-white dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-500" />
          <span className="text-sm">Fetching NASA POWER monthly irradiance &amp; GIS suitability...</span>
        </div>
      ) : (
        solarData && (
          <Tabs defaultValue="irradiance" className="space-y-4">
            <TabsList className="bg-[#eef4f1] dark:bg-[#0c1b2e]">
              <TabsTrigger value="irradiance">NASA POWER Monthly Profile</TabsTrigger>
              <TabsTrigger value="suitability">5-Class Solar Suitability</TabsTrigger>
              <TabsTrigger value="verification">Sentinel-2 &amp; Terrain</TabsTrigger>
            </TabsList>

            <TabsContent value="irradiance" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Real Monthly GHI & DNI SVG Chart */}
              <div className="relative rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <GlowingEffect
                  spread={30}
                  glow={true}
                  disabled={false}
                  proximity={56}
                  inactiveZone={0.01}
                  borderWidth={1.5}
                />
                <div className="relative z-10 mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-base font-semibold">
                      Monthly GHI &amp; DNI Climatology (kWh/m²/day)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Source: NASA POWER RE Climatology · Mean GHI:{" "}
                      {solarData.resourceSummary.meanGhiKwhM2Day} kWh/m²/day
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" /> GHI
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> DNI
                    </span>
                  </div>
                </div>

                <svg viewBox="0 0 560 220" className="h-56 w-full">
                  {monthly.map((m, idx) => {
                    const xBase = 24 + idx * 44;
                    const ghiH = (m.ghi / maxGhiVal) * 165;
                    const dniH = (m.dni / maxGhiVal) * 165;
                    const meetsCutoff = m.ghi >= minGhi[0];
                    return (
                      <g key={m.month}>
                        <rect
                          x={xBase}
                          y={185 - ghiH}
                          width={15}
                          height={ghiH}
                          rx={2}
                          fill={meetsCutoff ? "#f59e0b" : "#94a3b8"}
                        />
                        <rect
                          x={xBase + 17}
                          y={185 - dniH}
                          width={15}
                          height={dniH}
                          rx={2}
                          fill="#10b981"
                          opacity={0.85}
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
                          x={xBase + 7}
                          y={180 - ghiH}
                          textAnchor="middle"
                          className="fill-slate-400 text-[9px] font-mono"
                        >
                          {m.ghi.toFixed(1)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Specific PV Yield & Ambient Thermal Derating */}
              <div className="space-y-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-base font-semibold">
                      Photovoltaic Specific Yield &amp; Capacity Summary
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Temperature-derated IEC cell model · Tilt {tiltDeg[0]}° · PR {performanceRatio[0]}%
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <AnimatedCircularProgressBar
                      max={100}
                      value={Math.round(solarData.solarSuitability.meanAhpScore * 100)}
                      gaugePrimaryColor="#f59e0b"
                      gaugeSecondaryColor="rgba(148,163,184,0.2)"
                      className="size-12 text-[11px]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      AHP Index
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-amber-400/20 via-transparent to-transparent" />
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Specific PV Yield
                    </div>
                    <div className="mt-1 font-mono text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                      <NumberTicker value={adjustedYield} decimalPlaces={0} />
                      <span className="ml-1 text-xs font-normal text-slate-500">kWh/kWp/yr</span>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-emerald-400/20 via-transparent to-transparent" />
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Suitable Land (C4–C5)
                    </div>
                    <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      <NumberTicker
                        value={solarData.solarSuitability.suitableLandAreaKm2}
                        decimalPlaces={0}
                      />
                      <span className="ml-1 text-xs font-normal text-slate-500">km²</span>
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-emerald-400/15 via-transparent to-transparent" />
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Installable Capacity
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                      <NumberTicker
                        value={solarData.solarSuitability.estimatedCapacityGw}
                        decimalPlaces={1}
                      />{" "}
                      GW
                    </div>
                  </div>
                  <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                    <Spotlight size={140} className="from-sky-400/15 via-transparent to-transparent" />
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Mean AHP Suitability
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                      <NumberTicker
                        value={solarData.solarSuitability.meanAhpScore}
                        decimalPlaces={3}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="suitability">
              <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <h3 className="mb-3 font-display text-base font-semibold">
                  Five-Class Solar Suitability Breakdown ({solarData.region.name})
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
                      {solarData.solarSuitability.classes.map((c) => (
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

            <TabsContent value="verification">
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#d5e0db] bg-white p-5 md:grid-cols-2 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                    <Satellite className="h-4 w-4" />
                    <span>Copernicus Sentinel-2 L2A STAC Verification</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">
                    Matched low-cloud scenes (&lt;25% cloud):{" "}
                    <span className="font-mono font-semibold">
                      {solarData.sentinel2Verification.matchedScenes}
                    </span>
                  </p>
                  <div className="space-y-1 font-mono text-[11px] text-slate-500">
                    {solarData.sentinel2Verification.sampleScenes.map((s) => (
                      <div key={s.id} className="truncate">
                        {s.id} · Cloud {s.cloudCoverPct?.toFixed(1)}%
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="font-semibold">SRTM 30m Topographic Summary</div>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <div>Mean Elevation: {solarData.resourceSummary.meanElevationM} m</div>
                    <div>Mean Slope: {solarData.resourceSummary.meanSlopeDeg}°</div>
                    <div>Mean Aspect: {solarData.resourceSummary.meanAspectDeg}°</div>
                    <div>CRS: {solarData.crs.projectedMetric}</div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )
      )}
    </div>
  );
}
