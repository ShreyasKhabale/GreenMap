import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Adapted from 21st.dev community component: Liquid Glass Button (@designali-in/liquid-glass-button)
 * Uses SVG feDisplacementMap optical refraction + layered backdrop-blur + emerald/navy specular borders.
 */
const liquidbuttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 rounded-full text-sm font-medium transition-[color,box-shadow,transform] duration-200 cursor-pointer disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-emerald-500/15 dark:bg-emerald-400/10 text-[#0b192c] dark:text-emerald-50 hover:scale-[1.03] active:scale-[0.98]",
        primary:
          "bg-[#0d4a3a]/90 dark:bg-emerald-500/20 text-white dark:text-emerald-50 hover:scale-[1.03] active:scale-[0.98]",
        outline:
          "bg-white/40 dark:bg-[#0c1b2e]/50 text-[#0b192c] dark:text-slate-100 border border-emerald-700/25 dark:border-emerald-400/25 hover:scale-[1.02]",
        ghost:
          "bg-transparent hover:bg-emerald-500/10 text-[#0b192c] dark:text-slate-200",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 px-4 text-xs",
        lg: "h-11 px-6 text-sm",
        xl: "h-12 px-8 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function GlassFilter() {
  return (
    <svg className="hidden" aria-hidden="true">
      <defs>
        <filter
          id="greenmap-liquid-glass"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.045 0.045"
            numOctaves="1"
            seed="2"
            result="turbulence"
          />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale="48"
            xChannelSelector="R"
            yChannelSelector="B"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="3" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}

export interface LiquidButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidbuttonVariants> {
  asChild?: boolean;
}

export function LiquidButton({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: LiquidButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="liquid-button"
      className={cn("relative isolate", liquidbuttonVariants({ variant, size, className }))}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-full shadow-[inset_2px_2px_4px_-1px_rgba(255,255,255,0.65),inset_-2px_-2px_4px_-1px_rgba(16,185,129,0.35),0_4px_16px_rgba(7,17,30,0.18)] dark:shadow-[inset_2px_2px_4px_-1px_rgba(52,211,153,0.35),inset_-2px_-2px_4px_-1px_rgba(7,17,30,0.8),0_6px_20px_rgba(0,0,0,0.45)] transition-all"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 overflow-hidden rounded-full backdrop-blur-md"
        style={{ backdropFilter: 'url("#greenmap-liquid-glass") blur(8px)' }}
      />
      <span className="relative z-10 flex items-center justify-center gap-2 whitespace-nowrap">
        {children}
      </span>
      <GlassFilter />
    </Comp>
  );
}
