"use client";

/**
 * MixChart, from https://motion-brew.com/components/mix-chart
 *
 * One self contained file: the component, its animated icons and the cn()
 * helper. Needs React 18 or 19 and Tailwind CSS v4.
 *
 * MIT License, Copyright (c) 2026 Md Eftakher. Free for personal and
 * commercial use: copy it, change it, ship it.
 *
 * The animated icons are adapted from lucide-animated (https://lucide-animated.com),
 * MIT License, Copyright (c) 2024-2026 pqoqubbw. Icon shapes from Lucide
 * (https://lucide.dev), ISC License. Permission is hereby granted, free of
 * charge, to any person obtaining a copy of this software, to deal in it
 * without restriction, provided the above copyright notice and this
 * permission notice are included in all copies or substantial portions.
 */

import * as React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { type ClassValue, clsx } from "clsx";
import { animate, AnimatePresence, motion, useAnimation, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: arrow-up-right
const ArrowUpRightIcon = (() => {
interface ArrowUpRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ArrowUpRightIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const ARROW_VARIANTS: Variants = {
  normal: {
    scale: 1,
    translateX: 0,
    translateY: 0,
  },
  animate: {
    scale: [1, 0.85, 1],
    translateX: [0, -4, 0],
    translateY: [0, 4, 0],
    originX: 1,
    originY: 0,
    transition: {
      duration: 0.5,
      ease: "easeInOut",
    },
  },
};

const ArrowUpRightIcon = forwardRef<
  ArrowUpRightIconHandle,
  ArrowUpRightIconProps
>(({ onMouseEnter, onMouseLeave, className, size, active, style, strokeWidth, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (!isControlledRef.current) controls.start("animate");
      onMouseEnter?.(e);
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      if (!isControlledRef.current) controls.start("normal");
      onMouseLeave?.(e);
    },
    [controls, onMouseLeave]
  );
    // Play with the nearest interactive parent, or whenever `active` is set.
    // Reduced motion keeps the icon still.
    const wrap = useRef<HTMLSpanElement>(null);
    const reduced = useReducedMotion();
    const [hosted, setHosted] = useState(false);
    useEffect(() => {
      if (typeof window === "undefined") return;
      const fake = {} as React.MouseEvent<HTMLSpanElement>;
      if (reduced) {
        setHosted(true);
        return;
      }
      if (active !== undefined) {
        setHosted(true);
        (active ? handleMouseEnter : handleMouseLeave)(fake);
        return;
      }
      const host = wrap.current?.parentElement?.closest<HTMLElement>("button, a, [role=button], [role=menuitem], [role=tab], [role=switch], [role=radio], label");
      setHosted(!!host);
      if (!host) return;
      const on = () => handleMouseEnter(fake);
      const off = () => handleMouseLeave(fake);
      host.addEventListener("pointerenter", on);
      host.addEventListener("pointerleave", off);
      return () => {
        host.removeEventListener("pointerenter", on);
        host.removeEventListener("pointerleave", off);
      };
    }, [active, reduced, handleMouseEnter, handleMouseLeave]);

  return (
    <span
      ref={wrap}
      className={cn("inline-grid size-6 shrink-0 place-items-center align-middle [&>svg]:size-full", className)}
      style={size ? { width: size, height: size, ...style } : style}
      onMouseEnter={hosted ? undefined : handleMouseEnter}
      onMouseLeave={hosted ? undefined : handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth ?? 2}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <motion.g animate={controls} variants={ARROW_VARIANTS}>
          <path d="M7 7H17" />
          <path d="M17 7V17" />
          <path d="M7 17L17 7" />
        </motion.g>
      </svg>
    </span>
  );
});

ArrowUpRightIcon.displayName = "ArrowUpRightIcon";
  return ArrowUpRightIcon;
})();

// MixChart

