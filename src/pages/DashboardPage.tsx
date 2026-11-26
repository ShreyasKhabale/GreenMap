import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Compass, Globe2, Loader2, Play, Sun, Wind } from "lucide-react";
import { NumberTicker } from "@/components/ui/number-ticker";
import { MagicCard } from "@/components/ui/magic-card";
import { Spotlight } from "@/components/ui/spotlight";
import { BorderBeam } from "@/components/ui/border-beam";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import { Button } from "@/components/ui/button";
import { IndiaMapLibre } from "@/components/maps/IndiaMapLibre";
import { INDIA_REGIONS } from "@/data/indiaRenewableData";
import {
  enqueueGisJob,
  enqueueMlJob,
  fetchJobs,
  fetchRegions,
  fetchRegionsGeoJson,
  runGisTile,
} from "@/lib/greenmapApi";
import type {
  ApiRegionSummary,
  AsyncJobRecord,
  GeoJsonFeatureCollection,
  GisTileResult,
  IndiaRegionRecord,
  PageId,
} from "@/types/greenmap";

interface DashboardPageProps {
  theme: "light" | "dark";
  onNavigate: (page: PageId) => void;
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
}

export function DashboardPage({
  theme,
  onNavigate,
  selectedRegion,
  onSelectRegion,
}: DashboardPageProps) {
  const [apiRegions, setApiRegions] = useState<ApiRegionSummary[]>([]);
  const [regionsGeoJson, setRegionsGeoJson] = useState<GeoJsonFeatureCollection | null>(null);
  const [tileResult, setTileResult] = useState<GisTileResult | null>(null);
  const [jobs, setJobs] = useState<AsyncJobRecord[]>([]);
  const [loadingTile, setLoadingTile] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [filterFocus, setFilterFocus] = useState<"all" | "solar" | "wind" | "hybrid">("all");

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetchJobs(8);
      setJobs(res.jobs);
    } catch {
      // ignore transient polling failure
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetchRegions(), fetchRegionsGeoJson(), fetchJobs(8)])
      .then(([regRes, gjRes, jobsRes]) => {
        if (!active) return;
        setApiRegions(regRes.regions);
        setRegionsGeoJson(gjRes);
        setJobs(jobsRes.jobs);
      })
      .catch((err) => {
        if (active) setApiError(err instanceof Error ? err.message : "Backend unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingTile(true);
    setApiError(null);
    runGisTile({ region_id: selectedRegion.id, grid_size: 8 })
      .then((res) => {
        if (active) setTileResult(res);
      })
      .catch((err) => {
        if (active) setApiError(err instanceof Error ? err.message : "GIS tile request failed");
      })
      .finally(() => {
        if (active) setLoadingTile(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.id]);

  // Poll active background jobs while any job is queued/running
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      loadJobs();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  const handleQueueGisJob = async () => {
    try {
      const job = await enqueueGisJob(selectedRegion.id, 8);
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to enqueue GIS job");
    }
  };

  const handleQueueMlJob = async () => {
    try {
      const job = await enqueueMlJob("hybrid");
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to enqueue ML job");
    }
  };

  const totalPublishedSolarGw = INDIA_REGIONS.reduce(
    (sum, r) => sum + (r.publishedSolarPotentialGw ?? 0),
    0
  );
  const totalPublishedWindGw = INDIA_REGIONS.reduce(
    (sum, r) => sum + (r.publishedWindPotentialGw ?? 0),
    0
  );

  const displayedRegions =
    apiRegions.length > 0
      ? filterFocus === "all"
        ? apiRegions
        : apiRegions.filter((r) => r.focus === filterFocus)
      : [];

  return (
    <div className="space-y-6">
      {apiError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
          FastAPI GIS/ML notice: {apiError}
        </div>
      )}

      {/* Top 4 Live Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MagicCard
          gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
          gradientFrom="#f59e0b"
          gradientTo="#10b981"
          className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
        >
          <Spotlight
            size={180}
            className="from-amber-400/20 via-emerald-400/10 to-transparent"
          />
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {selectedRegion.name} Mean GHI (NASA)
            </span>
            <Sun className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            {tileResult ? (
              <>
                <NumberTicker
                  value={tileResult.resourceSummary.meanGhiKwhM2Day}
                  decimalPlaces={2}
                  className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]"
                />
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  kWh/m²/d
                </span>
              </>
            ) : (
              <span className="font-mono text-xl text-slate-400">Loading...</span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            National MNRE Ref: {totalPublishedSolarGw.toFixed(1)} GW across priority corridors
          </p>
        </MagicCard>

        <MagicCard
          gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
          gradientFrom="#0284c7"
          gradientTo="#10b981"
          className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
        >
          <Spotlight
            size={180}
            className="from-sky-400/20 via-emerald-400/10 to-transparent"
          />
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {selectedRegion.name} Wind 100m
            </span>
            <Wind className="h-4 w-4 text-sky-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            {tileResult ? (
              <>
                <NumberTicker
                  value={tileResult.resourceSummary.meanWs100mMs}
                  decimalPlaces={2}
                  className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]"
                />
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">m/s</span>
              </>
            ) : (
              <span className="font-mono text-xl text-slate-400">Loading...</span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            NIWE Ref: {totalPublishedWindGw.toFixed(1)} GW · WPD{" "}
            {tileResult?.resourceSummary.wpd100mWM2 ?? "—"} W/m²
          </p>
        </MagicCard>

        <MagicCard
          gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
          gradientFrom="#10b981"
          gradientTo="#059669"
          className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
        >
          <Spotlight
            size={180}
            className="from-emerald-400/20 via-teal-400/10 to-transparent"
          />
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Suitable Land Area (Solar C4–C5)
            </span>
            <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            {tileResult ? (
              <>
                <NumberTicker
                  value={tileResult.solarSuitability.suitableLandAreaKm2}
                  decimalPlaces={0}
                  className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]"
                />
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">km²</span>
              </>
            ) : (
              <span className="font-mono text-xl text-slate-400">Computing...</span>
            )}
          </div>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
            Projected EPSG:7755 · Total {tileResult?.region.areaKm2.toLocaleString() ?? "—"} km²
          </p>
        </MagicCard>

        <MagicCard
          gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
          gradientFrom="#10b981"
          gradientTo="#0d4a3a"
          className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
        >
          <Spotlight
            size={180}
            className="from-emerald-400/20 via-sky-400/10 to-transparent"
          />
          <div className="flex items-start justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Estimated Installable Capacity
            </span>
            <Globe2 className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            {tileResult ? (
              <>
                <NumberTicker
                  value={tileResult.solarSuitability.estimatedCapacityGw}
                  decimalPlaces={1}
                  className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]"
                />
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  GW Solar
                </span>
              </>
            ) : (
              <span className="font-mono text-xl text-slate-400">Computing...</span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Wind Suitability: {tileResult?.windSuitability.estimatedCapacityGw ?? "—"} GW (5 MW/km²)
          </p>
        </MagicCard>
      </div>

      {/* Main Split: India Geographical Overview + Async Analysis Jobs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="relative space-y-4 overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 lg:col-span-7 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <BorderBeam
            size={140}
            duration={10}
            colorFrom="#10b981"
            colorTo="#0284c7"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                India Geographical Overview (5-Class Suitability Tile)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real GeoBoundaries ADM1 + SRTM 30m + NASA POWER + OSM Overpass overlay.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate("gis-explorer")}
              className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
            >
              Full GIS Explorer
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>

          <IndiaMapLibre
            theme={theme}
            selectedRegionId={selectedRegion.id}
            onSelectRegion={onSelectRegion}
            regionsGeoJson={regionsGeoJson}
            suitabilityGeoJson={tileResult?.suitabilityGeoJson ?? null}
            suitabilityMode="solar"
            isLoadingOverlay={loadingTile}
            heightClass="h-[360px]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d5e0db] pt-3 text-xs dark:border-[#1a3048]">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Active Region: </span>
              <span className="font-semibold text-[#0b192c] dark:text-emerald-300">
                {selectedRegion.name} ({selectedRegion.corridorName})
              </span>
            </div>
            <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
              {selectedRegion.centroid[1].toFixed(2)}°N, {selectedRegion.centroid[0].toFixed(2)}°E
            </span>
          </div>
        </div>

        {/* Asynchronous Analysis Job Queue */}
        <div className="relative flex flex-col justify-between rounded-xl border border-[#d5e0db] bg-white p-5 lg:col-span-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <GlowingEffect
            spread={32}
            glow={true}
            disabled={false}
            proximity={56}
            inactiveZone={0.01}
            borderWidth={1.5}
          />
          <div className="relative z-10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                  Async GIS &amp; ML Job History
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Persisted background tasks via FastAPI &amp; spatial DB
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={handleQueueGisJob}
                  className="bg-[#0d4a3a] text-white hover:bg-[#09382b] dark:bg-emerald-500 dark:text-[#041e16] cursor-pointer"
                >
                  <Play className="mr-1 h-3 w-3" />
                  Run GIS Job
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleQueueMlJob}
                  className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
                >
                  Train ML
                </Button>
              </div>
            </div>

            <div className="divide-y divide-[#d5e0db] dark:divide-[#1a3048]">
              {jobs.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No background jobs recorded yet. Click &ldquo;Run GIS Job&rdquo; or &ldquo;Train ML&rdquo;.
                </div>
              ) : (
                jobs.slice(0, 5).map((job) => (
                  <div key={job.job_id} className="space-y-1 py-3 first:pt-1 last:pb-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-[#0b192c] dark:text-[#e6f0ec]">
                        {job.job_type}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] whitespace-nowrap">
                        {job.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> completed
                          </span>
                        ) : job.status === "failed" ? (
                          <span className="text-red-600 dark:text-red-400">failed</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
                            <Loader2 className="h-3 w-3 animate-spin" /> {job.status}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Region: {job.region_id ?? "national"}</span>
                      <span className="font-mono text-[11px]">
                        {new Date(job.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="relative z-10 mt-4 flex items-center justify-between gap-4 border-t border-[#d5e0db] pt-4 dark:border-[#1a3048]">
            <div className="flex items-center gap-3">
              <AnimatedCircularProgressBar
                max={9}
                value={tileResult?.pipelineStepsExecuted.length ?? 0}
                gaugePrimaryColor="#10b981"
                gaugeSecondaryColor={theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.08)"}
                displayText={`${tileResult?.pipelineStepsExecuted.length ?? 0}/9`}
                className="size-14 text-xs"
              />
              <div className="text-xs">
                <div className="font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                  GIS Pipeline Steps
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Sentinel-2 Scenes: {tileResult?.sentinel2Verification.matchedScenes ?? 0}
                </div>
              </div>
            </div>

            {tileResult && (
              <div className="flex items-center gap-3">
                <AnimatedCircularProgressBar
                  max={100}
                  value={
                    tileResult.region.areaKm2 > 0
                      ? Math.round(
                          (tileResult.solarSuitability.suitableLandAreaKm2 /
                            tileResult.region.areaKm2) *
                            100
                        )
                      : 0
                  }
                  gaugePrimaryColor="#0284c7"
                  gaugeSecondaryColor={theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.08)"}
                  className="size-14 text-xs"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    C4–C5 Land Share
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    {selectedRegion.stateCode} Domain
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* All India States Table (GeoBoundaries ADM1 + WRI + MNRE/NIWE) */}
      <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
              All-India State Coverage (GeoBoundaries ADM1 + WRI Verified Installations)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any state to execute the 9-step GIS tile pipeline. Showing {displayedRegions.length} Indian states/UTs.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-[#eef4f1] p-1 dark:bg-[#07111e]">
            <AnimatedBackground
              defaultValue={filterFocus}
              onValueChange={(val) => {
                if (val) setFilterFocus(val as "all" | "solar" | "wind" | "hybrid");
              }}
              className="rounded-md bg-white shadow-sm dark:bg-[#12263d]"
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
            >
              {(["all", "solar", "wind", "hybrid"] as const).map((focus) => (
                <button
                  key={focus}
                  data-id={focus}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    filterFocus === focus
                      ? "text-[#0b192c] dark:text-emerald-300"
                      : "text-slate-600 hover:text-[#0b192c] dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {focus}
                </button>
              ))}
            </AnimatedBackground>
          </div>
        </div>

        <div className="max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-white dark:bg-[#0c1b2e]">
              <tr className="border-b border-[#d5e0db] text-xs text-slate-500 dark:border-[#1a3048] dark:text-slate-400">
                <th className="py-2.5 pr-4 font-medium">State / UT</th>
                <th className="py-2.5 pr-4 text-right font-medium">Area (km²)</th>
                <th className="py-2.5 pr-4 text-right font-medium">WRI Solar</th>
                <th className="py-2.5 pr-4 text-right font-medium">WRI Wind</th>
                <th className="py-2.5 pr-4 text-right font-medium">MNRE Solar (GW)</th>
                <th className="py-2.5 text-right font-medium">NIWE Wind (GW)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
              {displayedRegions.map((region) => (
                <tr
                  key={region.id}
                  onClick={() => {
                    const preset = INDIA_REGIONS.find((r) => r.id === region.id);
                    onSelectRegion(
                      preset ?? {
                        id: region.id,
                        name: region.name,
                        stateCode: region.stateCode,
                        corridorName: `${region.name} State Domain`,
                        focus: region.focus,
                        centroid: region.centroid,
                        bbox: region.bbox,
                        elevationBand: "SRTM 30m Computed",
                        terrainClass: "GeoBoundaries ADM1",
                        publishedReferenceNote: "GeoBoundaries ADM1 + WRI verified state domain.",
                        publishedSolarPotentialGw: region.publishedSolarPotentialGw,
                        publishedWindPotentialGw: region.publishedWindPotentialGw,
                        referenceSource: "GeoBoundaries / WRI / MNRE",
                        liveGisMetrics: {
                          status: "connected",
                          meanGhiKwhM2Day: null,
                          meanWindSpeedMs: null,
                          suitableAreaKm2: null,
                          estimatedCapacityGw: null,
                          ahpCompositeIndex: null,
                          endpointHint: `/api/v1/gis/tile/${region.id}`,
                        },
                      }
                    );
                  }}
                  className={`cursor-pointer transition-colors hover:bg-[#f5f8f6] dark:hover:bg-[#112236] ${
                    selectedRegion.id === region.id
                      ? "bg-emerald-50/70 dark:bg-emerald-950/25"
                      : ""
                  }`}
                >
                  <td className="py-2.5 pr-4 font-medium text-[#0b192c] dark:text-[#e6f0ec]">
                    {region.name}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                    {region.areaKm2.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                    {region.wriVerifiedInstallations.solarCount} (
                    {region.wriVerifiedInstallations.solarCapacityMw.toFixed(0)} MW)
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                    {region.wriVerifiedInstallations.windCount} (
                    {region.wriVerifiedInstallations.windCapacityMw.toFixed(0)} MW)
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">
                    {region.publishedSolarPotentialGw !== null
                      ? region.publishedSolarPotentialGw.toFixed(2)
                      : "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-xs tabular-nums">
                    {region.publishedWindPotentialGw !== null
                      ? region.publishedWindPotentialGw.toFixed(2)
                      : "—"}
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
