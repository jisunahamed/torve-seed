"use client";

/**
 * QuotaGauge, from https://motion-brew.com/components/quota-gauge
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
import { animate, AnimatePresence, motion, type MotionValue, useAnimation, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, useVelocity, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: zap
const ZapIcon = (() => {
interface ZapHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ZapProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PATH_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    transition: {
      duration: 0.6,
      opacity: { duration: 0.1 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      duration: 0.6,
      opacity: { duration: 0.1 },
    },
  },
};

const ZapIcon = forwardRef<ZapHandle, ZapProps>(
  ({ onMouseEnter, onMouseLeave, className, size, active, style, strokeWidth, ...props }, ref) => {
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
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );
    // Play with the nearest interactive parent, or whenever `active` is set.
    // Reduced motion keeps the icon still.
    const wrap = useRef<HTMLSpanElement>(null);
    const reduced = useReducedMotion();
    const [hosted, setHosted] = useState(false);
    useEffect(() => {
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
          <motion.path
            animate={controls}
            d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
            variants={PATH_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

ZapIcon.displayName = "ZapIcon";
  return ZapIcon;
})();

// QuotaGauge

/**
 * QuotaGauge
 *
 * Trigger: in view, then hover. A white card for a plan's credit quota: a
 * three quarter gauge made of radial ticks, like a speedometer, around a
 * bolt. When it scrolls into view the ticks light up one by one up to the
 * amount used, the lit ones growing a little longer, while the credits count
 * up on odometer wheels beneath the bolt and the share of the plan rolls in.
 * The tick at the tip glows. Hovering the card plays the bolt and swaps the
 * caption to what is left. Reduced motion shows the final state at once.
 *
 * Engine: motion/react (a counting motion value drives the ticks and the
 * numbers, springs for the ticks, AnimatePresence for the caption) with an
 * animated bolt from lucide-animated (MIT), vendored in src/icons.
 */

export interface QuotaGaugeProps {
  /** Credits used so far. Default `2022`. */
  value?: number;
  /** The plan limit. Leave `null`/`undefined` or pass `unlimited` when no finite cap exists. */
  goal?: number | null;
  /** When true, displays Unlimited Plan telemetry without fake percentage caps. */
  unlimited?: boolean;
  /** Unit after the amount. Default `"credits used"`. */
  unit?: string;
  /** Label prefix before the goal in the resting caption. Default `"Monthly limit"`. */
  goalLabel?: string;
  /** Ticks on the gauge. Default `44`. */
  ticks?: number;
  /** Colour of lit ticks. Defaults to Torve green/lime (or crimson when >= 95%). */
  color?: string;
  /** Optional header slot rendered above the gauge. */
  header?: React.ReactNode;
  /** Optional footer slot rendered below the caption. */
  footer?: React.ReactNode;
  className?: string;
}

const GLIDE = [0.22, 1, 0.36, 1] as const;

const TORVE_GREEN = [20, 255, 115] as const; // #14FF73
const TORVE_LIME = [216, 255, 10] as const; // #D8FF0A
const TORVE_CRIMSON = "#EF4444";

function torveTickColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const r = Math.round(TORVE_GREEN[0] + (TORVE_LIME[0] - TORVE_GREEN[0]) * clamped);
  const g = Math.round(TORVE_GREEN[1] + (TORVE_LIME[1] - TORVE_GREEN[1]) * clamped);
  const b = Math.round(TORVE_GREEN[2] + (TORVE_LIME[2] - TORVE_GREEN[2]) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

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
const SWEEP = 270; // degrees, open at the bottom
const SIZE = 240;
const C = SIZE / 2;
const R_OUT = 108;
const R_IN = 94;

export const QuotaGauge = React.forwardRef<HTMLDivElement, QuotaGaugeProps>(
  function QuotaGauge(
    {
      value = 2022,
      goal = 2500,
      unlimited = false,
      unit = "credits used",
      goalLabel = "Monthly limit",
      ticks = 44,
      color,
      header,
      footer,
      className,
    },
    ref,
  ) {
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const still = !!useReducedMotion();
    const inView = useInView(root, { once: true, amount: 0.4 });
    const shown = inView || still;
    const [hover, setHover] = React.useState(false);

    const hasFiniteGoal =
      !unlimited && typeof goal === "number" && Number.isFinite(goal) && goal > 0;
    const isUnlimited = !hasFiniteGoal;
    const safeValue = Math.max(0, value);
    const safeGoal = hasFiniteGoal ? Math.max(1, goal!) : Math.max(1, safeValue);
    const share = isUnlimited ? 1 : Math.min(1, safeValue / safeGoal);
    const isCritical = !isUnlimited && share >= 0.95;
    const accentColor = color ?? (isCritical ? TORVE_CRIMSON : isUnlimited ? "#14FF73" : "#D8FF0A");

    const amount = useMotionValue(still ? safeValue : 0);
    const [lit, setLit] = React.useState(still ? Math.round(share * ticks) : 0);
    useMotionValueEvent(amount, "change", (v) =>
      setLit(Math.round((Math.min(Math.max(0, v), safeGoal) / safeGoal) * ticks)),
    );
    React.useEffect(() => {
      if (!shown) return;
      if (still) {
        amount.set(safeValue);
        setLit(Math.round(share * ticks));
        return;
      }
      const c = animate(amount, safeValue, {
        duration: 1.6,
        delay: 0.25,
        ease: GLIDE,
      });
      return () => c.stop();
    }, [shown, still, safeValue, share, ticks, amount]);

    const left = Math.max(0, safeGoal - safeValue);
    const start = 90 + (360 - SWEEP) / 2; // degrees, from the bottom left

    return (
      <motion.div
        ref={root}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        initial={still ? false : { opacity: 0, y: 16 }}
        animate={shown ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.6, ease: GLIDE }}
        className={cn(
          "w-[320px] max-w-full rounded-[10px] border border-[#222226] bg-[#111114] p-5 text-[#F4F4F5] shadow-none",
          className,
        )}
      >
        {header}
        <div
          className="relative mx-auto size-[240px]"
          role="img"
          aria-label={`${safeValue.toLocaleString()} of ${safeGoal.toLocaleString()} ${unit}, ${Math.round(share * 100)} percent of the plan`}
        >
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="size-full overflow-visible"
          >
            {Array.from({ length: ticks }, (_, i) => {
              const frac = ticks > 1 ? i / (ticks - 1) : 1;
              const a = ((start + frac * SWEEP) * Math.PI) / 180;
              const on = i < lit;
              const tip = i === lit - 1;
              const long = on ? 8 : 0;
              const tickStroke = color ?? (isCritical ? TORVE_CRIMSON : torveTickColor(frac));
              return (
                <motion.line
                  key={i}
                  x1={C + R_IN * Math.cos(a)}
                  y1={C + R_IN * Math.sin(a)}
                  x2={C + (R_OUT + long) * Math.cos(a)}
                  y2={C + (R_OUT + long) * Math.sin(a)}
                  strokeWidth={tip ? 5 : 3.5}
                  strokeLinecap="round"
                  initial={false}
                  animate={{
                    stroke: on ? tickStroke : "#27272A",
                    x2: C + (R_OUT + long) * Math.cos(a),
                    y2: C + (R_OUT + long) * Math.sin(a),
                    opacity: on
                      ? tip
                        ? 1
                        : 0.65 + 0.35 * (i / Math.max(1, lit))
                      : 1,
                  }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  style={
                    tip && !still
                      ? { filter: `drop-shadow(0 0 6px ${tickStroke}66)` }
                      : undefined
                  }
                />
              );
            })}
          </svg>

          {/* Centre: the bolt, the amount and the unit. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pb-2">
            <motion.span
              className={cn(
                "grid size-10 place-items-center rounded-full border border-[#27272A] bg-[#18181B]",
                isCritical && !color ? "text-[#EF4444]" : "text-[#D8FF0A]",
              )}
              style={color ? { color } : undefined}
              initial={still ? false : { scale: 0.6, opacity: 0 }}
              animate={shown ? { scale: 1, opacity: 1 } : undefined}
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 18,
                delay: 0.2,
              }}
            >
              <ZapIcon className="size-5" active={hover} />
            </motion.span>
            <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight text-[#F4F4F5] tabular-nums">
              <Odometer value={amount} label={`${safeValue}`} />
            </p>
            <p className="mt-1.5 text-sm text-[#A1A1AA]">
              {unit}
            </p>
          </div>
        </div>

        {/* Caption: progress, or what is left on hover. */}
        <div className="relative mt-2 h-11 overflow-hidden text-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={hover ? "left" : "share"}
              initial={
                still ? false : { y: 18, opacity: 0, filter: "blur(3px)" }
              }
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={
                still ? undefined : { y: -18, opacity: 0, filter: "blur(3px)" }
              }
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              {isUnlimited ? (
                hover ? (
                  <>
                    <p className="text-sm font-semibold text-[#14FF73]">
                      No token limit
                    </p>
                    <p className="text-sm text-[#A1A1AA]">
                      Unlimited active usage
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#14FF73]">
                      Unlimited Plan
                    </p>
                    <p className="text-sm text-[#71717A]">
                      {goalLabel}
                    </p>
                  </>
                )
              ) : hover ? (
                <>
                  <p className="text-sm font-semibold text-[#F4F4F5]">
                    {left > 0
                      ? `${left.toLocaleString()} left`
                      : "Limit reached"}
                  </p>
                  <p
                    className={cn(
                      "text-sm",
                      left === 0 || isCritical ? "text-[#EF4444]" : "text-[#A1A1AA]",
                    )}
                    style={
                      left > 0 && !isCritical && share < 0.75
                        ? { color: accentColor === "#D8FF0A" ? "#14FF73" : "#A1A1AA" }
                        : undefined
                    }
                  >
                    {left === 0
                      ? "Upgrade for more"
                      : share >= 0.75
                        ? "Close to your limit"
                        : "Plenty of room"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[#F4F4F5]">
                    {Math.round(share * 100)}% of your plan
                  </p>
                  <p className="text-sm text-[#71717A]">
                    {goalLabel} {safeGoal.toLocaleString()}
                  </p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {footer}
      </motion.div>
    );
  },
);

