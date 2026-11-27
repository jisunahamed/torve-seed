"use client";

/**
 * UsageRing, from https://motion-brew.com/components/usage-ring
 *
 * One self contained file: the component and the cn()
 * helper. Needs React 18 or 19 and Tailwind CSS v4.
 *
 * MIT License, Copyright (c) 2026 Md Eftakher. Free for personal and
 * commercial use: copy it, change it, ship it.
 */

import * as React from "react";
import { type ClassValue, clsx } from "clsx";
import { animate, motion, type MotionValue, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, useVelocity } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Component: pill-tabs
const PillTabs = (() => {
/**
 * PillTabs
 *
 * Trigger: press. Tabs on a tinted track with a white pill that slides to the
 * active tab like a rubber band. The leading edge darts ahead; the trailing edge
 * holds back, then follows on a looser spring, so the pill stretches long and
 * thins, then settles with just a hint of give. A horizontal motion blur, scaled by its speed, smears it
 * mid-travel and clears at rest. The rounded ends never distort: the pill is two
 * caps and a flat middle that scales. Arrow keys, Home and End move between
 * tabs. Reduced motion jumps the pill with no stretch or blur.
 *
 * Engine: motion/react (two spring-driven edge motion values, transform-only
 * pill parts, useVelocity feeding an SVG horizontal blur).
 */

interface PillTab {
  id: string;
  label: string;
  /** Small count shown after the label. */
  badge?: number;
}

interface PillTabsProps {
  /** Tabs, left to right. Default inbox, mentions, saved. */
  tabs?: PillTab[];
  /** Active tab id when uncontrolled. Default the first. */
  defaultValue?: string;
  /** Active tab id when controlled. */
  value?: string;
  /** Called with the new tab id. */
  onValueChange?: (id: string) => void;
  /** How rubbery the slide is, 0 (rigid) to 1 (very stretchy). Default `0.45`. */
  stretch?: number;
  /** Strongest horizontal blur mid-flight, in px. `0` turns it off. Default `7.5`. */
  blur?: number;
  /** Accessible name for the tab list. Default `"Sections"`. */
  label?: string;
  className?: string;
}

const DEFAULT_TABS: PillTab[] = [
  { id: "inbox", label: "Inbox" },
  { id: "mentions", label: "Mentions", badge: 5 },
  { id: "saved", label: "Saved" },
];

const PillTabs = React.forwardRef<HTMLDivElement, PillTabsProps>(function PillTabs(
  {
    tabs = DEFAULT_TABS,
    defaultValue,
    value: valueProp,
    onValueChange,
    stretch = 0.45,
    blur = 7.5,
    label = "Sections",
    className,
  },
  forwardedRef,
) {
  const reduceMotion = !!useReducedMotion();
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `pill-blur-${uid}`;
  const track = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(forwardedRef, () => track.current as HTMLDivElement);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const blurNode = React.useRef<SVGFEGaussianBlurElement>(null);

  const [inner, setInner] = React.useState(defaultValue ?? tabs[0]?.id ?? "");
  const value = valueProp ?? inner;
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );
  const placed = React.useRef(false);
  const fromWidth = React.useRef(0);
  const toWidth = React.useRef(0);
  const [height, setHeight] = React.useState(0);

  // The pill is drawn between these two edges, in px from the track's left.
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const capX = useTransform(right, (r) => r - height);
  const midX = useTransform(left, (l) => l + height / 2);
  const midScale = useTransform([left, right], ([l, r]) => Math.max(0, (r as number) - (l as number) - height));

  // Rubber thins as it stretches: squash the pill's height by how far it outgrows both end sizes.
  const thin = useTransform([left, right], ([l, r]) => {
    if (reduceMotion) return 1;
    const w = (r as number) - (l as number);
    const rest = Math.max(fromWidth.current, toWidth.current, 1);
    const over = Math.max(0, w - rest) / rest;
    return 1 - Math.min(0.18, over * 0.35);
  });

  // Motion blur from the pill's speed, horizontal only.
  const center = useTransform([left, right], ([l, r]) => ((l as number) + (r as number)) / 2);
  const speed = useVelocity(center);
  useMotionValueEvent(speed, "change", (v) => {
    const sd = blur > 0 && !reduceMotion ? Math.min(blur, Math.abs(v) / 420) : 0;
    blurNode.current?.setAttribute("stdDeviation", `${sd.toFixed(2)} 0`);
  });

  const select = (id: string) => {
    if (valueProp === undefined) setInner(id);
    onValueChange?.(id);
  };

  // Move the pill to the active tab. The first placement (and resizes) jump without motion.
  const moveTo = React.useCallback(
    (instant: boolean) => {
      const tab = tabRefs.current[index];
      if (!tab) return;
      const l = tab.offsetLeft;
      const r = l + tab.offsetWidth;
      setHeight(tab.offsetHeight);
      if (instant || reduceMotion) {
        left.set(l);
        right.set(r);
        return;
      }
      const goingRight = l > left.get();
      // Rubber band: the leading edge darts ahead; the trailing edge holds back, then follows on a
      // looser spring, so the pill stretches. Both springs sit just under critical damping, so it
      // settles with only a hint of give instead of bouncing.
      const amount = Math.min(1, Math.max(0, stretch));
      fromWidth.current = right.get() - left.get();
      toWidth.current = r - l;
      const mass = 0.8;
      const critical = (k: number) => 2 * Math.sqrt(k * mass);
      const leadStiffness = 640;
      const trailStiffness = 700 - 540 * amount;
      const lead = { type: "spring" as const, stiffness: leadStiffness, damping: critical(leadStiffness) * 0.95, mass };
      const trail = {
        type: "spring" as const,
        stiffness: trailStiffness,
        damping: critical(trailStiffness) * 0.9,
        mass,
        delay: 0.13 * amount,
      };
      animate(left, l, goingRight ? trail : lead);
      animate(right, r, goingRight ? lead : trail);
    },
    [index, left, right, reduceMotion, stretch],
  );

  React.useLayoutEffect(() => {
    moveTo(!placed.current);
    placed.current = true;
  }, [moveTo]);

  React.useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => moveTo(true));
    ro.observe(el);
    return () => ro.disconnect();
  }, [moveTo]);

  const focusTab = (i: number) => {
    if (!tabs.length) return;
    const t = tabs[(i + tabs.length) % tabs.length]!;
    select(t.id);
    tabRefs.current[(i + tabs.length) % tabs.length]?.focus();
  };

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") (e.preventDefault(), focusTab(index + 1));
        if (e.key === "ArrowLeft") (e.preventDefault(), focusTab(index - 1));
        if (e.key === "Home") (e.preventDefault(), focusTab(0));
        if (e.key === "End") (e.preventDefault(), focusTab(tabs.length - 1));
      }}
      className={cn(
        "relative inline-flex max-w-full items-center gap-1 rounded-full border border-[#27272A] bg-[#18181B] p-1.5",
        className,
      )}
    >
      <svg aria-hidden className="absolute size-0">
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur ref={blurNode} stdDeviation="0 0" />
        </filter>
      </svg>

      {/* The pill: two round caps and a flat middle, so stretching never squashes the ends; it thins as it stretches. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-1.5 left-0 w-full"
        style={{
          filter: `url(#${filterId}) drop-shadow(0 1px 2px rgba(0,0,0,0.4)) drop-shadow(0 4px 10px rgba(216,255,10,0.12))`,
          scaleY: thin,
        }}
      >
        <motion.span
          className="absolute left-0 top-0 rounded-full bg-[#D8FF0A]"
          style={{ x: left, width: height, height }}
        />
        <motion.span
          className="absolute left-0 top-0 w-px origin-left bg-[#D8FF0A]"
          style={{ x: midX, scaleX: midScale, height }}
        />
        <motion.span
          className="absolute left-0 top-0 rounded-full bg-[#D8FF0A]"
          style={{ x: capX, width: height, height }}
        />
      </motion.span>

      {tabs.map((tab, i) => {
        const active = i === index;
        return (
          <motion.button
            key={tab.id}
            ref={(el) => void (tabRefs.current[i] = el)}
            type="button"
            role="tab"
            id={`${uid}-tab-${tab.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => select(tab.id)}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className={cn(
              "relative z-10 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] max-[360px]:px-3 font-medium outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60",
              active
                ? "font-semibold text-[#0A0A0A]"
                : "text-[#A1A1AA] hover:text-[#F4F4F5]",
            )}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <motion.span
                initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.15 }}
                aria-label={`${tab.badge} new`}
                className={cn(
                  "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums",
                  active
                    ? "bg-[#0A0A0A] text-[#D8FF0A]"
                    : "bg-[#27272A] text-[#F4F4F5]",
                )}
              >
                {tab.badge}
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
});
  return PillTabs;
})();

// UsageRing

/**
 * UsageRing
 *
 * Trigger: in view, then press and hover. A white card for plan usage: a
 * ring made of short segments around a big percent. When it scrolls into
 * view the segments light up one after another, clockwise, while the percent
 * and the caption's amount count up on odometer wheels. The library's
 * PillTabs under the ring switch the resource (API, Storage, Seats): its white
 * pill stretches across to the tab, the segments glide to the new share of
 * the plan and the numbers roll to match. Hovering the ring lifts each lit
 * segment a hair outward in a wave. Reduced motion shows the final state at
 * once.
 *
 * Engine: motion/react (counting motion values drive the segments and the
 * odometer numbers, springs for each segment) with PillTabs for the metric
 * switch.
 */

export interface UsageMetric {
  label: string;
  value: number;
  /** Plan cap for this metric. Leave `null`/`undefined` when the plan has no cap (Unlimited). */
  goal?: number | null;
  unit: string;
}

export interface UsageRingProps {
  /** Title. Default `"Plan usage"`. */
  title?: string;
  /** The resources, one per tab. Default API calls, storage and seats. */
  metrics?: UsageMetric[];
  /** Segments around the ring. Default `20`. */
  segments?: number;
  /**
   * Hues the ring walks between on the colour wheel, in degrees, from empty to
   * the limit. Default `[72, 145]`: Torve lime to electric green.
   */
  hues?: [number, number];
  className?: string;
}

const DEFAULT_METRICS: UsageMetric[] = [
  { label: "API", value: 270, goal: 600, unit: "K calls" },
  { label: "Storage", value: 19, goal: 30, unit: "GB" },
  { label: "Seats", value: 19, goal: 20, unit: "seats" },
];

const GLIDE = [0.22, 1, 0.36, 1] as const;

// The ring's colour walks round the colour wheel in OKLCH, where every hue at
// the same lightness looks equally bright: from a cool indigo at the start,
// through violet and magenta, to a coral red at the limit. Each segment takes
// the colour of its own position, so a fuller ring travels further round the
// wheel, like a live gradient.
const toSrgb = (x: number) => {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
/** An OKLCH colour as an rgb() string. */
const oklch = (l: number, c: number, h: number) => {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1;
  const g = -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1;
  const bl = -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1;
  return `rgb(${toSrgb(r)}, ${toSrgb(g)}, ${toSrgb(bl)})`;
};
/** The colour at a point round the ring, 0 to 1, between two hues (in degrees, going up the wheel). */
const wheel = (at: number, [from, to]: [number, number], lightness = 0.78) =>
  oklch(lightness, 0.19, from + (to - from) * Math.min(1, Math.max(0, at)));

// Number rolls, the same as GoalGauge and SpendingMeter: one 0 to 9 column per digit.
const ROLL = {
  type: "spring",
  stiffness: 280,
  damping: 26,
  mass: 0.8,
} as const;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
// Cap for the odometer's motion blur, in px.
const MAX_BLUR = 0.5;

/**
 * One odometer wheel for a decimal place. The lowest wheel turns continuously;
 * every higher wheel holds still and only ticks over while all the wheels below
 * it read 9, like a mechanical counter. Eleven cells (0 to 9, then 0) let 9
 * roll smoothly into 0.
 */
function Wheel({
  value,
  rate,
  place,
}: {
  value: MotionValue<number>;
  rate: MotionValue<number>;
  place: number;
}) {
  const position = useTransform(value, (a) => {
    const ticks = Math.max(0, a) + 1e-6;
    const whole = Math.floor(ticks);
    const turning = ticks - whole;
    const digit = Math.floor(whole / place) % 10;
    const turn =
      place === 1 ? turning : whole % place === place - 1 ? turning : 0;
    return digit + turn;
  });
  const y = useTransform(position, (p) => `${(-p * 100) / 11}%`);
  // Motion blur from how fast this wheel's digit changes.
  const filter = useTransform(rate, (v) => {
    const px = Math.min(MAX_BLUR, (Math.abs(v) / place) * 0.015);
    return px < 0.1 ? "none" : `blur(${px.toFixed(2)}px)`;
  });
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] overflow-hidden">
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        style={{ y, filter }}
      >
        {[...DIGITS, 0].map((d, i) => (
          <span key={i} className="flex h-[1em] items-center justify-center">
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * A whole number as an odometer that counts through every value, driven by a
 * motion value. Wheels are added as the number grows, with a separator every
 * three places.
 */
function Odometer({
  value,
  label,
  group = ",",
}: {
  value: MotionValue<number>;
  label: string;
  group?: string;
}) {
  const rate = useVelocity(value);
  const places = (a: number) =>
    Math.max(1, String(Math.floor(Math.max(0, a) + 1e-6)).length);
  const [count, setCount] = React.useState(() => places(value.get()));
  useMotionValueEvent(value, "change", (a) => {
    const n = places(a);
    if (n !== count) setCount(n);
  });
  const cells: React.ReactNode[] = [];
  for (let k = count - 1; k >= 0; k--) {
    cells.push(
      <motion.span
        key={`w${k}`}
        className="inline-flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <Wheel value={value} rate={rate} place={10 ** k} />
      </motion.span>,
    );
    if (k > 0 && k % 3 === 0 && group)
      cells.push(<span key={`g${k}`}>{group}</span>);
  }
  return (
    <span aria-label={label} className="inline-flex leading-none tabular-nums">
      {/* An invisible digit gives the row a text baseline, so it lines up with words beside it. */}
      <span aria-hidden className="invisible w-0">
        0
      </span>
      <span aria-hidden className="inline-flex">
        {cells}
      </span>
    </span>
  );
}
const R = 76; // ring radius in the 200 viewBox
const SIZE = 200;

export const UsageRing = React.forwardRef<HTMLDivElement, UsageRingProps>(
  function UsageRing(
    {
      title = "Plan usage",
      metrics = DEFAULT_METRICS,
      segments = 20,
      hues = [72, 145],
      className,
    },
    ref,
  ) {
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const still = !!useReducedMotion();
    const inView = useInView(root, { once: true, amount: 0.4 });
    const shown = inView || still;

    const safeMetrics = metrics.length > 0 ? metrics : DEFAULT_METRICS;
    const [tab, setTab] = React.useState(0);
    const safeTab = Math.min(tab, safeMetrics.length - 1);
    const [ringHover, setRingHover] = React.useState(false);
    const m = safeMetrics[safeTab]!;
    const hasFiniteGoal =
      typeof m.goal === "number" && Number.isFinite(m.goal) && m.goal > 0;
    const isUnlimited = !hasFiniteGoal;
    const safeValue = Math.max(0, m.value);
    const safeGoal = hasFiniteGoal ? Math.max(1, m.goal!) : Math.max(1, safeValue);
    const share = isUnlimited ? 1 : Math.min(1, safeValue / safeGoal);

    // One motion value drives the ring and both numbers.
    const progress = useMotionValue(still ? share : 0);
    const amount = useMotionValue(still ? safeValue : 0);
    // The percent counts on its own value so it lands on a whole number.
    const pct = useMotionValue(still ? Math.round(share * 100) : 0);
    const [lit, setLit] = React.useState(
      still ? Math.round(share * segments) : 0,
    );
    useMotionValueEvent(progress, "change", (p) =>
      setLit(Math.round(p * segments)),
    );

    const first = React.useRef(true);
    React.useEffect(() => {
      if (!shown) return;
      if (still) {
        progress.set(share);
        amount.set(safeValue);
        pct.set(Math.round(share * 100));
        setLit(Math.round(share * segments));
        return;
      }
      const intro = first.current;
      first.current = false;
      const opts = {
        duration: intro ? 1.4 : 0.8,
        delay: intro ? 0.25 : 0,
        ease: GLIDE,
      };
      const a = animate(progress, share, opts);
      const c = animate(pct, Math.round(share * 100), opts);
      const b = animate(amount, safeValue, opts);
      return () => {
        a.stop();
        b.stop();
        c.stop();
      };
    }, [shown, still, share, safeValue, segments, progress, amount, pct]);

    const step = 360 / segments;
    const STROKE = 12;
    // Round caps reach past each end, so the gap leaves room for both caps plus a clear 5px.
    const gap = Math.min(step - 1, (((STROKE + 5) / R) * 180) / Math.PI);

    return (
      <motion.div
        ref={root}
        initial={still ? false : { opacity: 0, y: 16 }}
        animate={shown ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.6, ease: GLIDE }}
        className={cn(
          "w-[340px] max-w-full rounded-[10px] border border-[#222226] bg-[#111114] p-5 text-[#F4F4F5] shadow-none",
          className,
        )}
      >
        <p className="text-center text-base font-semibold tracking-tight text-[#F4F4F5]">
          {title}
        </p>

        {/* The ring of segments. */}
        <div
          className="relative mx-auto mt-4 size-[200px]"
          onPointerEnter={() => setRingHover(true)}
          onPointerLeave={() => setRingHover(false)}
          role="img"
          aria-label={`${m.label}: ${safeValue} of ${m.goal} ${m.unit}, ${Math.round(share * 100)} percent`}
        >
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="size-full -rotate-90 overflow-visible"
          >
            {Array.from({ length: segments }, (_, i) => {
              const a0 = ((i * step + gap / 2) * Math.PI) / 180;
              const a1 = (((i + 1) * step - gap / 2) * Math.PI) / 180;
              const c = SIZE / 2;
              const on = i < lit;
              // Lit segments lift outward a hair on hover, in a wave. The lift is drawn
              // into the arc itself (a larger radius), not a CSS transform, so every
              // browser places the segments the same way.
              const r = R + (ringHover && on && !still ? 4 : 0);
              const arc = `M ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}`;
              return (
                <motion.path
                  key={i}
                  fill="none"
                  strokeLinecap="round"
                  initial={false}
                  animate={{
                    d: arc,
                    stroke: on
                      ? wheel((i + 1) / segments, hues)
                      : "#27272A",
                    strokeWidth: on ? STROKE : STROKE - 2,
                  }}
                  transition={{
                    stroke: { duration: 0.2 },
                    strokeWidth: {
                      type: "spring",
                      stiffness: 500,
                      damping: 20,
                    },
                    d: still
                      ? { duration: 0 }
                      : {
                          type: "spring",
                          stiffness: 300,
                          damping: 18,
                          delay: ringHover ? i * 0.008 : 0,
                        },
                  }}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            {isUnlimited ? (
              <div className="flex flex-col items-center text-center">
                <span className="text-[32px] font-semibold leading-none tracking-tight text-[#14FF73]">
                  ∞
                </span>
                <span className="mt-1.5 rounded-full border border-[#14FF73]/30 bg-[#14FF73]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#14FF73]">
                  Unlimited
                </span>
              </div>
            ) : (
              <p
                className="flex items-baseline text-[32px] font-semibold leading-none tracking-tight text-[#F4F4F5] transition-colors duration-500"
                // Past 80% the number takes the colour of the ring's tip, bright enough for dark surfaces.
                style={
                  share >= 0.8 ? { color: wheel(share, hues, 0.82) } : undefined
                }
              >
                <Odometer value={pct} label={`${Math.round(share * 100)}`} />
                <span className="ml-0.5 text-xl text-[#71717A]">%</span>
              </p>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs font-medium uppercase tracking-[0.08em] text-[#A1A1AA]">
          {m.label}{" "}
          <span className="tabular-nums text-[#F4F4F5]">
            <Odometer value={amount} label={`${safeValue}`} />
          </span>
          {hasFiniteGoal ? ` / ${safeGoal.toLocaleString()} ` : " "}
          {m.unit}
        </p>

        {/* Metric tabs: the library's PillTabs, with its rubber band pill. */}
        <div className="mt-5 flex justify-center">
          <PillTabs
            label="Metric"
            tabs={safeMetrics.map((x) => ({ id: x.label, label: x.label }))}
            value={m.label}
            onValueChange={(v) =>
              setTab(
                Math.max(
                  0,
                  safeMetrics.findIndex((x) => x.label === v),
                ),
              )
            }
            blur={still ? 0 : undefined}
          />
        </div>
      </motion.div>
    );
  },
);