/**
 * MixChart
 *
 * Trigger: in view, then hover, press and keys. A white chart card of stacked
 * bars, each bar split into a few vivid segments with small gaps between them.
 * When it scrolls into view the gridlines draw in and the bars grow from the
 * baseline one after another, each segment stacking on the one below, while
 * the total counts up. One bar is chosen and shows its full colours; the rest
 * sit in soft hatched tints of theirs. Hover, tap or arrow to another bar and
 * the colours move there; point at one of its segments and only that segment
 * keeps its full colour while a small white card just above it names that
 * source and its value, one source at a time. Click a source in the legend to switch it off or on: its segments
 * shrink away or grow back, the scale eases to fit and the total recounts.
 * Switch the range and new bars grow in as the total counts to the new figure.
 * Reduced motion shows every state at once.
 *
 * Engine: motion/react (spring heights for the segments, a motion value
 * counting the total, layoutId for the range pill, AnimatePresence for the
 * bars and the tooltip card).
 */

export interface MixSeries {
  key: string;
  label: string;
  /** A vivid colour for this source. */
  color: string;
}

export interface MixPoint {
  /** Short label under the bar, as in `"Mon"`. */
  label: string;
  /** Longer label in the tooltip, as in `"Monday 10 Nov"`. */
  detail?: string;
  /** One value per series, in series order. */
  values: number[];
}

export interface MixRange {
  id: string;
  /** Label on the range switch, as in `"Week"`. */
  label: string;
  points: MixPoint[];
  /** Change against the period before, in percent, shown as a chip. */
  change?: number;
  /** Shown under the total, as in `"used this week"`. */
  caption?: string;
}

export interface MixChartProps {
  /** Card title. Default `"Home energy"`. */
  title?: string;
  /** The sources, bottom of the stack first. Default solar, battery and grid. */
  series?: MixSeries[];
  /** The ranges on the switch, the first shown first. Default a week, a month and a year. */
  ranges?: MixRange[];
  /** Unit after the numbers. Default `"kWh"`. */
  unit?: string;
  /** Decimal places on the total and the tooltip. Default `1`. */
  decimals?: number;
  /** Message shown when the active range has no bars. */
  emptyText?: string;
  className?: string;
}

const DEFAULT_SERIES: MixSeries[] = [
  { key: "solar", label: "Solar", color: "#D8FF0A" },
  { key: "battery", label: "Battery", color: "#14FF73" },
  { key: "grid", label: "Grid", color: "#60A5FA" },
];

const WEEK: MixPoint[] = [
  { label: "Mon", detail: "Monday", values: [14.2, 5.1, 6.8] },
  { label: "Tue", detail: "Tuesday", values: [11.5, 4.2, 9.3] },
  { label: "Wed", detail: "Wednesday", values: [16.8, 6.0, 4.1] },
  { label: "Thu", detail: "Thursday", values: [9.4, 3.6, 11.2] },
  { label: "Fri", detail: "Friday", values: [17.9, 6.4, 3.2] },
  { label: "Sat", detail: "Saturday", values: [19.6, 7.1, 2.4] },
  { label: "Sun", detail: "Sunday", values: [18.3, 6.8, 3.9] },
];
const YEAR: MixPoint[] = [
  ["Jan", "January", 180, 60, 310],
  ["Feb", "February", 220, 75, 260],
  ["Mar", "March", 320, 110, 190],
  ["Apr", "April", 410, 140, 130],
  ["May", "May", 480, 165, 90],
  ["Jun", "June", 530, 180, 70],
  ["Jul", "July", 550, 185, 65],
  ["Aug", "August", 500, 170, 80],
  ["Sep", "September", 400, 140, 120],
  ["Oct", "October", 300, 105, 180],
  ["Nov", "November", 210, 80, 250],
  ["Dec", "December", 160, 55, 320],
].map(([label, detail, a, b, c]) => ({
  label: label as string,
  detail: detail as string,
  values: [a as number, b as number, c as number],
}));

