"use client";

/**
 * ChannelMix, from https://motion-brew.com/components/channel-mix
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
import { Info } from "lucide-react";
import { AnimatePresence, motion, type Transition, useAnimation, useInView, useReducedMotion, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: arrow-down-right
const ArrowDownRightIcon = (() => {
interface ArrowDownRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ArrowDownRightIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const HEAD_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: {
    translateX: [0, -3, 0],
    translateY: [0, -3, 0],
    transition: {
      duration: 0.5,
      ease: "easeInOut",
    },
  },
};

const SHAFT_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0, scale: 1 },
  animate: {
    translateX: [0, -3, 0],
    translateY: [0, -3, 0],
    scale: [1, 0.85, 1],
    originX: 1,
    originY: 1,
    transition: {
      duration: 0.5,
      ease: "easeInOut",
    },
  },
};

const ArrowDownRightIcon = forwardRef<
  ArrowDownRightIconHandle,
  ArrowDownRightIconProps
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
        <motion.path
          animate={controls}
          d="M7 7 L17 17"
          variants={SHAFT_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M17 7v10H7"
          variants={HEAD_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M17 17 L10 17"
          variants={HEAD_VARIANTS}
        />
      </svg>
    </span>
  );
});

ArrowDownRightIcon.displayName = "ArrowDownRightIcon";
  return ArrowDownRightIcon;
})();

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

// Animated icon: chart-pie
const ChartPieIcon = (() => {
interface ChartPieIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChartPieIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PATH_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: { translateX: 1.1, translateY: -1.1 },
};

const ChartPieIcon = forwardRef<ChartPieIconHandle, ChartPieIconProps>(
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
          <motion.path
            animate={controls}
            d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"
            transition={{
              type: "spring",
              stiffness: 250,
              damping: 15,
              bounce: 0.6,
            }}
            variants={PATH_VARIANTS}
          />
          <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        </svg>
      </span>
    );
  }
);

ChartPieIcon.displayName = "ChartPieIcon";
  return ChartPieIcon;
})();

// Animated icon: circle-dollar-sign
const CircleDollarSignIcon = (() => {
interface CircleDollarSignIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CircleDollarSignIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const DOLLAR_MAIN_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    transition: {
      duration: 0.4,
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

const DOLLAR_SECONDARY_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    pathOffset: 0,
    transition: {
      delay: 0.3,
      duration: 0.3,
      opacity: { duration: 0.1, delay: 0.3 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    pathOffset: [1, 0],
    transition: {
      delay: 0.5,
      duration: 0.4,
      opacity: { duration: 0.1, delay: 0.5 },
    },
  },
};

const CircleDollarSignIcon = forwardRef<
  CircleDollarSignIconHandle,
  CircleDollarSignIconProps
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
        <circle cx="12" cy="12" r="10" />
        <motion.path
          animate={controls}
          d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"
          initial="normal"
          variants={DOLLAR_MAIN_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M12 18V6"
          initial="normal"
          variants={DOLLAR_SECONDARY_VARIANTS}
        />
      </svg>
    </span>
  );
});

CircleDollarSignIcon.displayName = "CircleDollarSignIcon";
  return CircleDollarSignIcon;
})();

// Animated icon: hourglass
const HourglassIcon = (() => {
interface HourglassIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HourglassIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const HourglassIcon = forwardRef<HourglassIconHandle, HourglassIconProps>(
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
          <motion.g
            animate={controls}
            style={{
              transformOrigin: "12px 12px",
            }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 15,
              mass: 1,
            }}
            variants={{
              normal: {
                rotate: 0,
              },
              animate: {
                rotate: 180,
              },
            }}
          >
            <path d="M5 22h14" />
            <path d="M5 2h14" />
            <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
            <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
          </motion.g>
        </svg>
      </span>
    );
  }
);

HourglassIcon.displayName = "HourglassIcon";
  return HourglassIcon;
})();

// Animated icon: user-round-plus
const UserRoundPlusIcon = (() => {
interface UserRoundPlusIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UserRoundPlusIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const VERTICAL_BAR_VARIANTS: Variants = {
  normal: {
    opacity: 1,
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      delay: 0.3,
      duration: 0.2,
      opacity: { duration: 0.1, delay: 0.3 },
    },
  },
};

const HORIZONTAL_BAR_VARIANTS: Variants = {
  normal: {
    opacity: 1,
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      delay: 0.6,
      duration: 0.2,
      opacity: { duration: 0.1, delay: 0.6 },
    },
  },
};

const UserRoundPlusIcon = forwardRef<
  UserRoundPlusIconHandle,
  UserRoundPlusIconProps
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
      <motion.svg
        fill="none"
        height={size}
        initial="normal"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth ?? 2}
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M2 21a8 8 0 0 1 13.292-6" />
        <circle cx="10" cy="8" r="5" />
        <motion.path
          animate={controls}
          d="M19 16v6"
          initial="normal"
          variants={VERTICAL_BAR_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="M22 19h-6"
          initial="normal"
          variants={HORIZONTAL_BAR_VARIANTS}
        />
      </motion.svg>
    </span>
  );
});

UserRoundPlusIcon.displayName = "UserRoundPlusIcon";
  return UserRoundPlusIcon;
})();

// ChannelMix

/**
 * ChannelMix
 *
 * Trigger: in view, then hover and press. A white marketing card: a light
 * gray header with an icon tile, a title and a line of copy, then a white
 * panel overlapping it with the
 * week's sessions on rolling digits and a row of slim ticks that splits them
 * by channel. When it scrolls into view the ticks rise in a wave from left to
 * right while the numbers roll up from zero. Pointing at the bar or a legend
 * chip lights up that channel's ticks, dims the rest, and rolls the headline
 * to the channel's own sessions and change. Under a hairline, a small table of
 * metrics: a soft pill glides between rows under the pointer, each row's
 * animated icon plays, and its change arrow nudges the way it points. The info
 * button explains the numbers in a tooltip, and Details slides its arrow out.
 * Reduced motion keeps every state without movement.
 *
 * Engine: motion/react (staggered scale for the ticks, spring digit columns,
 * layoutId pills, AnimatePresence for the headline) with animated icons from
 * lucide-animated (MIT), vendored in src/icons.
 */

