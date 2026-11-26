import { Database, Loader2, ServerOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingBackendBannerProps {
  title: string;
  description: string;
  endpoint?: string;
  className?: string;
}

export function PendingBackendBanner({
  title,
  description,
  endpoint,
  className,
}: PendingBackendBannerProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-[#d5e0db] bg-[#eef4f1] p-4 text-sm dark:border-[#1a3048] dark:bg-[#0c1b2e]/90 md:flex-row md:items-center md:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-700/20 bg-emerald-600/10 text-[#0d4a3a] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-400">
          <Database className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <div className="font-medium text-[#0b192c] dark:text-[#e6f0ec]">{title}</div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {description}
          </p>
        </div>
      </div>

      {endpoint && (
        <div className="shrink-0 rounded-lg border border-[#d5e0db] bg-white px-3 py-1.5 font-mono text-xs text-slate-600 dark:border-[#1a3048] dark:bg-[#07111e] dark:text-emerald-300/90">
          {endpoint}
        </div>
      )}
    </div>
  );
}

interface PlaceholderChartFrameProps {
  title: string;
  subtitle: string;
  endpoint: string;
  heightClass?: string;
  loading?: boolean;
  children?: React.ReactNode;
}

export function PlaceholderChartFrame({
  title,
  subtitle,
  endpoint,
  heightClass = "h-[260px]",
  loading = false,
  children,
}: PlaceholderChartFrameProps) {
  return (
    <div className="rounded-xl border border-[#d5e0db] bg-white p-5 dark:border-[#1a3048] dark:bg-[#0c1b2e]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#0b192c] dark:text-[#e6f0ec]">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <span className="font-mono text-xs text-amber-700 dark:text-amber-300">
          Placeholder · Awaiting GIS Data
        </span>
      </div>

      <div
        className={cn(
          "relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#cbd8d2] bg-[#f5f8f6] p-6 text-center dark:border-[#1e3550] dark:bg-[#07111e]/70",
          heightClass
        )}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2.5 text-slate-500 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-medium">Querying GIS raster schema...</span>
          </div>
        ) : (
          <>
            {children}
            <div className="relative z-10 flex max-w-md flex-col items-center gap-2">
              <ServerOff className="h-5 w-5 text-slate-400 dark:text-slate-500" />
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                No fabricated raster series rendered
              </div>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                This visualization container is wired for backend GIS telemetry. Connect the
                endpoint below to populate live measurements.
              </p>
              <code className="mt-1 rounded border border-[#d5e0db] bg-white px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-[#1a3048] dark:bg-[#0c1b2e] dark:text-emerald-300">
                {endpoint}
              </code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
