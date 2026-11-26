import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSourceSpecification,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Compass, Layers, Loader2, Minus, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { INDIA_CORRIDORS_GEOJSON, INDIA_REGIONS } from "@/data/indiaRenewableData";
import type { GisLayerConfig, IndiaRegionRecord } from "@/types/greenmap";
import { cn } from "@/lib/utils";
import { fetchSafeJson } from "@/lib/greenmapApi";

setWorkerUrl(maplibreWorkerUrl);

interface IndiaMapLibreProps {
  theme: "light" | "dark";
  selectedRegionId: string | null;
  onSelectRegion: (region: IndiaRegionRecord) => void;
  layers?: GisLayerConfig[];
  suitabilityGeoJson?: GeoJSONSourceSpecification["data"] | null;
  suitabilityMode?: "solar" | "wind";
  regionsGeoJson?: GeoJSONSourceSpecification["data"] | null;
  installationsGeoJson?: GeoJSONSourceSpecification["data"] | null;
  focusBbox?: [number, number, number, number] | null;
  heightClass?: string;
  interactiveControls?: boolean;
  isLoadingOverlay?: boolean;
  className?: string;
}

interface BasemapAuthStatus {
  provider: string;
  keyConfigured: boolean;
  watermarkFree: boolean;
  attribution: string;
  gisBackendStatus: string;
  databaseEngine?: string | null;
  rasterCogStatus: string;
}

interface InspectedCell {
  solarClass: number;
  windClass: number;
  solarScore: number;
  windScore: number;
  ghi: number;
  ws100m: number;
  slopeDeg: number;
  elevM: number;
}

const INDIA_CENTER: [number, number] = [78.9629, 21.8];
const INDIA_DEFAULT_ZOOM = 4.05;

function toAbsoluteUrl(urlOrPath: string): string {
  if (urlOrPath.startsWith("/")) {
    return `${window.location.origin}${urlOrPath}`;
  }
  return urlOrPath;
}

function resolveStyleAssetUrls(style: StyleSpecification): StyleSpecification {
  const cloned: StyleSpecification = JSON.parse(JSON.stringify(style));
  if (cloned.sources) {
    for (const src of Object.values(cloned.sources)) {
      if ("tiles" in src && Array.isArray(src.tiles)) {
        src.tiles = src.tiles.map(toAbsoluteUrl);
      }
      if ("url" in src && typeof src.url === "string") {
        src.url = toAbsoluteUrl(src.url);
      }
    }
  }
  if (typeof cloned.sprite === "string") {
    cloned.sprite = toAbsoluteUrl(cloned.sprite);
  }
  if (typeof cloned.glyphs === "string") {
    cloned.glyphs = toAbsoluteUrl(cloned.glyphs);
  }
  return cloned;
}

function buildAuthenticatedRasterFallbackStyle(theme: "light" | "dark"): StyleSpecification {
  const isDark = theme === "dark";
  const rasterStyleName = isDark ? "dark_all" : "light_all";
  const tileUrl = `${window.location.origin}/api/basemap/raster/${rasterStyleName}/{z}/{x}/{y}@2x.png`;

  return {
    version: 8,
    sources: {
      "carto-basemap": {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/about-carto/">CARTO</a>',
      },
    },
    layers: [
      {
        id: "background-canvas",
        type: "background",
        paint: {
          "background-color": isDark ? "#07111e" : "#eef4f1",
        },
      },
      {
        id: "carto-raster-layer",
        type: "raster",
        source: "carto-basemap",
        paint: {
          "raster-opacity": isDark ? 0.9 : 0.95,
        },
      },
    ],
  };
}

