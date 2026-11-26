import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Adapted from 21st.dev community component: Animate Card Animation (@moazamtrade/animate-card-animation)
 * Interactive stacked research layer cards with smooth motion transitions and keyboard/button controls.
 */
export interface AnimatedStackItem {
  id: string;
  index: string;
  title: string;
  source: string;
  resolution: string;
  summary: string;
  metricLabel: string;
  metricValue: string;
}

interface AnimatedCardStackProps {
  items: AnimatedStackItem[];
  className?: string;
}

export function AnimatedCardStack({ items, className }: AnimatedCardStackProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % items.length);
  };

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative h-[280px] w-full">
        <AnimatePresence mode="popLayout">
          {items.map((item, idx) => {
            const offset = (idx - activeIndex + items.length) % items.length;
            if (offset > 2) return null;

            const isFront = offset === 0;
            return (
              <motion.div
                key={item.id}
                style={{
                  zIndex: items.length - offset,
                  originY: 1,
                }}
                initial={{ scale: 0.92, y: 24, opacity: 0 }}
                animate={{
                  scale: 1 - offset * 0.045,
                  y: offset * 14,
                  opacity: isFront ? 1 : 0.72 - offset * 0.2,
                }}
                exit={{ scale: 0.94, y: -24, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onClick={isFront ? handleNext : undefined}
                className={cn(
                  "absolute inset-0 flex flex-col justify-between rounded-xl border p-6 transition-colors",
                  isFront
                    ? "cursor-pointer border-emerald-600/30 bg-white shadow-sm dark:border-emerald-400/25 dark:bg-[#0c1b2e]"
                    : "pointer-events-none border-[#d5e0db] bg-[#f5f8f6] dark:border-[#1a3048] dark:bg-[#0a1626]"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{item.index}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.source}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{item.resolution}</span>
                    </div>
                    <h4 className="text-lg font-semibold text-[#0b192c] dark:text-[#e6f0ec]">
                      {item.title}
                    </h4>
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {item.summary}
                </p>

                <div className="flex items-center justify-between border-t border-[#d5e0db] pt-4 dark:border-[#1a3048]">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {item.metricLabel}
                  </span>
                  <span className="font-mono text-sm font-semibold text-[#0d4a3a] tabular-nums dark:text-emerald-400">
                    {item.metricValue}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-1.5">
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`View ${item.title}`}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200 cursor-pointer",
                idx === activeIndex
                  ? "w-6 bg-[#0d4a3a] dark:bg-emerald-400"
                  : "w-2 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700"
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous GIS layer card"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0db] bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e] dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next GIS layer card"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0db] bg-white text-slate-700 transition-colors hover:bg-slate-50 dark:border-[#1a3048] dark:bg-[#0c1b2e] dark:text-slate-200 dark:hover:bg-[#12263d] cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
