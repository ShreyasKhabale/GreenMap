import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Check, CheckCircle2, Copy, History, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import { BorderBeam } from "@/components/ui/border-beam";
import { GlowingEffect } from "@/components/ui/glowing-effect";
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
import { computeAhpBackend, fetchAhpHistory } from "@/lib/greenmapApi";
import type { AhpBackendRecord, AhpCalculationResult } from "@/types/greenmap";

interface AhpCalculatorPageProps {
  onWeightsComputed?: (weights: Record<string, number>, cr: number) => void;
}

const SAATY_RI_N6 = 1.24;

const SOLAR_CRITERIA = [
  { code: "C1", name: "Solar Irradiance (GHI)", unit: "kWh/m²/day", layer: "NASA POWER / Solargis" },
  { code: "C2", name: "Thermal Stability (PV Derate)", unit: "°C", layer: "NASA T2M Lapse" },
  { code: "C3", name: "Terrain Slope", unit: "degrees (°)", layer: "SRTM 30m DEM" },
  { code: "C4", name: "Land Use / Exclusions", unit: "class", layer: "OSM / Sentinel-2" },
  { code: "C5", name: "Grid Substation Proximity", unit: "km", layer: "OSM + WRI Grid" },
  { code: "C6", name: "Road & Logistics Access", unit: "km", layer: "OSM Highways" },
];

const WIND_CRITERIA = [
  { code: "C1", name: "Wind Speed 100m", unit: "m/s", layer: "NASA WS50M + Hellmann" },
  { code: "C2", name: "Air Density & Stability", unit: "kg/m³", layer: "Elevation + Temp Rho" },
  { code: "C3", name: "Terrain Slope & Ridges", unit: "degrees (°)", layer: "SRTM 30m DEM" },
  { code: "C4", name: "Land Use / Exclusions", unit: "class", layer: "OSM / Sentinel-2" },
  { code: "C5", name: "Grid Substation Proximity", unit: "km", layer: "OSM + WRI Grid" },
  { code: "C6", name: "Heavy-Haul Road Access", unit: "km", layer: "OSM Highways" },
];

const SAATY_SCALE_OPTIONS = [
  { label: "9 (Extreme)", value: 9 },
  { label: "7 (Very Strong)", value: 7 },
  { label: "5 (Strong)", value: 5 },
  { label: "3 (Moderate)", value: 3 },
  { label: "2 (Weak+)", value: 2 },
  { label: "1 (Equal)", value: 1 },
  { label: "1/2", value: 0.5 },
  { label: "1/3", value: 1 / 3 },
  { label: "1/5", value: 1 / 5 },
  { label: "1/7", value: 1 / 7 },
  { label: "1/9", value: 1 / 9 },
];

const DEFAULT_SOLAR_UPPER: Record<string, number> = {
  "0-1": 3,
  "0-2": 2,
  "0-3": 4,
  "0-4": 5,
  "0-5": 7,
  "1-2": 0.5,
  "1-3": 2,
  "1-4": 3,
  "1-5": 4,
  "2-3": 2,
  "2-4": 3,
  "2-5": 5,
  "3-4": 2,
  "3-5": 3,
  "4-5": 2,
};

const DEFAULT_WIND_UPPER: Record<string, number> = {
  "0-1": 3,
  "0-2": 4,
  "0-3": 4,
  "0-4": 5,
  "0-5": 7,
  "1-2": 2,
  "1-3": 2,
  "1-4": 3,
  "1-5": 4,
  "2-3": 1,
  "2-4": 2,
  "2-5": 3,
  "3-4": 2,
  "3-5": 3,
  "4-5": 2,
};

function computeAhpLocal(matrix: number[][]): AhpCalculationResult {
  const n = matrix.length;
  const colSums = Array.from({ length: n }, (_, j) =>
    matrix.reduce((sum, row) => sum + row[j], 0)
  );
  const normalized = matrix.map((row) =>
    row.map((val, j) => val / (colSums[j] || 1))
  );
  const weights = normalized.map(
    (row) => row.reduce((sum, val) => sum + val, 0) / n
  );
  const weightedSumVector = matrix.map((row) =>
    row.reduce((sum, val, j) => sum + val * weights[j], 0)
  );
  const lambdaMax =
    weightedSumVector.reduce((sum, val, i) => sum + val / (weights[i] || 1), 0) / n;
  const ci = Math.max(0, (lambdaMax - n) / (n - 1));
  const cr = ci / SAATY_RI_N6;
  return {
    weights,
    lambdaMax,
    ci,
    ri: SAATY_RI_N6,
    cr,
    isConsistent: cr < 0.1,
  };
}