export function IndiaMapLibre({
  theme,
  selectedRegionId,
  onSelectRegion,
  layers,
  suitabilityGeoJson = null,
  suitabilityMode = "solar",
  regionsGeoJson = null,
  installationsGeoJson = null,
  focusBbox = null,
  heightClass = "h-[540px]",
  interactiveControls = true,
  isLoadingOverlay = false,
  className,
}: IndiaMapLibreProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onSelectRef = useRef(onSelectRegion);
  const [mapReady, setMapReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(INDIA_DEFAULT_ZOOM);
  const [pitchEnabled, setPitchEnabled] = useState(false);
  const [basemapStatus, setBasemapStatus] = useState<BasemapAuthStatus | null>(null);
  const [inspectedCell, setInspectedCell] = useState<InspectedCell | null>(null);

  onSelectRef.current = onSelectRegion;

  const vectorVisible =
    layers?.find((l) => l.id === "india-state-boundaries")?.visible ?? true;
  const vectorOpacity =
    layers?.find((l) => l.id === "india-state-boundaries")?.opacity ?? 0.75;
  const solarLayerVisible =
    layers?.find((l) => l.id === "solar-ghi-raster")?.visible ?? true;
  const solarLayerOpacity =
    layers?.find((l) => l.id === "solar-ghi-raster")?.opacity ?? 0.72;
  const windLayerVisible =
    layers?.find((l) => l.id === "wind-100m-raster")?.visible ?? false;
  const windLayerOpacity =
    layers?.find((l) => l.id === "wind-100m-raster")?.opacity ?? 0.72;
  const gridLayerVisible =
    layers?.find((l) => l.id === "hv-grid-substations")?.visible ?? true;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const initMap = async () => {
      try {
        const statusJson = await fetchSafeJson<BasemapAuthStatus>("/api/basemap/status");
        if (!cancelled) {
          setBasemapStatus(statusJson);
        }
      } catch {
        // Non-blocking status check
      }

      let resolvedStyle: StyleSpecification;
      try {
        const rawStyle = await fetchSafeJson<StyleSpecification>(`/api/basemap/style/${theme}.json`);
        resolvedStyle = resolveStyleAssetUrls(rawStyle);
      } catch {
        resolvedStyle = buildAuthenticatedRasterFallbackStyle(theme);
      }

      if (cancelled || !containerRef.current) return;

      const map = new MapLibreMap({
        container: containerRef.current,
        style: resolvedStyle,
        center: INDIA_CENTER,
        zoom: INDIA_DEFAULT_ZOOM,
        minZoom: 3.2,
        maxZoom: 12,
        attributionControl: { compact: false },
      });

      mapRef.current = map;

      map.on("zoom", () => {
        setZoomLevel(Number(map.getZoom().toFixed(2)));
      });

      map.on("error", (err) => {
        if (err?.error?.message?.includes("Worker")) {
          console.error("MapLibre worker error:", err.error);
        }
        setMapReady(true);
      });

      const addIndiaVectorLayers = () => {
        if (!map.getSource("india-corridors")) {
          map.addSource("india-corridors", {
            type: "geojson",
            data: INDIA_CORRIDORS_GEOJSON as unknown as GeoJSONSourceSpecification["data"],
          });
        }

        if (!map.getSource("india-adm1-real")) {
          map.addSource("india-adm1-real", {
            type: "geojson",
            data: (regionsGeoJson ?? { type: "FeatureCollection", features: [] }) as GeoJSONSourceSpecification["data"],
          });
        }

        if (!map.getSource("suitability-tiles")) {
          map.addSource("suitability-tiles", {
            type: "geojson",
            data: (suitabilityGeoJson ?? { type: "FeatureCollection", features: [] }) as GeoJSONSourceSpecification["data"],
          });
        }

        if (!map.getSource("wri-installations")) {
          map.addSource("wri-installations", {
            type: "geojson",
            data: (installationsGeoJson ?? { type: "FeatureCollection", features: [] }) as GeoJSONSourceSpecification["data"],
          });
        }

        if (!map.getLayer("india-adm1-outline")) {
          map.addLayer({
            id: "india-adm1-outline",
            type: "line",
            source: "india-adm1-real",
            paint: {
              "line-color": theme === "dark" ? "#34d399" : "#0d4a3a",
              "line-width": 1.1,
              "line-opacity": vectorVisible ? 0.55 * vectorOpacity : 0,
            },
          });
        }

        if (!map.getLayer("india-national-outline")) {
          map.addLayer({
            id: "india-national-outline",
            type: "line",
            source: "india-corridors",
            filter: ["==", ["get", "kind"], "national_outline"],
            paint: {
              "line-color": theme === "dark" ? "#34d399" : "#0d4a3a",
              "line-width": 1.4,
              "line-opacity": 0.45,
            },
          });
        }

        if (!map.getLayer("corridor-fill")) {
          map.addLayer({
            id: "corridor-fill",
            type: "fill",
            source: "india-corridors",
            filter: ["==", ["get", "kind"], "corridor_zone"],
            paint: {
              "fill-color": [
                "match",
                ["get", "focus"],
                "solar",
                "#f59e0b",
                "wind",
                "#0284c7",
                "#10b981",
              ],
              "fill-opacity": vectorVisible ? 0.1 * vectorOpacity : 0,
            },
          });
        }

        if (!map.getLayer("suitability-fill")) {
          map.addLayer({
            id: "suitability-fill",
            type: "fill",
            source: "suitability-tiles",
            paint: {
              "fill-color": [
                "match",
                ["get", suitabilityMode === "wind" ? "windClass" : "solarClass"],
                5,
                "#059669",
                4,
                "#22c55e",
                3,
                "#eab308",
                2,
                "#f97316",
                "#475569",
              ],
              "fill-opacity": 0.72,
            },
          });
        }

        if (!map.getLayer("suitability-outline")) {
          map.addLayer({
            id: "suitability-outline",
            type: "line",
            source: "suitability-tiles",
            paint: {
              "line-color": theme === "dark" ? "#0f172a" : "#ffffff",
              "line-width": 0.65,
              "line-opacity": 0.6,
            },
          });
        }

        if (!map.getLayer("wri-installations-circle")) {
          map.addLayer({
            id: "wri-installations-circle",
            type: "circle",
            source: "wri-installations",
            paint: {
              "circle-radius": 4.2,
              "circle-color": [
                "match",
                ["get", "fuel"],
                "Solar",
                "#f59e0b",
                "Wind",
                "#38bdf8",
                "#10b981",
              ],
              "circle-stroke-width": 1,
              "circle-stroke-color": "#07111e",
              "circle-opacity": gridLayerVisible ? 0.9 : 0,
              "circle-stroke-opacity": gridLayerVisible ? 0.9 : 0,
            },
          });
        }

        setMapReady(true);
      };

      map.on("click", "suitability-fill", (e: MapLayerMouseEvent) => {
        const props = e.features?.[0]?.properties;
        if (props) {
          setInspectedCell({
            solarClass: Number(props.solarClass ?? 1),
            windClass: Number(props.windClass ?? 1),
            solarScore: Number(props.solarScore ?? 0),
            windScore: Number(props.windScore ?? 0),
            ghi: Number(props.ghi ?? 0),
            ws100m: Number(props.ws100m ?? 0),
            slopeDeg: Number(props.slopeDeg ?? 0),
            elevM: Number(props.elevM ?? 0),
          });
        }
      });

      map.on("mouseenter", "suitability-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "suitability-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "corridor-fill", (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id;
        const found = INDIA_REGIONS.find((r) => r.id === id);
        if (found) {
          onSelectRef.current(found);
        }
      });

      map.on("load", addIndiaVectorLayers);
      map.on("style.load", addIndiaVectorLayers);

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      INDIA_REGIONS.forEach((region) => {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `Select ${region.name}`);
        el.className =
          "group relative flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-[#0d4a3a] text-[10px] font-mono font-semibold text-white shadow-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer dark:border-[#07111e] dark:bg-emerald-500 dark:text-[#041e16]";
        el.textContent = region.stateCode;

        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          onSelectRef.current(region);
        });

        const marker = new Marker({ element: el })
          .setLngLat(region.centroid)
          .addTo(map);

        markersRef.current.push(marker);
      });
    };

    initMap();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, [theme]);

  // Update dynamic GeoJSON sources without rebuilding MapLibre instance
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("suitability-tiles") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData) {
      src.setData(suitabilityGeoJson ?? { type: "FeatureCollection", features: [] });
      setInspectedCell(null);
    }
  }, [mapReady, suitabilityGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("india-adm1-real") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData && regionsGeoJson) {
      src.setData(regionsGeoJson);
    }
  }, [mapReady, regionsGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("wri-installations") as { setData?: (d: unknown) => void } | undefined;
    if (src?.setData && installationsGeoJson) {
      src.setData(installationsGeoJson);
    }
  }, [mapReady, installationsGeoJson]);

  // Sync suitability mode & layer opacities
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const activeSuitabilityVisible =
      suitabilityMode === "wind" ? windLayerVisible || !layers : solarLayerVisible || !layers;
    const activeOpacity =
      suitabilityMode === "wind" ? windLayerOpacity : solarLayerOpacity;

    if (map.getLayer("suitability-fill")) {
      map.setPaintProperty("suitability-fill", "fill-color", [
        "match",
        ["get", suitabilityMode === "wind" ? "windClass" : "solarClass"],
        5,
        "#059669",
        4,
        "#22c55e",
        3,
        "#eab308",
        2,
        "#f97316",
        "#475569",
      ]);
      map.setPaintProperty(
        "suitability-fill",
        "fill-opacity",
        activeSuitabilityVisible ? activeOpacity : 0
      );
    }
    if (map.getLayer("suitability-outline")) {
      map.setPaintProperty(
        "suitability-outline",
        "line-opacity",
        activeSuitabilityVisible ? 0.55 : 0
      );
    }
    if (map.getLayer("india-adm1-outline")) {
      map.setPaintProperty(
        "india-adm1-outline",
        "line-opacity",
        vectorVisible ? 0.65 * vectorOpacity : 0
      );
    }
    if (map.getLayer("corridor-fill")) {
      map.setPaintProperty(
        "corridor-fill",
        "fill-opacity",
        vectorVisible ? 0.1 * vectorOpacity : 0
      );
    }
    if (map.getLayer("wri-installations-circle")) {
      map.setPaintProperty("wri-installations-circle", "circle-opacity", gridLayerVisible ? 0.9 : 0);
      map.setPaintProperty(
        "wri-installations-circle",
        "circle-stroke-opacity",
        gridLayerVisible ? 0.9 : 0
      );
    }
  }, [
    mapReady,
    suitabilityMode,
    vectorVisible,
    vectorOpacity,
    solarLayerVisible,
    solarLayerOpacity,
    windLayerVisible,
    windLayerOpacity,
    gridLayerVisible,
    layers,
  ]);

  // Fly to bbox or selected region
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (focusBbox) {
      map.fitBounds(
        [
          [focusBbox[0], focusBbox[1]],
          [focusBbox[2], focusBbox[3]],
        ],
        { padding: 48, duration: 850, maxZoom: 9.2 }
      );
      return;
    }
    if (!selectedRegionId) return;
    const region = INDIA_REGIONS.find((r) => r.id === selectedRegionId);
    if (region) {
      map.flyTo({
        center: region.centroid,
        zoom: 5.5,
        duration: 850,
        essential: true,
      });
    }
  }, [selectedRegionId, focusBbox]);

  const handleZoomIn = () => mapRef.current?.zoomIn({ duration: 250 });
  const handleZoomOut = () => mapRef.current?.zoomOut({ duration: 250 });
  const handleResetBounds = () => {
    setPitchEnabled(false);
    mapRef.current?.flyTo({
      center: INDIA_CENTER,
      zoom: INDIA_DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: 700,
    });
  };
  const handleTogglePitch = () => {
    const next = !pitchEnabled;
    setPitchEnabled(next);
    mapRef.current?.easeTo({
      pitch: next ? 42 : 0,
      duration: 500,
    });
  };

  const hasSuitabilityTiles =
    Boolean(suitabilityGeoJson) &&
    typeof suitabilityGeoJson === "object" &&
    "features" in suitabilityGeoJson &&
    Array.isArray(suitabilityGeoJson.features) &&
    suitabilityGeoJson.features.length > 0;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-[#d5e0db] bg-[#eef4f1] dark:border-[#1a3048] dark:bg-[#07111e]",
        heightClass,
        className
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Top-Left Map Coordinate & Backend/Basemap Status Overlay */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-4rem)] flex-wrap items-center gap-2">
        <div className="rounded-lg border border-[#d5e0db]/90 bg-white/90 px-3 py-1.5 text-xs backdrop-blur-md dark:border-[#1a3048] dark:bg-[#0c1b2e]/90">
          <span className="font-medium text-[#0b192c] dark:text-[#e6f0ec]">
            India GIS Viewport
          </span>
          <span className="mx-2 text-slate-400">·</span>
          <span className="font-mono text-slate-600 tabular-nums dark:text-slate-300">
            Z {zoomLevel.toFixed(1)}
          </span>
        </div>

        {basemapStatus && (
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs backdrop-blur-md",
              basemapStatus.gisBackendStatus === "connected"
                ? "border-emerald-600/30 bg-emerald-50/90 text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-950/80 dark:text-emerald-200"
                : "border-amber-500/30 bg-amber-50/90 text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/80 dark:text-amber-200"
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>
              {basemapStatus.gisBackendStatus === "connected"
                ? "GIS & GeoTIFF Pipeline Connected"
                : "CARTO Basemap Active · GIS Backend Pending"}
            </span>
          </div>
        )}

        {inspectedCell && (
          <div className="rounded-lg border border-emerald-500/35 bg-[#0c1b2e]/95 px-3 py-1.5 font-mono text-[11px] text-emerald-200 shadow-md backdrop-blur-md">
            Class {suitabilityMode === "wind" ? inspectedCell.windClass : inspectedCell.solarClass} ·{" "}
            GHI {inspectedCell.ghi.toFixed(2)} · W100 {inspectedCell.ws100m.toFixed(2)} m/s ·{" "}
            Slope {inspectedCell.slopeDeg.toFixed(1)}° · Elev {inspectedCell.elevM.toFixed(0)}m
          </div>
        )}
      </div>

      {/* Loading Indicator */}
      {(!mapReady || isLoadingOverlay) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/25 backdrop-blur-[2px]">
          <div className="flex items-center gap-2.5 rounded-lg border border-[#1a3048] bg-[#0c1b2e] px-4 py-2.5 text-xs font-medium text-emerald-100 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            <span>
              {!mapReady
                ? "Initializing MapLibre GL JS spatial canvas..."
                : "Computing 9-step GIS tile suitability overlay..."}
            </span>
          </div>
        </div>
      )}

      {/* Map Navigation Controls */}
      {interactiveControls && (
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0db] bg-white/95 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e]/95 dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0db] bg-white/95 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e]/95 dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleTogglePitch}
            aria-label="Toggle 3D terrain pitch"
            title="Toggle 3D terrain pitch"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm backdrop-blur transition-colors cursor-pointer",
              pitchEnabled
                ? "border-emerald-500/50 bg-[#0d4a3a] text-white dark:bg-emerald-500 dark:text-[#041e16]"
                : "border-[#d5e0db] bg-white/95 text-slate-700 hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e]/95 dark:text-slate-200 dark:hover:bg-[#12263d]"
            )}
          >
            <Compass className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetBounds}
            aria-label="Reset India bounds"
            title="Reset India bounds"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0db] bg-white/95 text-slate-700 shadow-sm backdrop-blur transition-colors hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e]/95 dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bottom-Left Legend Bar */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2 pr-44">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-lg border border-[#d5e0db]/90 bg-white/92 px-3.5 py-2 text-xs backdrop-blur-md dark:border-[#1a3048] dark:bg-[#0c1b2e]/92">
          <div className="flex items-center gap-1.5 font-medium text-[#0b192c] dark:text-[#e6f0ec]">
            <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{hasSuitabilityTiles ? `5-Class ${suitabilityMode === "wind" ? "Wind" : "Solar"} Suitability:` : "Vector Legend:"}</span>
          </div>
          {hasSuitabilityTiles ? (
            <>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#059669]" /> C5 High
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#22c55e]" /> C4 Suitable
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#eab308]" /> C3 Moderate
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f97316]" /> C2 Marginal
              </span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#475569]" /> C1 Excl
              </span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/70 ring-1 ring-amber-500" />
                <span>Solar</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/70 ring-1 ring-sky-500" />
                <span>Wind</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/70 ring-1 ring-emerald-500" />
                <span>Hybrid</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
