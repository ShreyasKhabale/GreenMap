import { useEffect, useState } from "react";
import { BarChart3, Bot, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { NumberTicker } from "@/components/ui/number-ticker";
import { explainMlRegion, fetchMlSummary, trainMlBackend } from "@/lib/greenmapApi";
import type { IndiaRegionRecord, MlRunResult, RegionShapExplanation } from "@/types/greenmap";

interface AiAnalyticsPageProps {
  selectedRegion: IndiaRegionRecord;
  ahpWeights: Record<string, number>;
}

export function AiAnalyticsPage({ selectedRegion }: AiAnalyticsPageProps) {
  const [scenario, setScenario] = useState<"hybrid" | "solar" | "wind">("hybrid");
  const [mlRun, setMlRun] = useState<MlRunResult | null>(null);
  const [regionShap, setRegionShap] = useState<RegionShapExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [training, setTraining] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    fetchMlSummary(scenario)
      .then((res) => {
        if (active) setMlRun(res);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : "Failed to load ML diagnostics");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scenario]);

  useEffect(() => {
    let active = true;
    explainMlRegion(selectedRegion.id)
      .then((res) => {
        if (active) setRegionShap(res);
      })
      .catch(() => {
        if (active) setRegionShap(null);
      });
    return () => {
      active = false;
    };
  }, [selectedRegion.id]);

  const handleRetrain = async () => {
    setTraining(true);
    setErrorMsg(null);
    try {
      const fresh = await trainMlBackend(scenario, false);
      setMlRun(fresh);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "ML retraining failed");
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
        <BackgroundBeams className="opacity-25 dark:opacity-45" />
        <div className="relative z-10 max-w-2xl space-y-1">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
            <Bot className="h-4 w-4" />
            <span>Scikit-learn · XGBoost · K-Means · SHAP TreeExplainer · Spatial GroupKFold CV</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-[#0b192c] dark:text-[#e6f0ec]">
            Machine Learning Suitability &amp; Explainability Lab
          </h1>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Trained exclusively on verified WRI Global Power Plant Database (India) Solar &amp; Wind
            installations paired with NASA POWER climatology and SRTM 30m topography.
          </p>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-[#eef4f1] p-1 dark:bg-[#07111e]">
            <AnimatedBackground
              defaultValue={scenario}
              onValueChange={(val) => {
                if (val === "hybrid" || val === "solar" || val === "wind") setScenario(val);
              }}
              className="rounded-md bg-white shadow-sm dark:bg-[#12263d]"
              transition={{ type: "spring", bounce: 0.18, duration: 0.35 }}
            >
              {(["hybrid", "solar", "wind"] as const).map((sc) => (
                <button
                  key={sc}
                  data-id={sc}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    scenario === sc
                      ? "text-[#0d4a3a] dark:text-emerald-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {sc}
                </button>
              ))}
            </AnimatedBackground>
          </div>
          <ShimmerButton
            type="button"
            onClick={handleRetrain}
            disabled={training || loading}
            shimmerColor="#6ee7b7"
            background="#0d4a3a"
            borderRadius="0.5rem"
            className="h-9 gap-1.5 px-4 text-xs font-medium"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${training ? "animate-spin" : ""}`} />
            <span>{training ? "Training Spatial CV..." : "Retrain Models"}</span>
          </ShimmerButton>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/40 bg-red-50/70 p-4 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {loading && !mlRun ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-[#d5e0db] bg-white dark:border-[#1a3048] dark:bg-[#0c1b2e]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-500" />
          <span className="text-sm">Running spatial cross-validation &amp; SHAP TreeExplainer...</span>
        </div>
      ) : (
        mlRun && (
          <>
            {/* Top Validation Metrics */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative flex items-center justify-between gap-3 rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <GlowingEffect
                  spread={28}
                  glow={true}
                  disabled={false}
                  proximity={50}
                  inactiveZone={0.01}
                  borderWidth={1.5}
                />
                <div className="relative z-10">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    XGBoost Spatial-CV ROC-AUC
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {mlRun.metrics.xgboost.meanRocAuc.toFixed(3)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    F1: {mlRun.metrics.xgboost.meanF1.toFixed(3)} · Acc:{" "}
                    {(mlRun.metrics.xgboost.meanAccuracy * 100).toFixed(1)}%
                  </div>
                </div>
                <AnimatedCircularProgressBar
                  max={100}
                  value={Math.round(mlRun.metrics.xgboost.meanRocAuc * 100)}
                  gaugePrimaryColor="#10b981"
                  gaugeSecondaryColor="rgba(148,163,184,0.2)"
                  className="relative z-10 size-14 shrink-0 text-xs"
                />
              </div>

              <div className="relative flex items-center justify-between gap-3 rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <GlowingEffect
                  spread={28}
                  glow={true}
                  disabled={false}
                  proximity={50}
                  inactiveZone={0.01}
                  borderWidth={1.5}
                />
                <div className="relative z-10">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Random Forest Spatial-CV ROC-AUC
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                    {mlRun.metrics.randomForest.meanRocAuc.toFixed(3)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    F1: {mlRun.metrics.randomForest.meanF1.toFixed(3)} · Acc:{" "}
                    {(mlRun.metrics.randomForest.meanAccuracy * 100).toFixed(1)}%
                  </div>
                </div>
                <AnimatedCircularProgressBar
                  max={100}
                  value={Math.round(mlRun.metrics.randomForest.meanRocAuc * 100)}
                  gaugePrimaryColor="#0284c7"
                  gaugeSecondaryColor="rgba(148,163,184,0.2)"
                  className="relative z-10 size-14 shrink-0 text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    AHP vs ML Agreement
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
                    r = {mlRun.ahp_comparison.pearsonR.toFixed(3)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Spearman &rho; = {mlRun.ahp_comparison.spearmanRho.toFixed(3)}
                  </div>
                </div>
                <AnimatedCircularProgressBar
                  max={100}
                  value={Math.round(mlRun.ahp_comparison.withinOneClassAgreementPct)}
                  gaugePrimaryColor="#10b981"
                  gaugeSecondaryColor="rgba(148,163,184,0.2)"
                  className="size-14 shrink-0 text-xs"
                />
              </div>

              <div className="rounded-xl border border-[#d5e0db] bg-white p-4 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Verified Sample Coverage
                </div>
                <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  N = <NumberTicker value={mlRun.sample_count} decimalPlaces={0} />
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {mlRun.positive_count ?? "WRI"} verified + background points
                </div>
              </div>
            </div>

            <Tabs defaultValue="shap" className="space-y-4">
              <TabsList className="bg-[#eef4f1] dark:bg-[#0c1b2e]">
                <TabsTrigger value="shap">SHAP Explanations</TabsTrigger>
                <TabsTrigger value="cv">Spatial Cross-Validation</TabsTrigger>
                <TabsTrigger value="clusters">K-Means Resource Regimes</TabsTrigger>
                <TabsTrigger value="comparison">AHP vs ML Comparison</TabsTrigger>
              </TabsList>

              <TabsContent value="shap" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Global SHAP Feature Importance */}
                <div className="space-y-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <h2 className="font-display text-base font-semibold">
                        Global Feature Importance (Mean |SHAP|)
                      </h2>
                      <p className="text-xs text-slate-500">{mlRun.shap.explainer}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {mlRun.shap.globalFeatures.map((feat) => (
                      <div key={feat.feature} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium">{feat.label}</span>
                          <span className="font-mono tabular-nums">
                            {feat.meanAbsShap.toFixed(3)} ({feat.relativeImportancePct}%)
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#eef4f1] dark:bg-[#07111e]">
                          <div
                            className={`h-full rounded-full ${
                              feat.direction === "positive" ? "bg-emerald-500" : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(100, feat.relativeImportancePct * 2)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Local Region SHAP Explanation */}
                <div className="space-y-4 rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                  <div>
                    <h2 className="font-display text-base font-semibold">
                      Local SHAP Attribution — {selectedRegion.name}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {regionShap
                        ? `XGBoost Probability: ${(regionShap.xgbSuitabilityProb * 100).toFixed(1)}% · RF: ${(regionShap.rfSuitabilityProb * 100).toFixed(1)}%`
                        : "Computing region feature vector..."}
                    </p>
                  </div>
                  {regionShap && (
                    <div className="space-y-2.5">
                      {regionShap.localShap.map((item) => {
                        const pos = item.shapContribution >= 0;
                        return (
                          <div key={item.feature} className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span>
                                {item.label}{" "}
                                <span className="font-mono text-slate-400">({item.value})</span>
                              </span>
                              <span
                                className={`font-mono font-semibold tabular-nums ${
                                  pos
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : "text-red-600 dark:text-red-400"
                                }`}
                              >
                                {pos ? "+" : ""}
                                {item.shapContribution.toFixed(3)}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef4f1] dark:bg-[#07111e]">
                              <div
                                className={`h-full rounded-full ${pos ? "bg-emerald-500" : "bg-red-500"}`}
                                style={{
                                  width: `${Math.min(100, Math.abs(item.shapContribution) * 70)}%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="cv">
                <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h2 className="font-display text-base font-semibold">
                      Spatial Block Cross-Validation Fold Results (GroupKFold)
                    </h2>
                  </div>
                  <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                    {mlRun.label_methodology_note ||
                      "Folds split by 4°×4° spatial blocks so nearby installations never leak between train and test."}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#d5e0db] text-slate-500 dark:border-[#1a3048]">
                          <th className="py-2 pr-4">Spatial Fold</th>
                          <th className="py-2 pr-4 text-right">Test Points</th>
                          <th className="py-2 pr-4 text-right">XGB ROC-AUC</th>
                          <th className="py-2 pr-4 text-right">XGB F1</th>
                          <th className="py-2 pr-4 text-right">RF ROC-AUC</th>
                          <th className="py-2 text-right">RF F1</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
                        {mlRun.metrics.xgboost.folds.map((xf, idx) => {
                          const rff = mlRun.metrics.randomForest.folds[idx];
                          return (
                            <tr key={xf.fold}>
                              <td className="py-2.5 pr-4 font-mono font-semibold">Fold {xf.fold}</td>
                              <td className="py-2.5 pr-4 text-right font-mono">{xf.nTest}</td>
                              <td className="py-2.5 pr-4 text-right font-mono">{xf.rocAuc.toFixed(3)}</td>
                              <td className="py-2.5 pr-4 text-right font-mono">{xf.f1.toFixed(3)}</td>
                              <td className="py-2.5 pr-4 text-right font-mono">
                                {rff ? rff.rocAuc.toFixed(3) : "—"}
                              </td>
                              <td className="py-2.5 text-right font-mono">
                                {rff ? rff.f1.toFixed(3) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="clusters">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {mlRun.clusters.map((cl) => (
                    <div
                      key={cl.clusterId}
                      className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          <Layers className="h-3.5 w-3.5" /> Cluster {cl.clusterId + 1}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {cl.sampleCount} samples · {cl.verifiedPlantSharePct}% WRI plants
                        </span>
                      </div>
                      <h3 className="mt-1 font-display text-base font-semibold">{cl.regimeName}</h3>
                      <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-xs">
                        <div>
                          <dt className="text-slate-500">Mean GHI</dt>
                          <dd className="font-semibold">{cl.meanGhi} kWh/m²</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Wind 100m</dt>
                          <dd className="font-semibold">{cl.meanWs100m} m/s</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Elev / Slope</dt>
                          <dd className="font-semibold">
                            {cl.meanElevationM}m / {cl.meanSlopeDeg}°
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="comparison">
                <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
                  <h2 className="mb-2 font-display text-base font-semibold">
                    AHP vs Machine Learning Suitability Agreement (Verified WRI Plants)
                  </h2>
                  <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                    Exact 5-Class Agreement: {mlRun.ahp_comparison.exact5ClassAgreementPct}% · Within
                    1 Class: {mlRun.ahp_comparison.withinOneClassAgreementPct}% · Pearson r ={" "}
                    {mlRun.ahp_comparison.pearsonR.toFixed(3)}
                  </p>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 bg-white dark:bg-[#0c1b2e]">
                        <tr className="border-b border-[#d5e0db] text-slate-500 dark:border-[#1a3048]">
                          <th className="py-2 pr-4">Site / Plant</th>
                          <th className="py-2 pr-4">Type</th>
                          <th className="py-2 pr-4">State</th>
                          <th className="py-2 pr-4 text-right">AHP Score</th>
                          <th className="py-2 pr-4 text-right">XGB Prob</th>
                          <th className="py-2 text-right">RF Prob</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#d5e0db]/70 dark:divide-[#1a3048]/70">
                        {mlRun.ahp_comparison.samplePoints.slice(0, 20).map((pt, idx) => (
                          <tr key={`${pt.name}-${idx}`}>
                            <td className="py-2 pr-4 font-medium">{pt.name}</td>
                            <td className="py-2 pr-4">{pt.fuelType}</td>
                            <td className="py-2 pr-4 text-slate-500">{pt.stateName}</td>
                            <td className="py-2 pr-4 text-right font-mono">{pt.ahpScore.toFixed(3)}</td>
                            <td className="py-2 pr-4 text-right font-mono text-emerald-700 dark:text-emerald-400">
                              {pt.xgbSuitabilityProb.toFixed(3)}
                            </td>
                            <td className="py-2 text-right font-mono text-sky-700 dark:text-sky-400">
                              {pt.rfSuitabilityProb.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )
      )}
    </div>
  );
}