function formatRatio(val: number): string {
  if (val >= 1) return Number.isInteger(val) ? String(val) : val.toFixed(2);
  const inv = Math.round(1 / val);
  return `1/${inv}`;
}

export function AhpCalculatorPage({ onWeightsComputed }: AhpCalculatorPageProps) {
  const [scenario, setScenario] = useState<"solar" | "wind">("solar");
  const [solarUpper, setSolarUpper] = useState<Record<string, number>>(DEFAULT_SOLAR_UPPER);
  const [windUpper, setWindUpper] = useState<Record<string, number>>(DEFAULT_WIND_UPPER);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<AhpBackendRecord[]>([]);

  const criteria = scenario === "solar" ? SOLAR_CRITERIA : WIND_CRITERIA;
  const activeUpper = scenario === "solar" ? solarUpper : windUpper;
  const setActiveUpper = scenario === "solar" ? setSolarUpper : setWindUpper;

  useEffect(() => {
    fetchAhpHistory(8)
      .then((res) => setHistory(res.configs))
      .catch(() => {});
  }, []);

  const matrix = useMemo(() => {
    const n = criteria.length;
    const mat: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = activeUpper[`${i}-${j}`] ?? 1;
        mat[i][j] = val;
        mat[j][i] = 1 / val;
      }
    }
    return mat;
  }, [activeUpper, criteria.length]);

  const result = useMemo(() => computeAhpLocal(matrix), [matrix]);

  useEffect(() => {
    if (!onWeightsComputed) return;
    const weightMap: Record<string, number> = {};
    criteria.forEach((c, idx) => {
      weightMap[c.code] = Number(result.weights[idx].toFixed(4));
    });
    onWeightsComputed(weightMap, result.cr);
  }, [result, criteria, onWeightsComputed]);

  const handleCellChange = (i: number, j: number, value: number) => {
    setSaveNotice(null);
    setActiveUpper((prev) => ({
      ...prev,
      [`${i}-${j}`]: value,
    }));
  };

  const handleReset = () => {
    setSaveNotice(null);
    if (scenario === "solar") setSolarUpper(DEFAULT_SOLAR_UPPER);
    else setWindUpper(DEFAULT_WIND_UPPER);
  };

  const handleSaveBackend = async () => {
    setSaving(true);
    setSaveNotice(null);
    try {
      const saved = await computeAhpBackend({ scenario, matrix, persist: true });
      setHistory((prev) => [saved, ...prev.slice(0, 7)]);
      setSaveNotice(
        saved.is_consistent
          ? `Saved ${saved.config_id} (CR = ${saved.cr.toFixed(4)} < 0.10)`
          : saved.warning || `Flagged inconsistent (CR = ${saved.cr.toFixed(4)} >= 0.10)`
      );
    } catch (err) {
      setSaveNotice(err instanceof Error ? err.message : "Failed to persist AHP config");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPayload = () => {
    const payload = {
      scenario,
      method: "Saaty_AHP_6x6",
      consistencyRatio: Number(result.cr.toFixed(4)),
      isConsistent: result.isConsistent,
      criteriaWeights: criteria.map((c, idx) => ({
        code: c.code,
        name: c.name,
        weight: Number(result.weights[idx].toFixed(4)),
      })),
    };
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <div className="max-w-2xl space-y-2">
          <h1 className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]">
            Analytic Hierarchy Process (AHP) Weighting Engine
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Separate Solar PV and Wind 100m pairwise scenarios on Saaty&apos;s 1–9 scale. Matrices
            with Consistency Ratio CR &ge; 0.10 are automatically flagged as inconsistent.
          </p>
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#eef4f1] p-1 dark:bg-[#07111e]">
            <AnimatedBackground
              defaultValue={scenario}
              onValueChange={(val) => {
                if (val === "solar" || val === "wind") setScenario(val);
              }}
              className="rounded-md bg-white shadow-sm dark:bg-[#12263d]"
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
            >
              <button
                data-id="solar"
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  scenario === "solar"
                    ? "text-[#0d4a3a] dark:text-emerald-300"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                Solar PV Scenario
              </button>
              <button
                data-id="wind"
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  scenario === "wind"
                    ? "text-[#0d4a3a] dark:text-emerald-300"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                Wind 100m Scenario
              </button>
            </AnimatedBackground>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
              >
                <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                Saaty Scale &amp; JSON
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Saaty&apos;s 1–9 Scale &amp; AHP Matrix Payload</DialogTitle>
                <DialogDescription>
                  Pairwise reciprocal judgements with n=6 Random Index RI = 1.24. Matrices with
                  CR &ge; 0.10 must be revised before raster weighted overlay.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-3 dark:border-[#1a3048] dark:bg-[#07111e]">
                  <div><span className="font-mono font-semibold">1</span> · Equal importance</div>
                  <div><span className="font-mono font-semibold">3</span> · Moderate importance</div>
                  <div><span className="font-mono font-semibold">5</span> · Strong importance</div>
                  <div><span className="font-mono font-semibold">7</span> · Very strong importance</div>
                  <div><span className="font-mono font-semibold">9</span> · Extreme importance</div>
                  <div><span className="font-mono font-semibold">1/k</span> · Reciprocal inverse</div>
                </div>
                <pre className="max-h-52 overflow-auto rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-3 font-mono text-[11px] dark:border-[#1a3048] dark:bg-[#07111e]">
                  {JSON.stringify(
                    {
                      scenario,
                      cr: Number(result.cr.toFixed(4)),
                      isConsistent: result.isConsistent,
                      weights: Object.fromEntries(
                        criteria.map((c, idx) => [c.code, Number(result.weights[idx].toFixed(4))])
                      ),
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset {scenario === "solar" ? "Solar" : "Wind"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyPayload}
            className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer"
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            size="sm"
            onClick={handleSaveBackend}
            disabled={saving}
            className="bg-[#0d4a3a] text-white hover:bg-[#09382b] dark:bg-emerald-500 dark:text-[#041e16] cursor-pointer"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "Validating..." : "Validate & Save to DB"}
          </Button>
        </div>
      </div>

      {saveNotice && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs ${
            result.isConsistent
              ? "border-emerald-500/40 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-red-500/40 bg-red-50/70 text-red-900 dark:bg-red-950/30 dark:text-red-200"
          }`}
        >
          {saveNotice}
        </div>
      )}

      {/* Consistency Telemetry Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help text-xs text-slate-500 underline decoration-dotted underline-offset-4 dark:text-slate-400">
                Principal Eigenvalue (&lambda;max)
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Perfectly consistent 6×6 matrix satisfies &lambda;max = 6.0000
            </TooltipContent>
          </Tooltip>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {result.lambdaMax.toFixed(4)}
          </div>
        </div>

        <div className="rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help text-xs text-slate-500 underline decoration-dotted underline-offset-4 dark:text-slate-400">
                Consistency Index (CI)
              </div>
            </TooltipTrigger>
            <TooltipContent>
              CI = (&lambda;max &minus; n) / (n &minus; 1), where n = 6 criteria
            </TooltipContent>
          </Tooltip>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {result.ci.toFixed(4)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Consistency Ratio (CR)
            </div>
            <div
              className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                result.isConsistent
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {result.cr.toFixed(4)}
            </div>
          </div>
          <AnimatedCircularProgressBar
            max={100}
            value={Math.min(100, Math.round((result.cr / 0.1) * 100))}
            gaugePrimaryColor={result.isConsistent ? "#10b981" : "#ef4444"}
            gaugeSecondaryColor="rgba(148,163,184,0.2)"
            displayText={result.cr.toFixed(3)}
            className="size-12 text-[11px]"
          />
        </div>

        <div className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <BorderBeam
            size={90}
            duration={7}
            colorFrom={result.isConsistent ? "#10b981" : "#ef4444"}
            colorTo={result.isConsistent ? "#0284c7" : "#f59e0b"}
          />
          <div className="text-xs text-slate-500 dark:text-slate-400">Validation Threshold</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
            {result.isConsistent ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">
                  Consistent (CR &lt; 0.10)
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span className="text-red-600 dark:text-red-400">
                  Inconsistent (CR &ge; 0.10)
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Split: 6x6 Matrix + Derived Weights */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="overflow-x-auto rounded-xl border border-[#d5e0db] bg-white p-5 xl:col-span-8 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <h2 className="mb-4 font-display text-base font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
            {scenario === "solar" ? "Solar PV" : "Wind 100m"} Pairwise Matrix (Row i vs Column j)
          </h2>

          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#d5e0db] text-slate-500 dark:border-[#1a3048] dark:text-slate-400">
                <th className="py-2 pr-3 text-left font-medium">Criterion</th>
                {criteria.map((c) => (
                  <th key={c.code} className="px-2 py-2 text-center font-mono font-semibold">
                    {c.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
              {criteria.map((rowCrit, i) => (
                <tr key={rowCrit.code}>
                  <td className="py-2.5 pr-3 font-medium text-[#0b192c] dark:text-slate-200">
                    <span className="mr-1.5 font-mono text-emerald-700 dark:text-emerald-400">
                      {rowCrit.code}
                    </span>
                    <span className="hidden sm:inline">{rowCrit.name}</span>
                  </td>
                  {criteria.map((colCrit, j) => {
                    if (i === j) {
                      return (
                        <td
                          key={colCrit.code}
                          className="bg-[#f5f8f6] px-2 py-2 text-center font-mono font-semibold text-slate-500 dark:bg-[#07111e] dark:text-slate-400"
                        >
                          1
                        </td>
                      );
                    }
                    if (i < j) {
                      const currentVal = activeUpper[`${i}-${j}`] ?? 1;
                      return (
                        <td key={colCrit.code} className="px-1.5 py-2 text-center">
                          <select
                            aria-label={`Compare ${rowCrit.code} to ${colCrit.code}`}
                            value={String(currentVal)}
                            onChange={(e) => handleCellChange(i, j, Number(e.target.value))}
                            className="h-8 w-full rounded-md border border-[#d5e0db] bg-white px-1.5 font-mono text-xs text-[#0b192c] focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-[#1e3550] dark:bg-[#07111e] dark:text-emerald-300"
                          >
                            {SAATY_SCALE_OPTIONS.map((opt) => (
                              <option key={opt.label} value={String(opt.value)}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={colCrit.code}
                        className="px-2 py-2 text-center font-mono text-slate-500 tabular-nums dark:text-slate-400"
                      >
                        {formatRatio(matrix[i][j])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Computed Weights */}
        <div className="relative rounded-xl border border-[#d5e0db] bg-white p-5 xl:col-span-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <GlowingEffect
            spread={30}
            glow={true}
            disabled={false}
            proximity={56}
            inactiveZone={0.01}
            borderWidth={1.5}
          />
          <h2 className="relative z-10 mb-4 font-display text-base font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
            Derived GIS Overlay Weights
          </h2>
          <div className="space-y-4">
            {criteria.map((crit, idx) => {
              const weightPct = result.weights[idx] * 100;
              return (
                <div key={crit.code} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        {crit.code}
                      </span>{" "}
                      <span className="font-medium text-[#0b192c] dark:text-slate-200">
                        {crit.name}
                      </span>
                    </div>
                    <span className="font-mono font-semibold tabular-nums">
                      {weightPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef4f1] dark:bg-[#07111e]">
                    <div
                      className="h-full rounded-full bg-[#0d4a3a] transition-all duration-300 dark:bg-emerald-500"
                      style={{ width: `${Math.min(100, weightPct)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Layer: {crit.layer} ({crit.unit})
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Saved AHP History */}
      {history.length > 0 && (
        <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Persisted AHP Configurations</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            {history.slice(0, 4).map((h) => (
              <div
                key={h.config_id}
                className="rounded-lg border border-[#d5e0db] bg-[#f5f8f6] p-3 text-xs dark:border-[#1a3048] dark:bg-[#07111e]"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="font-semibold uppercase">{h.scenario}</span>
                  <span className={h.is_consistent ? "text-emerald-600" : "text-red-500"}>
                    CR {h.cr.toFixed(3)}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-slate-500">
                  C1 {(h.weights.C1 * 100).toFixed(0)}% · C2 {(h.weights.C2 * 100).toFixed(0)}% · C3{" "}
                  {(h.weights.C3 * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
