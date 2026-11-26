import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Calculator,
  Compass,
  Database,
  FileBarChart2,
  GitCompare,
  Globe2,
  Home,
  LayoutDashboard,
  MapPin,
  Moon,
  Search,
  Sun,
  Wind,
} from "lucide-react";
import {
  Sidebar,
  SidebarBody,
  SidebarLink,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dock,
  DockIcon,
  DockItem,
  DockLabel,
} from "@/components/ui/dock";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { INDIA_REGIONS } from "@/data/indiaRenewableData";
import { fetchRegions, fetchSafeJson } from "@/lib/greenmapApi";
import type { ApiRegionSummary, IndiaRegionRecord, PageId } from "@/types/greenmap";
import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  selectedRegion: IndiaRegionRecord;
  onSelectRegion: (region: IndiaRegionRecord) => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: PageId; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  {
    id: "dashboard",
    label: "Overview Dashboard",
    shortLabel: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
  },
  {
    id: "gis-explorer",
    label: "GIS Explorer",
    shortLabel: "GIS Map",
    icon: <Globe2 className="h-4 w-4 shrink-0" />,
  },
  {
    id: "solar-analysis",
    label: "Solar Analysis",
    shortLabel: "Solar",
    icon: <Sun className="h-4 w-4 shrink-0" />,
  },
  {
    id: "wind-analysis",
    label: "Wind Analysis",
    shortLabel: "Wind",
    icon: <Wind className="h-4 w-4 shrink-0" />,
  },
  {
    id: "ahp-calculator",
    label: "AHP Calculator",
    shortLabel: "AHP",
    icon: <Calculator className="h-4 w-4 shrink-0" />,
  },
  {
    id: "ai-analytics",
    label: "AI Analytics",
    shortLabel: "AI Lab",
    icon: <Bot className="h-4 w-4 shrink-0" />,
  },
  {
    id: "location-comparison",
    label: "Location Comparison",
    shortLabel: "Compare",
    icon: <GitCompare className="h-4 w-4 shrink-0" />,
  },
  {
    id: "reports",
    label: "Reports",
    shortLabel: "Reports",
    icon: <FileBarChart2 className="h-4 w-4 shrink-0" />,
  },
  {
    id: "methodology",
    label: "Data & Methodology",
    shortLabel: "Sources",
    icon: <Database className="h-4 w-4 shrink-0" />,
  },
];

const DOCK_PAGE_IDS: PageId[] = [
  "dashboard",
  "gis-explorer",
  "solar-analysis",
  "wind-analysis",
  "ahp-calculator",
  "ai-analytics",
  "reports",
];

