import {
  ArrowRight,
  Calculator,
  Compass,
  Database,
  FileBarChart2,
  GitCompare,
  Globe2,
  Moon,
  Sun,
  Wind,
} from "lucide-react";
import { Suspense, lazy } from "react";
import { AuroraBackground } from "@/components/ui/aurora-background";
const ShaderAnimation = lazy(() =>
  import("@/components/ui/shader-animation").then((m) => ({ default: m.ShaderAnimation }))
);
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { AnimatedCardStack } from "@/components/ui/animate-card-animation";
import { BentoGrid } from "@/components/ui/bento-grid";
import { MagicCard } from "@/components/ui/magic-card";
import { BlurFade } from "@/components/ui/blur-fade";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { BorderBeam } from "@/components/ui/border-beam";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { TextEffect } from "@/components/ui/text-effect";
import {
  HERO_IMAGE_PATH,
  LANDING_LAYER_CARDS,
} from "@/data/indiaRenewableData";
import type { PageId } from "@/types/greenmap";

interface LandingPageProps {
  onNavigate: (page: PageId) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function LandingPage({
  onNavigate,
  theme,
  onToggleTheme,
}: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#f5f8f6] text-[#0b192c] dark:bg-[#07111e] dark:text-[#e6f0ec]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-50 border-b border-[#d5e0db]/80 bg-white/80 backdrop-blur-md dark:border-[#1a3048]/80 dark:bg-[#07111e]/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="font-display text-lg font-bold tracking-tight text-[#0b192c] whitespace-nowrap shrink-0 cursor-pointer dark:text-[#e6f0ec]"
          >
            GreenMap
          </button>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav
            className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex dark:text-slate-300"
            aria-label="Primary Navigation"
          >
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="hover:text-[#0d4a3a] dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => onNavigate("gis-explorer")}
              className="hover:text-[#0d4a3a] dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              GIS Explorer
            </button>
            <button
              type="button"
              onClick={() => onNavigate("ahp-calculator")}
              className="hover:text-[#0d4a3a] dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              AHP Model
            </button>
            <button
              type="button"
              onClick={() => onNavigate("methodology")}
              className="hover:text-[#0d4a3a] dark:hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Methodology
            </button>
          </nav>

          {/* Zone 3: 1 Primary CTA */}
          <div className="flex items-center shrink-0">
            <LiquidButton
              size="sm"
              variant="primary"
              onClick={() => onNavigate("dashboard")}
            >
              Launch Workspace
              <ArrowRight className="h-3.5 w-3.5" />
            </LiquidButton>
          </div>
        </div>
      </header>

      {/* Hero Section: 21st.dev AuroraBackground + Three.js ShaderAnimation */}
      <section className="relative overflow-hidden border-b border-[#d5e0db] dark:border-[#1a3048]">
        <AuroraBackground className="min-h-[580px] py-16 md:py-24">
          {/* Subtle WebGL Shader Backdrop in Dark Mode */}
          <div className="pointer-events-none absolute inset-0 hidden opacity-45 dark:block">
            <Suspense fallback={null}>
              <ShaderAnimation />
            </Suspense>
          </div>

          <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-emerald-300/90">
                <span>India Academic Renewable Research Platform</span>
                <span aria-hidden="true">·</span>
                <span>GIS &amp; Multi-Criteria Decision Analytics</span>
              </div>

              <TextEffect
                as="h1"
                per="word"
                preset="fade-in-blur"
                speedReveal={2}
                className="max-w-2xl font-display text-[clamp(2.25rem,4.2vw,3.75rem)] font-bold leading-[1.08] tracking-tight text-balance text-[#0b192c] dark:text-[#f0f7f4]"
              >
                Mapping India's solar and wind potential with spatial rigor.
              </TextEffect>

              <p className="max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
                GreenMap unifies interactive MapLibre geospatial exploration, terrain and land-use
                exclusion modeling, and Saaty&apos;s Analytic Hierarchy Process (AHP) into a clean
                research workspace prepared for national raster and PostGIS feeds.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <ShimmerButton
                  type="button"
                  onClick={() => onNavigate("gis-explorer")}
                  shimmerColor="#6ee7b7"
                  background="#0d4a3a"
                  borderRadius="9999px"
                  className="h-11 gap-2 px-6 text-sm font-medium shadow-md"
                >
                  <span>Open GIS Explorer</span>
                  <Globe2 className="h-4 w-4" />
                </ShimmerButton>

                <LiquidButton
                  size="lg"
                  variant="outline"
                  onClick={() => onNavigate("dashboard")}
                >
                  View Dashboard
                </LiquidButton>

                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-[#d5e0db] bg-white/70 px-4 text-xs font-medium text-slate-700 backdrop-blur transition-colors hover:bg-white dark:border-[#1a3048] dark:bg-[#0c1b2e]/70 dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
                >
                  {theme === "dark" ? (
                    <>
                      <Sun className="h-3.5 w-3.5 text-amber-400" />
                      <span>Switch to Light</span>
                    </>
                  ) : (
                    <>
                      <Moon className="h-3.5 w-3.5 text-[#0d4a3a]" />
                      <span>Switch to Dark</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Interactive 21st.dev Animate Card Stack showcasing Core GIS Layers */}
            <div className="lg:col-span-5">
              <AnimatedCardStack items={LANDING_LAYER_CARDS} />
            </div>
          </div>
        </AuroraBackground>
      </section>

      {/* Aerial Geographic Context + Institutional Framing */}
      <section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
        <BlurFade delay={0.05} inView>
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
            <div className="relative overflow-hidden rounded-xl border border-[#d5e0db] bg-[#0c1b2e] lg:col-span-7 dark:border-[#1a3048]">
              <BorderBeam
                size={150}
                duration={9}
                colorFrom="#10b981"
                colorTo="#0284c7"
              />
              <img
                src={HERO_IMAGE_PATH}
                alt="Aerial view of hybrid solar photovoltaic arrays and wind turbines across an Indian plateau"
                referrerPolicy="no-referrer"
                className="h-full min-h-[280px] w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#07111e]/90 via-[#07111e]/30 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-4 text-white">
                <div className="space-y-1">
                  <div className="text-xs text-emerald-300">
                    Study Domain · 68.1°E to 97.4°E · 6.7°N to 35.5°N
                  </div>
                  <div className="font-display text-lg font-semibold">
                    Hybrid Corridor Assessment Framework
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate("methodology")}
                  className="rounded-lg border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-white/20 cursor-pointer"
                >
                  Inspect Data Sources
                </button>
              </div>
            </div>

            <div className="relative flex flex-col justify-between rounded-xl border border-[#d5e0db] bg-white p-7 lg:col-span-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
              <GlowingEffect
                spread={36}
                glow={true}
                disabled={false}
                proximity={64}
                inactiveZone={0.01}
                borderWidth={2}
              />
              <div className="relative z-10 space-y-4">
                <h2 className="font-display text-2xl font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                  Built for transparent spatial modeling
                </h2>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Every analytical view separates published institutional reference catalogs (MNRE
                  and NIWE state baselines) from live raster computations. No synthetic metrics are
                  injected when backend GIS pipelines are disconnected.
                </p>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[#d5e0db] pt-6 dark:border-[#1a3048]">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Priority Corridors</dt>
                  <dd className="mt-1 font-mono text-xl font-semibold text-[#0b192c] tabular-nums dark:text-emerald-400">
                    8 States
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">AHP Criteria</dt>
                  <dd className="mt-1 font-mono text-xl font-semibold text-[#0b192c] tabular-nums dark:text-emerald-400">
                    6 Factors
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Map Engine</dt>
                  <dd className="mt-1 font-mono text-sm font-medium text-[#0b192c] dark:text-slate-200">
                    MapLibre GL JS
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">Coordinate CRS</dt>
                  <dd className="mt-1 font-mono text-sm font-medium text-[#0b192c] dark:text-slate-200">
                    EPSG:4326
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </BlurFade>
      </section>

      {/* Platform Architecture Bento Grid using 21st.dev BentoGrid + MagicCard + BackgroundBeams */}
      <section className="relative overflow-hidden border-t border-[#d5e0db] bg-white/60 py-16 md:py-20 dark:border-[#1a3048] dark:bg-[#091524]">
        <BackgroundBeams className="opacity-35 dark:opacity-55" />
        <div className="relative z-10 mx-auto max-w-7xl px-6">
          <div className="mb-10 max-w-2xl space-y-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-[#0b192c] md:text-3xl dark:text-[#e6f0ec]">
              Ten integrated research modules
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Navigate directly into any analytical module—from interactive India-wide GIS mapping
              to pairwise AHP consistency modeling and academic report preparation.
            </p>
          </div>

          <BentoGrid className="md:auto-rows-[13rem]">
            <MagicCard
              gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
              gradientFrom="#10b981"
              gradientTo="#0284c7"
              className="rounded-xl md:col-span-2"
            >
              <button
                type="button"
                onClick={() => onNavigate("gis-explorer")}
                className="flex h-full w-full flex-col justify-between p-6 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <Globe2 className="h-5 w-5 text-[#0d4a3a] dark:text-emerald-400" />
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    MapLibre WebGL
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    01. Interactive India GIS Explorer
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    State and corridor vector boundaries, solar/wind layer controls, terrain filters,
                    opacity sliders, legends, and site inspection drawers.
                  </p>
                </div>
              </button>
            </MagicCard>

            <MagicCard
              gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
              gradientFrom="#10b981"
              gradientTo="#0284c7"
              className="rounded-xl"
            >
              <button
                type="button"
                onClick={() => onNavigate("ahp-calculator")}
                className="flex h-full w-full flex-col justify-between p-6 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <Calculator className="h-5 w-5 text-[#0d4a3a] dark:text-emerald-400" />
                  <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    Live Math
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    02. AHP Calculator
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    6×6 Saaty pairwise matrix with live priority vector weights and Consistency Ratio
                    (CR &lt; 0.10) verification.
                  </p>
                </div>
              </button>
            </MagicCard>

            <MagicCard
              gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
              gradientFrom="#f59e0b"
              gradientTo="#10b981"
              className="rounded-xl"
            >
              <button
                type="button"
                onClick={() => onNavigate("solar-analysis")}
                className="flex h-full w-full flex-col justify-between p-6 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <Sun className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    Solargis / NASA
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    03. Solar PV Analysis
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Tilt, azimuth, performance ratio, and GHI threshold controls with MNRE state
                    reference baselines.
                  </p>
                </div>
              </button>
            </MagicCard>

            <MagicCard
              gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
              gradientFrom="#0284c7"
              gradientTo="#10b981"
              className="rounded-xl"
            >
              <button
                type="button"
                onClick={() => onNavigate("wind-analysis")}
                className="flex h-full w-full flex-col justify-between p-6 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <Wind className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    NIWE 100m–150m
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    04. Wind Corridor Analysis
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Hub-height shear scaling, Weibull schema slots, and coastal/pass wind resource
                    comparison.
                  </p>
                </div>
              </button>
            </MagicCard>

            <MagicCard
              gradientColor={theme === "dark" ? "#0d4a3a" : "#d1fae5"}
              gradientFrom="#10b981"
              gradientTo="#0f766e"
              className="rounded-xl"
            >
              <button
                type="button"
                onClick={() => onNavigate("location-comparison")}
                className="flex h-full w-full flex-col justify-between p-6 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <GitCompare className="h-5 w-5 text-[#0d4a3a] dark:text-emerald-400" />
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    Multi-Site Matrix
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                    05. Comparison &amp; Reports
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Side-by-side state corridor evaluation, AI query schema builder, and academic
                    report previews.
                  </p>
                </div>
              </button>
            </MagicCard>
          </BentoGrid>
        </div>
      </section>

      {/* Quiet Academic Footer */}
      <footer className="border-t border-[#d5e0db] bg-[#f5f8f6] py-8 dark:border-[#1a3048] dark:bg-[#07111e]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-6 text-xs text-slate-500 md:flex-row md:items-center dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-[#0d4a3a] dark:text-emerald-400" />
            <span className="font-medium text-[#0b192c] dark:text-slate-200">
              GreenMap Academic Research Platform
            </span>
            <span aria-hidden="true">·</span>
            <span>India Renewable Energy Potential Mapping</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => onNavigate("dashboard")}
              className="hover:text-[#0b192c] dark:hover:text-slate-200 cursor-pointer"
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => onNavigate("ai-analytics")}
              className="hover:text-[#0b192c] dark:hover:text-slate-200 cursor-pointer"
            >
              AI Analytics
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports")}
              className="hover:text-[#0b192c] dark:hover:text-slate-200 cursor-pointer"
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => onNavigate("methodology")}
              className="inline-flex items-center gap-1 hover:text-[#0b192c] dark:hover:text-slate-200 cursor-pointer"
            >
              <Database className="h-3.5 w-3.5" />
              <span>Data Sources</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports")}
              className="inline-flex items-center gap-1 hover:text-[#0b192c] dark:hover:text-slate-200 cursor-pointer"
            >
              <FileBarChart2 className="h-3.5 w-3.5" />
              <span>Export Schemas</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
