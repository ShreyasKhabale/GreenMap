"use client";
import { cn } from "@/lib/utils";
import React, { ReactNode } from "react";

interface AuroraBackgroundProps extends React.HTMLProps<HTMLDivElement> {
  children: ReactNode;
  showRadialGradient?: boolean;
}

export const AuroraBackground = ({
  className,
  children,
  showRadialGradient = true,
  ...props
}: AuroraBackgroundProps) => {
  return (
    <div
      className={cn(
        "transition-bg relative flex flex-col items-center justify-center bg-[#f4f8f6] text-[#0b192c] dark:bg-[#07111e] dark:text-[#e6f0ec]",
        className
      )}
      {...props}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={
          {
            "--aurora":
              "repeating-linear-gradient(100deg,#059669_10%,#0d4a3a_15%,#10b981_20%,#0f766e_25%,#0284c7_30%)",
            "--dark-gradient":
              "repeating-linear-gradient(100deg,#07111e_0%,#07111e_7%,transparent_10%,transparent_12%,#07111e_16%)",
            "--white-gradient":
              "repeating-linear-gradient(100deg,#f4f8f6_0%,#f4f8f6_7%,transparent_10%,transparent_12%,#f4f8f6_16%)",

            "--emerald-500": "#10b981",
            "--emerald-600": "#059669",
            "--forest-800": "#0d4a3a",
            "--teal-700": "#0f766e",
            "--navy-600": "#0284c7",
            "--navy-950": "#07111e",
            "--mist-50": "#f4f8f6",
            "--transparent": "transparent",
          } as React.CSSProperties
        }
      >
        <div
          className={cn(
            `after:animate-aurora pointer-events-none absolute -inset-[10px] [background-image:var(--white-gradient),var(--aurora)] [background-size:300%,_200%] [background-position:50%_50%,50%_50%] opacity-40 blur-[14px] invert filter will-change-transform [--aurora:repeating-linear-gradient(100deg,var(--emerald-600)_10%,var(--forest-800)_15%,var(--emerald-500)_20%,var(--teal-700)_25%,var(--navy-600)_30%)] [--dark-gradient:repeating-linear-gradient(100deg,var(--navy-950)_0%,var(--navy-950)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--navy-950)_16%)] [--white-gradient:repeating-linear-gradient(100deg,var(--mist-50)_0%,var(--mist-50)_7%,var(--transparent)_10%,var(--transparent)_12%,var(--mist-50)_16%)] after:absolute after:inset-0 after:[background-image:var(--white-gradient),var(--aurora)] after:[background-size:200%,_100%] after:[background-attachment:fixed] after:mix-blend-difference after:content-[""] dark:[background-image:var(--dark-gradient),var(--aurora)] dark:opacity-55 dark:invert-0 after:dark:[background-image:var(--dark-gradient),var(--aurora)]`,
            showRadialGradient &&
              `[mask-image:radial-gradient(ellipse_at_85%_10%,black_15%,var(--transparent)_75%)]`
          )}
        />
      </div>
      {children}
    </div>
  );
};