export interface ChannelMixChannel {
  name: string;
  /** Sessions or tokens from this channel in the period. */
  sessions: number;
  /** Optional subtitle shown on metric/legend or tooltip. */
  detail?: string;
  /** Change against the last period, in percent. */
  change?: number;
  /** Tick and dot color. Defaults follow the card's palette. */
  color?: string;
}

export type ChannelMixIcon = "people" | "time" | "money";

export interface ChannelMixMetric {
  label: string;
  /** Shown as written; its digits roll, everything else stays put. */
  value: string;
  /** Change against the last period, in percent. */
  change?: number;
  /** Optional secondary tag when change is omitted. */
  detail?: string;
  /** Whether a rise is good news. Default true; set false for costs and waits. */
  higherIsBetter?: boolean;
  icon: ChannelMixIcon;
}

export interface ChannelMixProps {
  /** Title in the shell. Default `"Channel insights"`. */
  title?: React.ReactNode;
  /** Line under the title. */
  description?: React.ReactNode;
  /** Label over the headline number. Default `"Sessions this week"`. */
  label?: string;
  /** What the info button explains. */
  info?: string;
  channels?: ChannelMixChannel[];
  /** Change of all sessions against the last period, in percent. */
  change?: number;
  /** Text beside the headline change percentage. Default `"vs last week"`. */
  comparisonLabel?: string;
  /** Optional unit suffix after headline number (e.g. `"tokens"`). */
  unit?: string;
  /** Optional formatter for headline numbers. */
  formatValue?: (n: number) => string;
  metrics?: ChannelMixMetric[];
  /** Third column header in metrics table. Default `"Change"`. */
  metricThirdHeader?: string;
  /** Called by the Details button. Leave out to hide it. */
  onDetails?: () => void;
  /** Locale for numbers. Default `"en-US"`. */
  locale?: string;
  /** Show the header band with the icon, title and copy. Default true; false leaves just the chart. */
  header?: boolean;
  /** Message when no channels have non-zero values. */
  emptyText?: string;
  className?: string;
}

const PALETTE = ["#D8FF0A", "#14FF73", "#38BDF8", "#A78BFA", "#FB923C"];
const GOOD = "#14FF73";
const BAD = "#F87171";
const TICKS = 44;

