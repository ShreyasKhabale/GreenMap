import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Filter,
  Layers,
  MapPin,
  RefreshCw,
  Satellite,
  SlidersHorizontal,
} from "lucide-react";
import { IndiaMapLibre } from "@/components/maps/IndiaMapLibre";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { Spotlight } from "@/components/ui/spotlight";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_GIS_LAYERS, INDIA_REGIONS } from "@/data/indiaRenewableData";
import {
  fetchDistricts,
  fetchInstallationsGeoJson,
  fetchRegions,
  fetchRegionsGeoJson,
  runGisTile,
} from "@/lib/greenmapApi";
import type {
  ApiDistrictSummary,
  ApiRegionSummary,
  GeoJsonFeatureCollection,
  GisLayerConfig,
  GisTileResult,
  IndiaRegionRecord,
  PageId,
} from "@/types/greenmap";

interface GisExplorerPageProps {
  theme: "light" | "dark";
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
  onNavigate: (page: PageId) => void;
}

export function GisExplorerPage({
  theme,
  selectedRegion,
  onSelectRegion,
  onNavigate,
}: GisExplorerPageProps) {
  const [layers, setLayers] = useState<GisLayerConfig[]>(
    DEFAULT_GIS_LAYERS.map((l) => ({ ...l, dataStatus: "connected" }))
  );
  const [suitabilityMode, setSuitabilityMode] = useState<"solar" | "wind">("solar");
  const [allStates, setAllStates] = useState<ApiRegionSummary[]>([]);
  const [districts, setDistricts] = useState<ApiDistrictSummary[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>("__state_full__");
  const [slopeLimit, setSlopeLimit] = useState<number[]>([10]);
  const [loadingTile, setLoadingTile] = useState(false);
  const [tileResult, setTileResult] = useState<GisTileResult | null>(null);
  const [regionsGeoJson, setRegionsGeoJson] = useState<GeoJsonFeatureCollection | null>(null);
  const [installationsGeoJson, setInstallationsGeoJson] = useState<GeoJsonFeatureCollection | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchRegions(), fetchRegionsGeoJson(), fetchInstallationsGeoJson()])
      .then(([regRes, gjRes, instRes]) => {
        if (!active) return;
        setAllStates(regRes.regions);
        setRegionsGeoJson(gjRes);
        setInstallationsGeoJson(instRes);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Failed to load spatial catalog");
      });
    return () => {
      active = false;
    };
  }, []);

  // Load ADM2 districts when selected state changes
  useEffect(() => {
    let active = true;
    setSelectedDistrictId("__state_full__");
    fetchDistricts(selectedRegion.name)
      .then((res) => {
        if (active) setDistricts(res.districts);
      })
      .catch(() => {
        if (active) setDistricts([]);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.name]);

  const activeTargetId =
    selectedDistrictId !== "__state_full__" ? selectedDistrictId : selectedRegion.id;

  const executeTile = async (targetId: string, maxSlope: number) => {
    setLoadingTile(true);
    setErrorMsg(null);
    try {
      const res = await runGisTile({
        region_id: targetId,
        grid_size: 8,
        max_solar_slope_deg: maxSlope,
        max_wind_slope_deg: Math.max(maxSlope + 5, 15),
      });
      setTileResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "GIS tile computation failed");
    } finally {
      setLoadingTile(false);
    }
  };

  useEffect(() => {
    executeTile(activeTargetId, slopeLimit[0]);
  }, [activeTargetId]);

  const toggleLayerVisibility = (id: string) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === id ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  const updateLayerOpacity = (id: string, value: number) => {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, opacity: value } : layer))
    );
  };

  const activeBreakdown =
    suitabilityMode === "wind" ? tileResult?.windSuitability : tileResult?.solarSuitability;

  return (
    <div className="space-y-4">
      {/* Top Filter & State / District Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Filter className="h-3.5 w-3.5 text-[#0d4a3a] dark:text-emerald-400" />
            <span>Study Domain:</span>
          </div>

          <Select
            value={selectedRegion.id}
            onValueChange={(id) => {
              const foundApi = allStates.find((s) => s.id === id);
              const foundPreset = INDIA_REGIONS.find((r) => r.id === id);
              if (foundPreset) {
                onSelectRegion(foundPreset);
              } else if (foundApi) {
                onSelectRegion({
                  id: foundApi.id,
                  name: foundApi.name,
                  stateCode: foundApi.stateCode,
                  corridorName: `${foundApi.name} State Domain`,
                  focus: foundApi.focus,
                  centroid: foundApi.centroid,
                  bbox: foundApi.bbox,
                  elevationBand: "SRTM 30m Computed",
                  terrainClass: "GeoBoundaries ADM1",
                  publishedReferenceNote: "GeoBoundaries ADM1 + WRI verified state domain.",
                  publishedSolarPotentialGw: foundApi.publishedSolarPotentialGw,
                  publishedWindPotentialGw: foundApi.publishedWindPotentialGw,
                  referenceSource: "GeoBoundaries / WRI",
                  liveGisMetrics: {
                    status: "connected",
                    meanGhiKwhM2Day: null,
                    meanWindSpeedMs: null,
                    suitableAreaKm2: null,
                    estimatedCapacityGw: null,
                    ahpCompositeIndex: null,
                    endpointHint: `/api/v1/gis/tile/${foundApi.id}`,
                  },
                });
              }
            }}
          >
            <SelectTrigger className="h-9 w-[200px] text-xs">
              <SelectValue placeholder="Select Indian State" />
            </SelectTrigger>
            <SelectContent>
              {(allStates.length > 0 ? allStates : INDIA_REGIONS).map((region) => (
                <SelectItem key={region.id} value={region.id}>
                  {region.name} ({region.stateCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedDistrictId} onValueChange={setSelectedDistrictId}>
            <SelectTrigger className="h-9 w-[210px] text-xs">
              <SelectValue placeholder="All Districts (Statewide)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__state_full__">Entire State (ADM1)</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.areaKm2.toFixed(0)} km²)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1 rounded-lg bg-[#eef4f1] p-1 dark:bg-[#07111e]">
            <AnimatedBackground
              defaultValue={suitabilityMode}
              onValueChange={(val) => {
                if (val === "solar" || val === "wind") setSuitabilityMode(val);
              }}
              className="rounded-md bg-white shadow-sm dark:bg-[#12263d]"
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
            >
              {(["solar", "wind"] as const).map((mode) => (
                <button
                  key={mode}
                  data-id={mode}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    suitabilityMode === mode
                      ? "text-[#0d4a3a] dark:text-emerald-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {mode} 5-Class
                </button>
              ))}
            </AnimatedBackground>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help text-slate-500 underline decoration-dotted underline-offset-4 dark:text-slate-400 whitespace-nowrap">
                  Max Slope:
                </span>
              </TooltipTrigger>
              <TooltipContent>
                SRTM 30m topographic slope exclusion threshold in degrees
              </TooltipContent>
            </Tooltip>
            <div className="w-24">
              <Slider
                value={slopeLimit}
                min={2}
                max={20}
                step={1}
                onValueChange={setSlopeLimit}
              />
            </div>
            <span className="font-mono font-medium tabular-nums text-[#0b192c] dark:text-emerald-300">
              &le; {slopeLimit[0]}°
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => executeTile(activeTargetId, slopeLimit[0])}
            disabled={loadingTile}
            className="h-8 border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
          >
            <RefreshCw className={`mr-1.5 h-3 w-3 ${loadingTile ? "animate-spin" : ""}`} />
            Recompute
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-500/40 bg-red-50/80 px-4 py-2.5 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Main 3-Column GIS Workspace */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Layer Controls Panel */}
        <aside className="space-y-4 rounded-xl border border-[#d5e0db] bg-white p-4 xl:col-span-3 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <div className="flex items-center justify-between border-b border-[#d5e0db] pb-3 dark:border-[#1a3048]">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
              <h2 className="font-display text-sm font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                GIS Layer Stack
              </h2>
            </div>
            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
              Live Pipeline
            </span>
          </div>

          <div className="space-y-3">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className="space-y-2.5 rounded-lg border border-[#d5e0db]/80 bg-[#f5f8f6]/70 p-3 dark:border-[#1a3048] dark:bg-[#07111e]/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-[#0b192c] dark:text-[#e6f0ec]">
                      {layer.label}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>{layer.resolution}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Active
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={layer.visible}
                    onCheckedChange={() => toggleLayerVisibility(layer.id)}
                    aria-label={`Toggle ${layer.label}`}
                  />
                </div>

                {layer.visible && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        Opacity
                      </span>
                      <span className="font-mono tabular-nums">
                        {Math.round(layer.opacity * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[Math.round(layer.opacity * 100)]}
                      min={15}
                      max={100}
                      step={5}
                      onValueChange={([v]) => updateLayerOpacity(layer.id, v / 100)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {tileResult && (
            <div className="space-y-1.5 rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-3 text-[11px] dark:border-[#1a3048] dark:bg-[#07111e]">
              <div className="flex items-center gap-1.5 font-medium text-[#0b192c] dark:text-emerald-300">
                <Satellite className="h-3.5 w-3.5" />
                <span>Copernicus Sentinel-2 L2A</span>
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                Matched Scenes (&lt;25% cloud):{" "}
                <span className="font-mono font-semibold text-[#0b192c] dark:text-slate-200">
                  {tileResult.sentinel2Verification.matchedScenes}
                </span>
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                OSM Substations: {tileResult.osmInfrastructure.counts.substations ?? 0} · WRI Plants:{" "}
                {tileResult.osmInfrastructure.wriNearbyPlants}
              </div>
            </div>
          )}
        </aside>

        {/* Central MapLibre GL JS Map */}
        <div className="xl:col-span-6">
          <IndiaMapLibre
            theme={theme}
            selectedRegionId={selectedRegion.id}
            onSelectRegion={onSelectRegion}
            layers={layers}
            regionsGeoJson={regionsGeoJson}
            installationsGeoJson={installationsGeoJson}
            suitabilityGeoJson={tileResult?.suitabilityGeoJson ?? null}
            suitabilityMode={suitabilityMode}
            focusBbox={tileResult?.region.bbox ?? selectedRegion.bbox}
            heightClass="h-[580px] xl:h-[670px]"
            isLoadingOverlay={loadingTile}
          />
        </div>

        {/* Right Location Information Panel */}
        <aside className="relative flex flex-col justify-between space-y-4 overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 xl:col-span-3 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <GlowingEffect
            spread={30}
            glow={true}
            disabled={false}
            proximity={56}
            inactiveZone={0.01}
            borderWidth={1.5}
          />
          <Spotlight
            size={200}
            className="from-emerald-400/15 via-sky-400/5 to-transparent"
          />
          <div className="relative z-10 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-[#d5e0db] pb-3 dark:border-[#1a3048]">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{tileResult?.region.admLevel ?? "ADM1"} Domain</span>
                </div>
                <h2 className="mt-0.5 font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                  {tileResult?.region.name ?? selectedRegion.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tileResult?.region.parentState ?? selectedRegion.corridorName}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    EPSG:7755
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  India NSF / LCC equal-area metric projection used for km² calculations
                </TooltipContent>
              </Tooltip>
            </div>

            {tileResult && (
              <>
                <dl className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-lg bg-[#f5f8f6] p-2.5 dark:bg-[#07111e]">
                    <dt className="text-slate-500 dark:text-slate-400">Mean GHI</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                      {tileResult.resourceSummary.meanGhiKwhM2Day} kWh/m²/d
                    </dd>
                  </div>
                  <div className="rounded-lg bg-[#f5f8f6] p-2.5 dark:bg-[#07111e]">
                    <dt className="text-slate-500 dark:text-slate-400">Wind 100m</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                      {tileResult.resourceSummary.meanWs100mMs} m/s
                    </dd>
                  </div>
                  <div className="rounded-lg bg-[#f5f8f6] p-2.5 dark:bg-[#07111e]">
                    <dt className="text-slate-500 dark:text-slate-400">Mean Elev / Slope</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                      {tileResult.resourceSummary.meanElevationM}m · {tileResult.resourceSummary.meanSlopeDeg}°
                    </dd>
                  </div>
                  <div className="rounded-lg bg-[#f5f8f6] p-2.5 dark:bg-[#07111e]">
                    <dt className="text-slate-500 dark:text-slate-400">Grid / Road Dist</dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                      {tileResult.resourceSummary.meanDistPowerKm} / {tileResult.resourceSummary.meanDistRoadKm} km
                    </dd>
                  </div>
                </dl>

                {/* 5-Class Suitability Summary + Radial Gauge */}
                {activeBreakdown && (
                  <div className="space-y-3 rounded-lg border border-[#d5e0db] p-3 dark:border-[#1a3048]">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold capitalize">
                          {suitabilityMode} 5-Class Areas
                        </div>
                        <div className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          {activeBreakdown.estimatedCapacityGw} GW · {activeBreakdown.suitableLandAreaKm2.toLocaleString()} km²
                        </div>
                      </div>
                      <AnimatedCircularProgressBar
                        max={100}
                        value={
                          tileResult.region.areaKm2 > 0
                            ? Math.round(
                                (activeBreakdown.suitableLandAreaKm2 /
                                  tileResult.region.areaKm2) *
                                  100
                              )
                            : 0
                        }
                        gaugePrimaryColor={suitabilityMode === "wind" ? "#0284c7" : "#10b981"}
                        gaugeSecondaryColor={
                          theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.08)"
                        }
                        className="size-12 text-[11px]"
                      />
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      {activeBreakdown.classes.map((cls) => (
                        <div key={cls.classId} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 truncate text-slate-600 dark:text-slate-300">
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: cls.color }}
                            />
                            C{cls.classId} {cls.label}
                          </span>
                          <span className="font-mono tabular-nums text-[#0b192c] dark:text-slate-200">
                            {cls.areaKm2.toLocaleString()} km²
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg bg-emerald-50/70 px-3 py-2 text-left text-[11px] text-emerald-900 transition-colors hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/50 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          GeoTIFFs: {Object.keys(tileResult.rasterOutputs).length} layers · STAC{" "}
                          {tileResult.sentinel2Verification.matchedScenes} scenes
                        </span>
                      </span>
                      <span className="font-mono underline">Inspect</span>
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>
                        GeoTIFF &amp; Sentinel-2 Telemetry — {tileResult.region.name}
                      </DialogTitle>
                      <DialogDescription>
                        CRS: {tileResult.crs.storage} &rarr; {tileResult.crs.projectedMetric} ·
                        Executed {tileResult.pipelineStepsExecuted.length}/9 spatial pipeline stages.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 text-xs">
                      <div className="space-y-1.5">
                        <div className="font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                          Generated Raster Outputs (COG / GeoTIFF)
                        </div>
                        <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-2.5 font-mono text-[11px] dark:border-[#1a3048] dark:bg-[#07111e]">
                          {Object.entries(tileResult.rasterOutputs).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3">
                              <span className="text-emerald-700 dark:text-emerald-400">{k}</span>
                              <span className="truncate text-slate-600 dark:text-slate-300">
                                {v}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                          Copernicus Sentinel-2 L2A STAC Scenes ({tileResult.sentinel2Verification.matchedScenes})
                        </div>
                        <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-2.5 font-mono text-[11px] dark:border-[#1a3048] dark:bg-[#07111e]">
                          {tileResult.sentinel2Verification.sampleScenes.map((scene) => (
                            <div key={scene.id} className="flex justify-between gap-2">
                              <span className="truncate">{scene.id}</span>
                              <span className="shrink-0 text-slate-500">
                                Cloud {scene.cloudCoverPct?.toFixed(1) ?? "—"}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>

          <div className="relative z-10 flex flex-col gap-2 border-t border-[#d5e0db] pt-3 dark:border-[#1a3048]">
            <Button
              size="sm"
              onClick={() => onNavigate("solar-analysis")}
              className="w-full bg-[#0d4a3a] text-white hover:bg-[#09382b] dark:bg-emerald-500 dark:text-[#041e16] cursor-pointer"
            >
              <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
              Inspect Solar / Wind Profiles
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate("reports")}
              className="w-full border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
            >
              Export PDF Dossier
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
