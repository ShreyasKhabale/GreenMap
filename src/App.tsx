import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LandingPage } from "@/pages/LandingPage";
import { INDIA_REGIONS } from "@/data/indiaRenewableData";
import type { IndiaRegionRecord, PageId } from "@/types/greenmap";

const WorkspaceShell = lazy(() =>
  import("@/components/layout/WorkspaceShell").then((m) => ({ default: m.WorkspaceShell }))
);
const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const GisExplorerPage = lazy(() =>
  import("@/pages/GisExplorerPage").then((m) => ({ default: m.GisExplorerPage }))
);
const SolarAnalysisPage = lazy(() =>
  import("@/pages/SolarAnalysisPage").then((m) => ({ default: m.SolarAnalysisPage }))
);
const WindAnalysisPage = lazy(() =>
  import("@/pages/WindAnalysisPage").then((m) => ({ default: m.WindAnalysisPage }))
);
const AhpCalculatorPage = lazy(() =>
  import("@/pages/AhpCalculatorPage").then((m) => ({ default: m.AhpCalculatorPage }))
);
const AiAnalyticsPage = lazy(() =>
  import("@/pages/AiAnalyticsPage").then((m) => ({ default: m.AiAnalyticsPage }))
);
const LocationComparisonPage = lazy(() =>
  import("@/pages/LocationComparisonPage").then((m) => ({ default: m.LocationComparisonPage }))
);
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage }))
);
const MethodologyPage = lazy(() =>
  import("@/pages/MethodologyPage").then((m) => ({ default: m.MethodologyPage }))
);

function WorkspaceLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
      Loading workspace module…
    </div>
  );
}

const INITIAL_AHP_WEIGHTS: Record<string, number> = {
  C1: 0.369,
  C2: 0.244,
  C3: 0.159,
  C4: 0.107,
  C5: 0.072,
  C6: 0.049,
};

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("landing");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [selectedRegion, setSelectedRegion] = useState<IndiaRegionRecord>(
    INDIA_REGIONS[0]
  );
  const [ahpWeights, setAhpWeights] =
    useState<Record<string, number>>(INITIAL_AHP_WEIGHTS);
  const [ahpCr, setAhpCr] = useState<number>(0.021);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const handleNavigate = useCallback((page: PageId) => {
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleAhpComputed = useCallback(
    (weights: Record<string, number>, cr: number) => {
      setAhpWeights(weights);
      setAhpCr(cr);
    },
    []
  );

  return (
    <TooltipProvider>
      {activePage === "landing" ? (
        <LandingPage
          onNavigate={handleNavigate}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      ) : (
        <Suspense fallback={<WorkspaceLoader />}>
          <WorkspaceShell
            activePage={activePage}
            onNavigate={handleNavigate}
            theme={theme}
            onToggleTheme={toggleTheme}
            selectedRegion={selectedRegion}
            onSelectRegion={setSelectedRegion}
          >
            <Suspense fallback={<WorkspaceLoader />}>
              {activePage === "dashboard" && (
                <DashboardPage
                  theme={theme}
                  onNavigate={handleNavigate}
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                />
              )}
              {activePage === "gis-explorer" && (
                <GisExplorerPage
                  theme={theme}
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                  onNavigate={handleNavigate}
                />
              )}
              {activePage === "solar-analysis" && (
                <SolarAnalysisPage
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                />
              )}
              {activePage === "wind-analysis" && (
                <WindAnalysisPage
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                />
              )}
              {activePage === "ahp-calculator" && (
                <AhpCalculatorPage onWeightsComputed={handleAhpComputed} />
              )}
              {activePage === "ai-analytics" && (
                <AiAnalyticsPage
                  selectedRegion={selectedRegion}
                  ahpWeights={ahpWeights}
                />
              )}
              {activePage === "location-comparison" && <LocationComparisonPage />}
              {activePage === "reports" && (
                <ReportsPage
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                  ahpWeights={ahpWeights}
                  ahpCr={ahpCr}
                />
              )}
              {activePage === "methodology" && <MethodologyPage />}
            </Suspense>
          </WorkspaceShell>
        </Suspense>
      )}
    </TooltipProvider>
  );
}