const DEFAULT_CHANNELS: ChannelMixChannel[] = [
  { name: "Organic search", sessions: 21480, change: 3.4 },
  { name: "Social", sessions: 15920, change: 1.2 },
  { name: "Direct", sessions: 10810, change: -0.8 },
];

const DEFAULT_METRICS: ChannelMixMetric[] = [
  {
    label: "Cost per signup",
    value: "$38.25",
    change: -4.1,
    higherIsBetter: false,
    icon: "people",
  },
  {
    label: "Days to convert",
    value: "4.2 days",
    change: 3.8,
    higherIsBetter: false,
    icon: "time",
  },
  { label: "Return on spend", value: "324%", change: 4.5, icon: "money" },
];

const ICONS: Record<
  ChannelMixIcon,
  React.ComponentType<{ active?: boolean; className?: string }>
> = {
  people: UserRoundPlusIcon,
  time: HourglassIcon,
  money: CircleDollarSignIcon,
};

const GLIDE = [0.22, 1, 0.36, 1] as const;
const ROLL: Transition = { type: "spring", stiffness: 200, damping: 26 };
const PILL: Transition = { type: "spring", stiffness: 500, damping: 40 };
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ digit, still }: { digit: number; still: boolean }) {
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] overflow-hidden">
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-digit * 10}%` }}
        transition={still ? { duration: 0 } : ROLL}
      >
        {DIGITS.map((d) => (
          <span key={d} className="flex h-[1em] items-center justify-center">
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** Text whose digits roll on their own columns, keyed from the right; other characters stay put. */
function RollText({ text, still }: { text: string; still: boolean }) {
  const chars = Array.from(text);
  return (
    <span aria-hidden className="inline-flex leading-none tabular-nums">
      {chars.map((ch, i) => {
        const key = chars.length - i;
        return /\d/.test(ch) ? (
          <Digit key={key} digit={Number(ch)} still={still} />
        ) : (
          <span key={`${key}${ch}`} className="whitespace-pre">
            {ch}
          </span>
        );
      })}
    </span>
  );
}

/** Before the card is seen, every digit reads 0, so they roll up on arrival. */
const zeroed = (text: string) => text.replace(/\d/g, "0");

function Change({
  change,
  good,
  nudge,
}: {
  change: number;
  good: boolean;
  nudge: boolean;
}) {
  const up = change >= 0;
  const Arrow = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-medium tabular-nums"
      style={{ color: good ? GOOD : BAD }}
    >
      <motion.span
        className="grid"
        animate={nudge ? { x: 2, y: up ? -2 : 2 } : { x: 0, y: 0 }}
        transition={{ duration: 0.25, ease: GLIDE }}
      >
        <Arrow className="size-3.5" strokeWidth={2.5} />
      </motion.span>
      {up ? "+" : "−"}
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

export const ChannelMix = React.forwardRef<HTMLDivElement, ChannelMixProps>(
  function ChannelMix(
    {
      title = "Channel insights",
      description = "See which channels bring people in, and what each one costs, as the week goes on.",
      label = "Sessions this week",
      info = "Visits to your site this week, split by where they came from.",
      channels = DEFAULT_CHANNELS,
      change,
      comparisonLabel = "vs last week",
      unit,
      formatValue,
      metrics = DEFAULT_METRICS,
      metricThirdHeader = "Change",
      onDetails,
      locale = "en-US",
      header = true,
      emptyText = "No channel activity recorded in this window yet.",
      className,
    },
    ref,
  ) {
    const still = !!useReducedMotion();
    const id = React.useId();
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const seen = useInView(root, { once: true, amount: 0.35 });
    const shown = seen || still;
    const [active, setActive] = React.useState<number | null>(null);
    const [row, setRow] = React.useState<number | null>(null);
    const [tip, setTip] = React.useState(false);
    const [headHover, setHeadHover] = React.useState(false);
    const [settled, setSettled] = React.useState(false);
    const format = React.useMemo(() => new Intl.NumberFormat(locale), [locale]);

    // After the opening wave, ticks answer the pointer without delays.
    React.useEffect(() => {
      if (typeof window === "undefined" || !shown) return;
      const t = window.setTimeout(() => setSettled(true), still ? 0 : 1400);
      return () => window.clearTimeout(t);
    }, [shown, still]);

    const rawTotal = channels.reduce((s, c) => s + Math.max(0, c.sessions), 0);
    const total = rawTotal || 1;
    const hasChannels = channels.length > 0 && rawTotal > 0;
    const colorOf = (i: number) =>
      channels[i]?.color ?? PALETTE[i % PALETTE.length]!;
    // Which channel each tick belongs to: its centre against the running shares.
    const owner = React.useMemo(() => {
      if (!hasChannels) return Array.from({ length: TICKS }, () => -1);
      const edges: number[] = [];
      let run = 0;
      for (const c of channels) edges.push((run += Math.max(0, c.sessions) / total));
      return Array.from({ length: TICKS }, (_, i) => {
        const at = (i + 0.5) / TICKS;
        const k = edges.findIndex((e) => at <= e);
        return k < 0 ? channels.length - 1 : k;
      });
    }, [channels, total, hasChannels]);

    const focus = active === null ? null : channels[active];
    const fmtNum = (n: number) => (formatValue ? formatValue(n) : format.format(n));
    const headline = focus
      ? fmtNum(focus.sessions)
      : fmtNum(rawTotal);
    const headChange = focus ? focus.change : change;
    const headDetail = focus?.detail;

    const pickFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasChannels) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width <= 0) return;
      const i = Math.min(
        TICKS - 1,
        Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * TICKS)),
      );
      const picked = owner[i];
      setActive(picked !== undefined && picked >= 0 ? picked : null);
    };

    return (
      <motion.div
        ref={root}
        initial={still ? false : { opacity: 0, y: 16, filter: "blur(8px)" }}
        animate={shown ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
        transition={{ duration: 0.6, ease: GLIDE }}
        className={cn(
          "@container w-full max-w-full overflow-hidden rounded-2xl border border-[#27272A] bg-[#111111] text-[#F4F4F5] shadow-none",
          className,
        )}
      >
        {/* Header band: icon, title and copy. Leave it out with header={false}. */}
        {header && (
          <div
            className="border-b border-[#27272A] bg-[#18181B] px-6 pb-12 pt-6 @max-[18rem]:px-4"
            onPointerEnter={() => setHeadHover(true)}
            onPointerLeave={() => setHeadHover(false)}
          >
            <span className="grid size-10 place-items-center rounded-xl border border-[#27272A] bg-[#111111] text-[#D8FF0A] shadow-none">
              <ChartPieIcon
                className="size-5"
                active={headHover || (shown && !settled)}
              />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-[#F4F4F5]">
              {title}
            </h3>
            <p className="mt-1 text-pretty text-xs leading-relaxed text-[#A1A1AA]">
              {description}
            </p>
          </div>
        )}

        <motion.div
          initial={still ? false : { opacity: 0, y: 12 }}
          animate={shown ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.55, ease: GLIDE, delay: still ? 0 : 0.12 }}
          className={cn(
            "relative bg-[#111111] px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6 @max-[18rem]:px-4",
            header && "-mt-6 rounded-t-2xl border-t border-[#27272A]",
          )}
        >
          {/* Headline */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="relative flex h-5 items-center gap-1.5 text-xs font-medium text-[#A1A1AA]">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={focus?.name ?? "all"}
                    initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
                    transition={{ duration: still ? 0 : 0.22, ease: GLIDE }}
                    className="flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {focus && (
                      <span
                        className="size-2 rounded-full"
                        style={{ background: colorOf(active!) }}
                      />
                    )}
                    {focus ? focus.name : label}
                  </motion.span>
                </AnimatePresence>
                {info && (
                  <span className="relative">
                    <button
                      type="button"
                      aria-label="About these numbers"
                      aria-describedby={tip ? `${id}-tip` : undefined}
                      onPointerEnter={() => setTip(true)}
                      onPointerLeave={() => setTip(false)}
                      onFocus={() => setTip(true)}
                      onBlur={() => setTip(false)}
                      className="grid size-5 cursor-help place-items-center rounded-full text-[#71717A] outline-none transition-colors hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60"
                    >
                      <Info className="size-3.5" />
                    </button>
                    <AnimatePresence>
                      {tip && (
                        <motion.span
                          id={`${id}-tip`}
                          role="tooltip"
                          initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: -2, filter: "blur(4px)" }}
                          transition={{ duration: still ? 0 : 0.18, ease: GLIDE }}
                          className="pointer-events-none absolute left-1/2 top-7 z-20 w-56 -translate-x-1/2 rounded-xl border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs leading-relaxed text-[#F4F4F5] shadow-none"
                        >
                          {info}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className="text-[30px] font-semibold leading-none tracking-tight text-[#F4F4F5]"
                  aria-live="polite"
                >
                  <span className="sr-only">{headline}</span>
                  <RollText
                    text={shown ? headline : zeroed(headline)}
                    still={still}
                  />
                </span>
                {unit && (
                  <span className="text-sm font-medium text-[#71717A]">{unit}</span>
                )}
                {headDetail ? (
                  <span className="font-mono text-xs text-[#A1A1AA]">{headDetail}</span>
                ) : headChange !== undefined ? (
                  <span className="flex items-center gap-1.5">
                    <Change
                      change={headChange}
                      good={headChange >= 0}
                      nudge={active !== null}
                    />
                    <span className="text-xs text-[#71717A]">{comparisonLabel}</span>
                  </span>
                ) : null}
              </div>
            </div>
            {onDetails && (
              <motion.button
                type="button"
                onClick={onDetails}
                whileTap={still ? undefined : { scale: 0.95 }}
                aria-label="Details"
                className="group/btn flex h-8 shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-full border border-[#27272A] bg-[#18181B] pl-3 pr-2.5 text-xs font-medium text-[#F4F4F5] outline-none transition-colors hover:border-[#3F3F46] hover:bg-[#27272A] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60 @max-[18rem]:px-2.5"
              >
                {/* A narrow card keeps the arrow and drops the word, so the label beside it has room. */}
                <span className="@max-[18rem]:hidden">Details</span>
                <span className="relative grid size-4 place-items-center overflow-hidden">
                  <ArrowUpRightIcon
                    className="size-3.5 transition-transform duration-300 ease-out group-hover/btn:-translate-y-4 group-hover/btn:translate-x-4"
                    strokeWidth={2.5}
                  />
                  <ArrowUpRightIcon
                    className="absolute size-3.5 -translate-x-4 translate-y-4 transition-transform duration-300 ease-out group-hover/btn:translate-x-0 group-hover/btn:translate-y-0"
                    strokeWidth={2.5}
                  />
                </span>
              </motion.button>
            )}
          </div>

          {/* Tick bar: one slim tick per slice of the total, coloured by channel. */}
          <div
            role="img"
            aria-label={
              hasChannels
                ? channels
                    .map(
                      (c) => `${c.name} ${Math.round((Math.max(0, c.sessions) / total) * 100)}%`,
                    )
                    .join(", ")
                : emptyText
            }
            onPointerMove={pickFromPointer}
            onPointerLeave={() => setActive(null)}
            className={cn(
              "mt-5 flex h-10 items-end justify-between",
              hasChannels ? "cursor-crosshair" : "cursor-default",
            )}
          >
            {owner.map((k, i) => {
              const lit = hasChannels && (active === null || active === k);
              return (
                <motion.span
                  key={i}
                  className="h-full w-1 origin-bottom rounded-full"
                  style={{ background: k >= 0 ? colorOf(k) : "#27272A" }}
                  initial={still ? false : { scaleY: 0.08, opacity: 0 }}
                  animate={
                    shown
                      ? {
                          scaleY: hasChannels ? (lit ? 1 : 0.55) : 0.35,
                          opacity: hasChannels ? (lit ? 1 : 0.22) : 0.5,
                        }
                      : { scaleY: 0.08, opacity: 0 }
                  }
                  transition={
                    still
                      ? { duration: 0 }
                      : settled
                        ? {
                            type: "spring",
                            stiffness: 420,
                            damping: 30,
                            delay:
                              active === null
                                ? 0
                                : Math.abs(i - TICKS / 2) * 0.002,
                          }
                        : {
                            duration: 0.6,
                            ease: GLIDE,
                            delay: 0.25 + i * 0.016,
                          }
                  }
                />
              );
            })}
          </div>

          {/* Legend chips double as keyboard controls for the bar. */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {hasChannels ? (
              channels.map((c, i) => {
                const on = active === i;
                return (
                  <motion.button
                    key={c.name}
                    type="button"
                    aria-pressed={on}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    initial={still ? false : { opacity: 0, y: 6 }}
                    animate={
                      shown
                        ? { opacity: active === null || on ? 1 : 0.55, y: 0 }
                        : undefined
                    }
                    transition={{
                      duration: 0.35,
                      ease: GLIDE,
                      delay: settled || still ? 0 : 0.6 + i * 0.06,
                    }}
                    className="flex h-7 cursor-default items-center gap-2 rounded-full border border-[#27272A] bg-[#18181B] pl-2.5 pr-3 text-xs font-medium text-[#F4F4F5] outline-none transition-colors hover:border-[#3F3F46] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/60"
                  >
                    <motion.span
                      className="size-2 rounded-full"
                      style={{ background: colorOf(i) }}
                      animate={{ scale: on ? 1.45 : 1 }}
                      transition={still ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 20 }}
                    />
                    <span>{c.name}</span>
                    <span className="font-mono tabular-nums text-[#71717A]">
                      {Math.round((Math.max(0, c.sessions) / total) * 100)}%
                    </span>
                  </motion.button>
                );
              })
            ) : (
              <span className="text-xs text-[#71717A]">{emptyText}</span>
            )}
          </div>

          <div aria-hidden className="-mx-6 my-4 h-px bg-[#27272A] @max-[18rem]:-mx-4" />

          {/* Metrics */}
          <div
            role="table"
            aria-label="Channel metrics"
            onPointerLeave={() => setRow(null)}
          >
            <div
              role="row"
              className="grid grid-cols-[1fr_auto_88px] gap-3 px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-[#71717A] @max-[18rem]:grid-cols-[1fr_auto_auto] @max-[18rem]:gap-2 @max-[18rem]:px-0"
            >
              <span role="columnheader">Metric</span>
              <span role="columnheader" className="text-right">
                Value
              </span>
              <span role="columnheader" className="text-right">
                {metricThirdHeader}
              </span>
            </div>
            {metrics.map((m, i) => {
              const Icon = ICONS[m.icon];
              const hasChange = typeof m.change === "number";
              const good = hasChange ? m.change! >= 0 === (m.higherIsBetter ?? true) : true;
              const on = row === i;
              return (
                <motion.div
                  key={m.label}
                  role="row"
                  tabIndex={0}
                  onPointerEnter={() => setRow(i)}
                  onFocus={() => setRow(i)}
                  onBlur={() => setRow(null)}
                  initial={still ? false : { opacity: 0, y: 8 }}
                  animate={shown ? { opacity: 1, y: 0 } : undefined}
                  transition={{
                    duration: 0.4,
                    ease: GLIDE,
                    delay: still ? 0 : 0.7 + i * 0.07,
                  }}
                  className="relative grid h-10 grid-cols-[1fr_auto_88px] items-center gap-3 rounded-xl px-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D8FF0A]/50 @max-[18rem]:grid-cols-[1fr_auto_auto] @max-[18rem]:gap-2 @max-[18rem]:px-0"
                >
                  {on && (
                    <motion.span
                      layoutId={`${id}-row`}
                      className="absolute inset-0 rounded-xl border border-[#27272A] bg-[#18181B]"
                      transition={still ? { duration: 0 } : PILL}
                    />
                  )}
                  <span
                    role="cell"
                    className="relative flex min-w-0 items-center gap-2.5 text-sm font-medium text-[#F4F4F5]"
                  >
                    <span
                      className={cn(
                        "grid size-5 place-items-center transition-colors",
                        on ? "text-[#D8FF0A]" : "text-[#71717A]",
                      )}
                    >
                      <Icon className="size-[17px]" active={on} />
                    </span>
                    <span className="truncate">{m.label}</span>
                  </span>
                  <span
                    role="cell"
                    className="relative flex items-center justify-end font-mono text-sm tabular-nums text-[#F4F4F5]"
                  >
                    <span className="sr-only">{m.value}</span>
                    <RollText
                      text={shown ? m.value : zeroed(m.value)}
                      still={still}
                    />
                  </span>
                  <span role="cell" className="relative flex justify-end">
                    {hasChange ? (
                      <Change change={m.change!} good={good} nudge={on} />
                    ) : (
                      <span className="font-mono text-xs text-[#71717A]">{m.detail ?? "—"}</span>
                    )}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    );
  },
);