function SidebarBrand({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { open, animate } = useSidebar();
  return (
    <button
      type="button"
      onClick={() => onNavigate("landing")}
      className="flex items-center gap-2.5 py-1 text-left cursor-pointer"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0d4a3a] text-white dark:bg-emerald-500 dark:text-[#041e16]">
        <Compass className="h-4 w-4" />
      </div>
      {(!animate || open) && (
        <span className="font-display text-base font-semibold tracking-tight text-[#0b192c] whitespace-nowrap dark:text-[#e6f0ec]">
          GreenMap
        </span>
      )}
    </button>
  );
}

function SidebarThemeAction({
  theme,
  onToggleTheme,
  onNavigate,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNavigate: (page: PageId) => void;
}) {
  const { open, animate } = useSidebar();
  const expanded = !animate || open;

  return (
    <div className="flex flex-col gap-1.5 border-t border-[#d5e0db] pt-3 dark:border-[#1a3048]">
      <button
        type="button"
        onClick={onToggleTheme}
        className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-700 transition-colors hover:bg-emerald-600/10 hover:text-[#0d4a3a] dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300 cursor-pointer"
      >
        {theme === "dark" ? (
          <Sun className="h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <Moon className="h-4 w-4 shrink-0 text-[#0d4a3a]" />
        )}
        {expanded && (
          <span className="whitespace-nowrap">
            {theme === "dark" ? "Light Theme" : "Dark Theme"}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onNavigate("landing")}
        className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-[#0b192c] dark:text-slate-400 dark:hover:bg-[#12263d] dark:hover:text-slate-100 cursor-pointer"
      >
        <Home className="h-4 w-4 shrink-0" />
        {expanded && <span className="whitespace-nowrap">Landing Overview</span>}
      </button>
    </div>
  );
}

export function WorkspaceShell({
  activePage,
  onNavigate,
  theme,
  onToggleTheme,
  selectedRegion,
  onSelectRegion,
  children,
}: WorkspaceShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [regions, setRegions] = useState<ApiRegionSummary[]>([]);

  useEffect(() => {
    let active = true;
    fetchSafeJson<{ gisBackendStatus?: string }>("/api/basemap/status")
      .then((d) => {
        if (active && d) {
          setBackendOnline(d.gisBackendStatus === "connected");
        }
      })
      .catch(() => {
        if (active) setBackendOnline(false);
      });

    fetchRegions()
      .then((res) => {
        if (active) setRegions(res.regions);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const currentNav = NAV_ITEMS.find((n) => n.id === activePage);
  const dockItems = useMemo(
    () => NAV_ITEMS.filter((item) => DOCK_PAGE_IDS.includes(item.id)),
    []
  );

  const handleSelectApiRegion = (apiRegion: ApiRegionSummary) => {
    const preset = INDIA_REGIONS.find((r) => r.id === apiRegion.id);
    onSelectRegion(
      preset ?? {
        id: apiRegion.id,
        name: apiRegion.name,
        stateCode: apiRegion.stateCode,
        corridorName: `${apiRegion.name} State Domain`,
        focus: apiRegion.focus,
        centroid: apiRegion.centroid,
        bbox: apiRegion.bbox,
        elevationBand: "SRTM 30m Computed",
        terrainClass: "GeoBoundaries ADM1",
        publishedReferenceNote: "GeoBoundaries ADM1 + WRI verified state domain.",
        publishedSolarPotentialGw: apiRegion.publishedSolarPotentialGw,
        publishedWindPotentialGw: apiRegion.publishedWindPotentialGw,
        referenceSource: "GeoBoundaries / WRI / MNRE",
        liveGisMetrics: {
          status: "connected",
          meanGhiKwhM2Day: null,
          meanWindSpeedMs: null,
          suitableAreaKm2: null,
          estimatedCapacityGw: null,
          ahpCompositeIndex: null,
          endpointHint: `/api/v1/gis/tile/${apiRegion.id}`,
        },
      }
    );
    setCommandOpen(false);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#f5f8f6] text-[#0b192c] md:h-screen md:flex-row md:overflow-hidden dark:bg-[#07111e] dark:text-[#e6f0ec]">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen}>
        <SidebarBody className="justify-between border-r border-[#d5e0db] bg-white dark:border-[#1a3048] dark:bg-[#0a1626]">
          <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <SidebarBrand onNavigate={onNavigate} />

            <nav className="mt-6 flex flex-col gap-1" aria-label="Workspace Navigation">
              {NAV_ITEMS.map((item) => {
                const isActive = item.id === activePage;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg transition-colors",
                      isActive
                        ? "bg-[#0d4a3a]/10 text-[#0d4a3a] dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#112236]"
                    )}
                  >
                    <SidebarLink
                      link={{
                        label: item.label,
                        href: `#${item.id}`,
                        icon: (
                          <span
                            className={cn(
                              "flex items-center justify-center px-1.5",
                              isActive
                                ? "text-[#0d4a3a] dark:text-emerald-400"
                                : "text-slate-500 dark:text-slate-400"
                            )}
                          >
                            {item.icon}
                          </span>
                        ),
                      }}
                      className="px-1.5 py-2"
                      {...({
                        onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
                          e.preventDefault();
                          onNavigate(item.id);
                          if (window.innerWidth < 768) {
                            setSidebarOpen(false);
                          }
                        },
                      } as Record<string, unknown>)}
                    />
                  </div>
                );
              })}
            </nav>
          </div>

          <SidebarThemeAction
            theme={theme}
            onToggleTheme={onToggleTheme}
            onNavigate={onNavigate}
          />
        </SidebarBody>
      </Sidebar>

      <div className="relative flex flex-1 flex-col md:overflow-hidden">
        {/* Workspace Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#d5e0db] bg-white/85 px-6 backdrop-blur-md dark:border-[#1a3048] dark:bg-[#0a1626]/85">
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="font-medium text-slate-500 transition-colors hover:text-[#0b192c] dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
            >
              GreenMap
            </button>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-[#0b192c] dark:text-[#e6f0ec] whitespace-nowrap">
              {currentNav?.label ?? "Workspace"}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#d5e0db] bg-[#f5f8f6] px-2.5 text-xs text-slate-600 transition-colors hover:border-emerald-500/40 hover:text-[#0b192c] dark:border-[#1a3048] dark:bg-[#07111e] dark:text-slate-300 dark:hover:text-emerald-300 cursor-pointer"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Jump to State or Tool</span>
                  <kbd className="hidden rounded border border-[#d5e0db] bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline dark:border-[#1a3048] dark:bg-[#0c1b2e] dark:text-slate-400">
                    ⌘K
                  </kbd>
                </button>
              </TooltipTrigger>
              <TooltipContent>Open Command Palette (⌘K / Ctrl+K)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden items-center gap-1.5 font-mono text-xs text-slate-500 lg:inline-flex dark:text-slate-400">
                  <Activity
                    className={cn(
                      "h-3.5 w-3.5",
                      backendOnline
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-500"
                    )}
                  />
                  <span>
                    {backendOnline === null
                      ? "Checking GIS API..."
                      : backendOnline
                        ? "FastAPI GIS Connected"
                        : "GIS Backend Pending"}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Active Study Region: {selectedRegion.name} · Python FastAPI + GeoPandas + XGBoost
              </TooltipContent>
            </Tooltip>

            {activePage !== "gis-explorer" ? (
              <Button
                size="sm"
                onClick={() => onNavigate("gis-explorer")}
                className="bg-[#0d4a3a] text-white hover:bg-[#09382b] dark:bg-emerald-500 dark:text-[#041e16] dark:hover:bg-emerald-400 cursor-pointer whitespace-nowrap"
              >
                Open GIS Map
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate("ahp-calculator")}
                className="border-[#d5e0db] dark:border-[#1a3048] cursor-pointer whitespace-nowrap"
              >
                AHP Weights
              </Button>
            )}
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 overflow-y-auto p-5 pb-24 md:p-7 lg:pb-24">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>

        {/* 21st.dev / Motion-Primitives Interactive Quick-Jump Dock (Desktop) */}
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-30 hidden -translate-x-1/2 lg:block">
          <div className="pointer-events-auto">
            <Dock
              panelHeight={52}
              magnification={64}
              distance={110}
              className="border border-[#d5e0db]/90 bg-white/90 px-3 shadow-lg backdrop-blur-md dark:border-[#1a3048]/90 dark:bg-[#0c1b2e]/90"
            >
              {dockItems.map((item) => {
                const isActive = item.id === activePage;
                return (
                  <DockItem
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "aspect-square rounded-full border transition-colors cursor-pointer",
                      isActive
                        ? "border-emerald-500/60 bg-[#0d4a3a] text-white dark:bg-emerald-500 dark:text-[#041e16]"
                        : "border-[#d5e0db] bg-[#f5f8f6] text-slate-600 hover:text-[#0d4a3a] dark:border-[#1a3048] dark:bg-[#07111e] dark:text-slate-300 dark:hover:text-emerald-300"
                    )}
                  >
                    <DockLabel className="border-[#d5e0db] bg-white text-[#0b192c] dark:border-[#1a3048] dark:bg-[#0c1b2e] dark:text-emerald-200">
                      {item.shortLabel}
                    </DockLabel>
                    <DockIcon>{item.icon}</DockIcon>
                  </DockItem>
                );
              })}
            </Dock>
          </div>
        </div>
      </div>

      {/* Global Command Menu (cmdk) */}
      <CommandDialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="GreenMap Command Menu"
        description="Search GreenMap research modules, Indian states, or workspace actions."
      >
        <CommandInput placeholder="Search pages, Indian states, or actions..." />
        <CommandList>
          <CommandEmpty>No matching module or Indian state found.</CommandEmpty>

          <CommandGroup heading="Research Modules">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.shortLabel}`}
                onSelect={() => {
                  onNavigate(item.id);
                  setCommandOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                {activePage === item.id && (
                  <CommandShortcut>Active</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Switch Indian State / Study Domain">
            {(regions.length > 0 ? regions : []).slice(0, 18).map((region) => (
              <CommandItem
                key={region.id}
                value={`${region.name} ${region.stateCode} ${region.focus}`}
                onSelect={() => handleSelectApiRegion(region)}
              >
                <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>{region.name}</span>
                <CommandShortcut>
                  {region.stateCode} · {region.areaKm2.toLocaleString()} km²
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Workspace Actions">
            <CommandItem
              onSelect={() => {
                onToggleTheme();
                setCommandOpen(false);
              }}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-[#0d4a3a]" />
              )}
              <span>Switch to {theme === "dark" ? "Light" : "Dark"} Theme</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                onNavigate("landing");
                setCommandOpen(false);
              }}
            >
              <Home className="h-4 w-4" />
              <span>Return to Landing Overview</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