const MONTH: MixPoint[] = [
  { label: "W1", detail: "Week 1, Oct 20 to 26", values: [96.4, 34.8, 58.2] },
  { label: "W2", detail: "Week 2, Oct 27 to Nov 2", values: [88.1, 31.5, 66.7] },
  { label: "W3", detail: "Week 3, Nov 3 to 9", values: [102.6, 37.2, 49.9] },
  { label: "W4", detail: "Week 4, Nov 10 to 16", values: [107.7, 39.2, 40.9] },
];

const DEFAULT_RANGES: MixRange[] = [
  { id: "week", label: "Week", points: WEEK, change: 12.4, caption: "used this week" },
  { id: "month", label: "Month", points: MONTH, change: 6.8, caption: "used in the last four weeks" },
  { id: "year", label: "Year", points: YEAR, change: 18.2, caption: "used this year" },
];

const EASE = [0.22, 1, 0.36, 1] as const;
const GROW = { type: "spring", stiffness: 210, damping: 24 } as const;
const PILL = { type: "spring", stiffness: 500, damping: 38 } as const;
const SEG_GAP = 3;
const CHART_H = 168;

/** A round axis top and step for the largest stack: 4 even steps. */
function niceScale(max: number) {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return { top: step * 4, step };
}

const fmt = (n: number, d: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (n: number) => {
  if (n >= 1_000_000_000) return `${fmt(n / 1_000_000_000, n % 1_000_000_000 ? 1 : 0)}B`;
  if (n >= 1_000_000) return `${fmt(n / 1_000_000, n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${fmt(n / 1000, n % 1000 ? 1 : 0)}k`;
  return fmt(n, n % 1 ? 1 : 0);
};

/** The total, counting to its value whenever it changes. */
function Total({ value, decimals, run, still }: { value: number; decimals: number; run: boolean; still: boolean }) {
  const mv = useMotionValue(still ? value : 0);
  const [text, setText] = React.useState(() => fmt(still ? value : 0, decimals));
  useMotionValueEvent(mv, "change", (v) => setText(fmt(v, decimals)));
  const first = React.useRef(true);
  React.useEffect(() => {
    if (!run) return;
    if (still) {
      mv.set(value);
      setText(fmt(value, decimals));
      return;
    }
    const c = animate(mv, value, { duration: first.current ? 1.2 : 0.6, delay: first.current ? 0.2 : 0, ease: EASE });
    first.current = false;
    return () => c.stop();
  }, [value, decimals, run, still, mv]);
  return <span className="tabular-nums">{text}</span>;
}

export const MixChart = React.forwardRef<HTMLDivElement, MixChartProps>(function MixChart(
  {
    title = "Home energy",
    series = DEFAULT_SERIES,
    ranges = DEFAULT_RANGES,
    unit = "kWh",
    decimals = 1,
    emptyText = "No usage data recorded in this window yet.",
    className,
  },
  forwardedRef,
) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const still = !!useReducedMotion();
  const shown = still || inView;
  const uid = React.useId();

  const [rangeId, setRangeId] = React.useState(ranges[0]?.id);
  const range = ranges.find((r) => r.id === rangeId) ?? ranges[0];
  const points = range?.points ?? [];
  const hasPoints = points.length > 0 && series.length > 0;
  // Whole numbers stay whole: a range of integers drops the decimals.
  const dp = hasPoints && points.every((pt) => pt.values.every(Number.isInteger)) ? 0 : decimals;
  const [off, setOff] = React.useState<Set<string>>(() => new Set());
  const visible = series.map((s) => !off.has(s.key));

  // The chosen bar rests on the last one; hover, tap and keys move it.
  // What you point at: a bar, and the segment (source) inside it.
  const [picked, setPicked] = React.useState<{ bar: number; seg: number } | null>(null);
  const resting = Math.max(0, points.length - 1);
  const active = Math.min(resting, picked?.bar ?? resting);
  React.useEffect(() => setPicked(null), [rangeId]);

  const stackOf = (p: MixPoint) => p.values.reduce((a, v, i) => a + (visible[i] ? v : 0), 0);
  const total = points.reduce((a, p) => a + stackOf(p), 0);
  const maxStack = hasPoints ? Math.max(0, ...points.map(stackOf)) : 0;
  const { top, step } = niceScale(maxStack);

  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < series.length - 1) next.add(key);
      return next;
    });

  // The sources that are on, bottom first, and the top one: where focus lands.
  const onSeries = series.map((_, i) => i).filter((i) => visible[i]);
  const topSeg = onSeries[onSeries.length - 1] ?? 0;
  const segOf = (seg: number) => (visible[seg] ? seg : topSeg);

  const bars = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (!hasPoints) return;
    const seg = segOf(picked?.seg ?? topSeg);
    const at = onSeries.indexOf(seg);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Up and down move between the sources in this bar.
      e.preventDefault();
      const next = onSeries[Math.max(0, Math.min(onSeries.length - 1, at + (e.key === "ArrowUp" ? 1 : -1)))] ?? topSeg;
      setPicked({ bar: i, seg: next });
      return;
    }
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: points.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const n = Math.max(0, Math.min(points.length - 1, to));
    setPicked({ bar: n, seg });
    bars.current[n]?.focus();
  };

  // The tooltip sits just above the segment you point at, and names only it.
  const tipSeg = picked ? segOf(picked.seg) : topSeg;
  const p = hasPoints ? points[active] : undefined;
  const below = onSeries.filter((i) => i <= tipSeg);
  const tipValue = p ? below.reduce((a, i) => a + (p.values[i] ?? 0), 0) : 0;
  const tipLeft = hasPoints ? Math.min(84, Math.max(16, ((active + 0.5) / points.length) * 100)) : 50;
  const tipTop = CHART_H - (tipValue / top) * CHART_H - Math.max(0, below.length - 1) * SEG_GAP;
  const tipSeries = series[tipSeg];

  return (
    <motion.div
      ref={ref}
      initial={still ? false : { opacity: 0, y: 16 }}
      animate={shown ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, ease: EASE }}
      className={cn(
        "relative w-full max-w-full rounded-2xl border border-[#27272A] bg-[#111111] p-5 text-[#F4F4F5] shadow-none sm:p-6",
        className,
      )}
    >
      {/* Title and the range switch. */}
      {/* The range control drops under the title when they do not fit side by side. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-[#F4F4F5]">{title}</h3>
        {ranges.length > 1 ? (
          <div role="radiogroup" aria-label="Range" className="flex rounded-full border border-[#27272A] bg-[#18181B] p-0.5">
            {ranges.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={r.id === range?.id}
                onClick={() => setRangeId(r.id)}
                className="relative h-7 rounded-full px-3 text-xs font-medium text-[#A1A1AA] outline-none transition-colors hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60 aria-checked:text-[#0A0A0A]"
              >
                {r.id === range?.id && (
                  <motion.span
                    layoutId={`${uid}-range`}
                    transition={still ? { duration: 0 } : PILL}
                    className="absolute inset-0 rounded-full bg-[#D8FF0A] shadow-none"
                  />
                )}
                <span className="relative">{r.label}</span>
              </button>
            ))}
          </div>
        ) : range ? (
          <span className="inline-flex h-6 items-center rounded-full border border-[#27272A] bg-[#18181B] px-2.5 font-mono text-[11px] font-medium uppercase tracking-wider text-[#A1A1AA]">
            {range.label}
          </span>
        ) : null}
      </div>

      {/* The total and its change. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <p className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-[#F4F4F5]">
          <Total value={total} decimals={dp} run={shown} still={still} />
          <span className="ml-1.5 text-sm font-medium tracking-normal text-[#71717A]">{unit}</span>
        </p>
        {range?.change !== undefined && (
          <motion.span
            key={range.id}
            initial={still ? false : { opacity: 0, scale: 0.8 }}
            animate={shown ? { opacity: 1, scale: 1 } : undefined}
            transition={{ type: "spring", stiffness: 500, damping: 26, delay: still ? 0 : 0.4 }}
            className={cn(
              "inline-flex h-6 items-center gap-0.5 rounded-full border px-2 text-xs font-semibold tabular-nums",
              range.change >= 0
                ? "border-[#14FF73]/30 bg-[#14FF73]/15 text-[#14FF73]"
                : "border-[#F87171]/30 bg-[#F87171]/15 text-[#F87171]",
            )}
          >
            {range.change >= 0 ? "+" : ""}
            {range.change}%
            <ArrowUpRightIcon className={cn("size-3.5", range.change < 0 && "rotate-90")} active={shown} strokeWidth={2.5} />
          </motion.span>
        )}
      </div>
      {range?.caption && <p className="mt-1 text-xs text-[#A1A1AA]">{range.caption}</p>}

      {/* Legend: each source switches on and off. */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {series.map((s, i) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={visible[i]}
            onClick={() => toggle(s.key)}
            className="group/chip inline-flex h-7 items-center gap-1.5 rounded-full border border-[#27272A] bg-[#18181B] pl-2 pr-2.5 text-xs font-medium outline-none transition-colors hover:border-[#3F3F46] hover:bg-[#27272A]/70 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60"
          >
            <motion.span
              className="size-2.5 rounded-full"
              animate={{
                backgroundColor: visible[i] ? s.color : "rgba(0,0,0,0)",
                boxShadow: `inset 0 0 0 1.5px ${s.color}`,
                scale: visible[i] ? 1 : 0.8,
              }}
              transition={still ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 28 }}
            />
            <span className={cn("transition-colors", visible[i] ? "text-[#F4F4F5]" : "text-[#71717A]")}>
              {s.label}
            </span>
          </button>
        ))}
      </div>

      {/* The chart. */}
      <div className="mt-4 flex gap-2">
        {/* Axis labels. */}
        <div className="relative w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-[#71717A]" style={{ height: CHART_H }}>
          {[0, 1, 2, 3, 4].map((k) => (
            <motion.span
              key={`${top}-${k}`}
              initial={still ? false : { opacity: 0 }}
              animate={shown ? { opacity: 1 } : undefined}
              transition={{ duration: 0.4, delay: still ? 0 : 0.1 + k * 0.05 }}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: CHART_H - (k * step * CHART_H) / top }}
            >
              {short(k * step)}
            </motion.span>
          ))}
        </div>
        <div className="@container relative min-w-0 flex-1">
          {/* Gridlines, drawing in from the left. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: CHART_H }}>
            {[0, 1, 2, 3, 4].map((k) => (
              <motion.span
                key={k}
                initial={still ? false : { scaleX: 0 }}
                animate={shown ? { scaleX: 1 } : undefined}
                transition={{ duration: 0.8, delay: still ? 0 : k * 0.06, ease: EASE }}
                className={cn(
                  "absolute inset-x-0 origin-left border-t",
                  k === 0 ? "border-[#27272A]" : "border-dashed border-[#27272A]/80",
                )}
                style={{ top: CHART_H - (k * CHART_H) / 4 }}
              />
            ))}
          </div>

          {hasPoints && range ? (
            <>
              {/* Bars. */}
              <div
                role="toolbar"
                aria-label={`${title}, ${range.label.toLowerCase()}`}
                onPointerLeave={() => setPicked(null)}
                className="relative flex items-end"
                style={{ height: CHART_H, gap: points.length > 9 ? 4 : 8 }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {points.map((pt, i) => {
                    const on = i === active;
                    const stack = stackOf(pt);
                    return (
                      <motion.button
                        key={`${range.id}-${pt.label}`}
                        ref={(el) => {
                          bars.current[i] = el;
                        }}
                        type="button"
                        tabIndex={on ? 0 : -1}
                        aria-pressed={on}
                        aria-label={`${pt.detail ?? pt.label}: ${fmt(stack, dp)} ${unit}. Up and down read each source.`}
                        onPointerEnter={() => setPicked((x) => ({ bar: i, seg: x?.seg ?? topSeg }))}
                        onFocus={() => setPicked((x) => ({ bar: i, seg: x?.seg ?? topSeg }))}
                        onClick={() => setPicked((x) => ({ bar: i, seg: x?.seg ?? topSeg }))}
                        onKeyDown={(e) => onKey(e, i)}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        className="flex h-full min-w-0 flex-1 cursor-pointer flex-col-reverse items-stretch rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111]"
                        style={{ gap: SEG_GAP }}
                      >
                        {series.map((s, si) => {
                          const v = visible[si] ? pt.values[si] ?? 0 : 0;
                          const h = shown ? (v / top) * CHART_H : 0;
                          return (
                            <motion.span
                              key={s.key}
                              initial={still ? false : { height: 0 }}
                              animate={{ height: h, marginTop: v ? 0 : -SEG_GAP }}
                              transition={
                                still
                                  ? { duration: 0 }
                                  : { ...GROW, delay: shown && !picked ? 0.15 + i * 0.05 + si * 0.08 : 0 }
                              }
                              onPointerEnter={() => v && setPicked({ bar: i, seg: si })}
                              className="relative block w-full shrink-0 overflow-hidden rounded-[6px]"
                            >
                              {/* Resting: a soft hatched tint of the source's colour. */}
                              <span
                                className="absolute inset-0"
                                style={{
                                  backgroundColor: `color-mix(in srgb, ${s.color} 16%, transparent)`,
                                  backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${s.color} 36%, transparent) 0 1.5px, transparent 1.5px 6px)`,
                                }}
                              />
                              {/* Chosen: the full colour fades in over it. */}
                              <motion.span
                                className="absolute inset-0"
                                style={{ backgroundColor: s.color }}
                                // With a tooltip open, only the segment it names is in full colour.
                                animate={{ opacity: on && (picked === null || si === tipSeg) ? 1 : 0 }}
                                transition={{ duration: still ? 0 : 0.25, ease: EASE }}
                              />
                            </motion.span>
                          );
                        })}
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* The tooltip card above the bar you point at, tap or arrow to. */}
              <AnimatePresence>
                {shown && picked !== null && p && tipSeries && (
                  <motion.div
                    key="tip"
                    aria-live="polite"
                    initial={still ? false : { opacity: 0, y: 6, left: `${tipLeft}%`, top: Math.max(0, tipTop - 8) }}
                    exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      left: `${tipLeft}%`,
                      top: Math.max(0, tipTop - 8),
                    }}
                    transition={still ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, opacity: { duration: 0.15 } }}
                    className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-xl border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs text-[#F4F4F5] shadow-none"
                  >
                    <p className="font-mono text-[11px] text-[#A1A1AA]">{p.detail ?? p.label}</p>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.p
                        key={tipSeries.key}
                        initial={still ? false : { opacity: 0, y: 4, filter: "blur(2px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                        transition={{ duration: still ? 0 : 0.16, ease: EASE }}
                        className="mt-1 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <span className="size-2 rounded-full" style={{ backgroundColor: tipSeries.color }} />
                        <span className="text-[#A1A1AA]">{tipSeries.label}</span>
                        <span className="font-semibold tabular-nums text-[#F4F4F5]">
                          {fmt(p.values[tipSeg] ?? 0, dp)} {unit}
                        </span>
                      </motion.p>
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Labels under the bars. */}
              <div className="mt-2 flex text-[11px] text-[#71717A]" style={{ gap: points.length > 9 ? 4 : 8 }}>
                {points.map((pt, i) => (
                  <span
                    key={`${range.id}-${pt.label}`}
                    title={pt.detail ?? pt.label}
                    className={cn(
                      "min-w-0 flex-1 truncate text-center font-mono transition-colors",
                      i === active && "font-medium text-[#D8FF0A]",
                    )}
                  >
                    {points.length > 9 ? pt.label.slice(0, 1) : pt.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div
              className="relative flex items-center justify-center rounded-xl border border-dashed border-[#27272A] bg-[#0A0A0A]/50 px-4 text-center text-xs text-[#71717A]"
              style={{ height: CHART_H }}
            >
              {emptyText}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

