import { useEffect, useState } from "react";
import { Check, Code2, Copy, Download, FileBarChart2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import { Spotlight } from "@/components/ui/spotlight";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AHP_CRITERIA, INDIA_REGIONS } from "@/data/indiaRenewableData";
import { downloadPdfReport, fetchJobs, fetchRegions, runGisTile } from "@/lib/greenmapApi";
import type {
  ApiRegionSummary,
  AsyncJobRecord,
  GisTileResult,
  IndiaRegionRecord,
} from "@/types/greenmap";

interface ReportsPageProps {
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
  ahpWeights: Record<string, number>;
  ahpCr: number;
}

export function ReportsPage({
  selectedRegion,
  onSelectRegion,
  ahpWeights,
  ahpCr,
}: ReportsPageProps) {
  const [includeAhp, setIncludeAhp] = useState(true);
  const [includeDatasets, setIncludeDatasets] = useState(true);
  const [exportFormat, setExportFormat] = useState<"pdf" | "json" | "csv">("pdf");
  const [copied, setCopied] = useState(false);
  const [regionsList, setRegionsList] = useState<ApiRegionSummary[]>([]);
  const [tileResult, setTileResult] = useState<GisTileResult | null>(null);
  const [jobs, setJobs] = useState<AsyncJobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchRegions(), fetchJobs(10)])
      .then(([r, j]) => {
        setRegionsList(r.regions);
        setJobs(j.jobs);
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Failed to load region catalog");
      });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    runGisTile({ region_id: selectedRegion.id, grid_size: 8 })
      .then((res) => {
        if (active) setTileResult(res);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Failed to load GIS tile report");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.id]);

  const buildReportPayload = () => {
    return {
      schemaVersion: "greenmap-report-v1",
      region: tileResult?.region ?? {
        id: selectedRegion.id,
        name: selectedRegion.name,
        centroid: selectedRegion.centroid,
        bbox: selectedRegion.bbox,
      },
      ahpConfiguration: includeAhp
        ? {
            consistencyRatio: Number(ahpCr.toFixed(4)),
            weights: ahpWeights,
          }
        : undefined,
      gisOutputs: tileResult
        ? {
            crs: tileResult.crs,
            resourceSummary: tileResult.resourceSummary,
            solarSuitability: tileResult.solarSuitability,
            windSuitability: tileResult.windSuitability,
            sentinel2Verification: tileResult.sentinel2Verification,
          }
        : null,
      citationsIncluded: includeDatasets,
    };
  };

  const handleDownload = async () => {
    if (exportFormat === "pdf") {
      setDownloadingPdf(true);
      setErrorMsg(null);
      try {
        await downloadPdfReport(selectedRegion.id);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to download PDF report");
      } finally {
        setDownloadingPdf(false);
      }
      return;
    }

    const payload = buildReportPayload();
    let content = "";
    let mime = "application/json";
    let ext = "json";

    if (exportFormat === "json") {
      content = JSON.stringify(payload, null, 2);
    } else {
      mime = "text/csv";
      ext = "csv";
      const rows = [
        ["field", "value"],
        ["region_id", selectedRegion.id],
        ["region_name", tileResult?.region.name ?? selectedRegion.name],
        ["area_km2", String(tileResult?.region.areaKm2 ?? "NA")],
        ["mean_ghi_kwh_m2_day", String(tileResult?.resourceSummary.meanGhiKwhM2Day ?? "NA")],
        ["mean_wind_100m_ms", String(tileResult?.resourceSummary.meanWs100mMs ?? "NA")],
        ["solar_suitable_km2", String(tileResult?.solarSuitability.suitableLandAreaKm2 ?? "NA")],
        ["solar_capacity_gw", String(tileResult?.solarSuitability.estimatedCapacityGw ?? "NA")],
        ["wind_suitable_km2", String(tileResult?.windSuitability.suitableLandAreaKm2 ?? "NA")],
        ["wind_capacity_gw", String(tileResult?.windSuitability.estimatedCapacityGw ?? "NA")],
        ["ahp_cr", String(ahpCr.toFixed(4))],
      ];
      content = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `greenmap-${selectedRegion.id}-report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(JSON.stringify(buildReportPayload(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Configuration */}
        <div className="space-y-5 rounded-xl border border-[#d5e0db] bg-white p-5 lg:col-span-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <div className="flex items-center gap-2 border-b border-[#d5e0db] pb-3 dark:border-[#1a3048]">
            <FileBarChart2 className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
            <h1 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
              Academic Report &amp; Export
            </h1>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Target Region
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
              Export Format
            </label>
            <Select
              value={exportFormat}
              onValueChange={(v) => setExportFormat(v as "pdf" | "json" | "csv")}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">Academic PDF Dossier (.pdf)</SelectItem>
                <SelectItem value="json">Reproducible Configuration JSON (.json)</SelectItem>
                <SelectItem value="csv">Tabular Summary CSV (.csv)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 border-t border-[#d5e0db] pt-4 dark:border-[#1a3048]">
            <div className="flex items-center justify-between text-xs">
              <span>Include Live AHP Weight Vector</span>
              <Switch checked={includeAhp} onCheckedChange={setIncludeAhp} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span>Include Dataset Citations</span>
              <Switch checked={includeDatasets} onCheckedChange={setIncludeDatasets} />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <ShimmerButton
              type="button"
              onClick={handleDownload}
              disabled={downloadingPdf}
              shimmerColor="#6ee7b7"
              background="#0d4a3a"
              borderRadius="0.5rem"
              className="h-10 w-full gap-1.5 text-sm font-medium"
            >
              {downloadingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span>{downloadingPdf ? "Generating PDF..." : `Download ${exportFormat.toUpperCase()} Report`}</span>
            </ShimmerButton>
            {errorMsg && (
              <div className="rounded-lg border border-red-500/40 bg-red-50/70 p-2.5 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
                {errorMsg}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={handleCopy}
                className="w-full border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
              >
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy JSON"}
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
                  >
                    <Code2 className="mr-1.5 h-3.5 w-3.5" />
                    Preview Schema
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  <DialogHeader>
                    <DialogTitle>
                      Reproducible Report Schema ({tileResult?.region.name ?? selectedRegion.name})
                    </DialogTitle>
                    <DialogDescription>
                      Live schemaVersion greenmap-report-v1 exported with active AHP vector and
                      GIS suitability outputs.
                    </DialogDescription>
                  </DialogHeader>
                  <pre className="max-h-80 overflow-auto rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-3 font-mono text-[11px] dark:border-[#1a3048] dark:bg-[#07111e]">
                    {JSON.stringify(buildReportPayload(), null, 2)}
                  </pre>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Right Academic Document Preview */}
        <div className="relative space-y-5 overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-6 lg:col-span-8 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <BorderBeam
            size={150}
            duration={10}
            colorFrom="#10b981"
            colorTo="#0284c7"
          />
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#d5e0db] pb-4 dark:border-[#1a3048]">
            <div>
              <div className="text-xs text-emerald-700 dark:text-emerald-400">
                GreenMap Verified GIS &amp; ML Dossier
              </div>
              <h2 className="mt-1 font-display text-xl font-bold text-[#0b192c] dark:text-[#e6f0ec]">
                Renewable Energy Assessment: {tileResult?.region.name ?? selectedRegion.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                CRS {tileResult?.crs.projectedMetric ?? "EPSG:7755"} · Area{" "}
                {tileResult?.region.areaKm2.toLocaleString() ?? "—"} km²
              </p>
            </div>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
            ) : (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                <FileText className="h-3.5 w-3.5" /> PDF Ready
              </span>
            )}
          </div>

          {tileResult && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative flex items-center justify-between gap-2 overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                <Spotlight size={130} className="from-emerald-400/20 via-transparent to-transparent" />
                <div>
                  <div className="text-xs text-slate-500">Solar Suitable</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {tileResult.solarSuitability.suitableLandAreaKm2.toLocaleString()} km²
                  </div>
                </div>
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
                  gaugePrimaryColor="#10b981"
                  gaugeSecondaryColor="rgba(148,163,184,0.2)"
                  className="size-11 shrink-0 text-[10px]"
                />
              </div>
              <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                <Spotlight size={130} className="from-amber-400/20 via-transparent to-transparent" />
                <div className="text-xs text-slate-500">Solar Capacity</div>
                <div className="mt-1 font-mono text-base font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {tileResult.solarSuitability.estimatedCapacityGw} GW
                </div>
              </div>
              <div className="relative flex items-center justify-between gap-2 overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                <Spotlight size={130} className="from-sky-400/20 via-transparent to-transparent" />
                <div>
                  <div className="text-xs text-slate-500">Wind Suitable</div>
                  <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                    {tileResult.windSuitability.suitableLandAreaKm2.toLocaleString()} km²
                  </div>
                </div>
                <AnimatedCircularProgressBar
                  max={100}
                  value={
                    tileResult.region.areaKm2 > 0
                      ? Math.round(
                          (tileResult.windSuitability.suitableLandAreaKm2 /
                            tileResult.region.areaKm2) *
                            100
                        )
                      : 0
                  }
                  gaugePrimaryColor="#0284c7"
                  gaugeSecondaryColor="rgba(148,163,184,0.2)"
                  className="size-11 shrink-0 text-[10px]"
                />
              </div>
              <div className="relative overflow-hidden rounded-lg bg-[#f5f8f6] p-3.5 dark:bg-[#07111e]">
                <Spotlight size={130} className="from-sky-400/15 via-transparent to-transparent" />
                <div className="text-xs text-slate-500">Wind Capacity</div>
                <div className="mt-1 font-mono text-base font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                  {tileResult.windSuitability.estimatedCapacityGw} GW
                </div>
              </div>
            </div>
          )}

          {includeAhp && (
            <div className="space-y-2 border-t border-[#d5e0db] pt-4 dark:border-[#1a3048]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                  Active AHP Criterion Weights
                </span>
                <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                  CR = {ahpCr.toFixed(4)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AHP_CRITERIA.map((c) => (
                  <div
                    key={c.id}
                    className="rounded border border-[#d5e0db] px-3 py-2 text-xs dark:border-[#1a3048]"
                  >
                    <div className="text-slate-500 dark:text-slate-400">{c.name}</div>
                    <div className="mt-0.5 font-mono font-semibold tabular-nums">
                      {((ahpWeights[c.code] ?? 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobs.length > 0 && (
            <div className="space-y-2 border-t border-[#d5e0db] pt-4 dark:border-[#1a3048]">
              <div className="text-xs font-semibold">Recent Analysis History</div>
              <div className="space-y-1.5 text-xs">
                {jobs.slice(0, 5).map((j) => (
                  <div
                    key={j.job_id}
                    className="flex items-center justify-between rounded bg-[#f5f8f6] px-3 py-1.5 font-mono text-[11px] dark:bg-[#07111e]"
                  >
                    <span>
                      {j.job_type} · {j.region_id}
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400">{j.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
