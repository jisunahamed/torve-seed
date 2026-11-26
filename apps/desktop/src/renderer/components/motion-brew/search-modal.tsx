"use client";

/**
 * SearchModal, from https://motion-brew.com/components/search-modal
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
import { createPortal } from "react-dom";
import { type ClassValue, clsx } from "clsx";
import { AnimatePresence, motion, type Transition, useAnimation, useInView, useReducedMotion, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: arrow-right
const ArrowRightIcon = (() => {
interface ArrowRightIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ArrowRightIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PATH_VARIANTS: Variants = {
  normal: { d: "M5 12h14" },
  animate: {
    d: ["M5 12h14", "M5 12h9", "M5 12h14"],
    transition: {
      duration: 0.4,
    },
  },
};

const SECONDARY_PATH_VARIANTS: Variants = {
  normal: { d: "m12 5 7 7-7 7", translateX: 0 },
  animate: {
    d: "m12 5 7 7-7 7",
    translateX: [0, -3, 0],
    transition: {
      duration: 0.4,
    },
  },
};

const ArrowRightIcon = forwardRef<ArrowRightIconHandle, ArrowRightIconProps>(
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
            d="M5 12h14"
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="m12 5 7 7-7 7"
            variants={SECONDARY_PATH_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

ArrowRightIcon.displayName = "ArrowRightIcon";
  return ArrowRightIcon;
})();

// Animated icon: bookmark
const BookmarkIcon = (() => {
interface BookmarkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BookmarkIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const BOOKMARK_VARIANTS: Variants = {
  normal: { scaleY: 1, scaleX: 1 },
  animate: {
    scaleY: [1, 1.3, 0.9, 1.05, 1],
    scaleX: [1, 0.9, 1.1, 0.95, 1],
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

const BookmarkIcon = forwardRef<BookmarkIconHandle, BookmarkIconProps>(
  ({ className, onMouseEnter, onMouseLeave, size, active, style, strokeWidth, ...props }, ref) => {
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
            d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
            style={{ originY: 0.5, originX: 0.5 }}
            variants={BOOKMARK_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

BookmarkIcon.displayName = "BookmarkIcon";
  return BookmarkIcon;
})();

// Animated icon: chart-line
const ChartLineIcon = (() => {
interface ChartLineIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChartLineIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      delay: 0.15,
      duration: 0.3,
      opacity: { delay: 0.1 },
    },
  },
};

const ChartLineIcon = forwardRef<ChartLineIconHandle, ChartLineIconProps>(
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
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <motion.path
            animate={controls}
            d="m7 13 3-3 4 4 5-5"
            variants={VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

ChartLineIcon.displayName = "ChartLineIcon";
  return ChartLineIcon;
})();

// Animated icon: compass
const CompassIcon = (() => {
interface CompassIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CompassIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const CompassIcon = forwardRef<CompassIconHandle, CompassIconProps>(
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
          <circle cx="12" cy="12" r="10" />
          <motion.polygon
            animate={controls}
            points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 15,
            }}
            variants={{
              normal: {
                rotate: 0,
              },
              animate: {
                rotate: 360,
              },
            }}
          />
        </svg>
      </span>
    );
  }
);

CompassIcon.displayName = "CompassIcon";
  return CompassIcon;
})();

// Animated icon: history
const HistoryIcon = (() => {
interface HistoryIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface HistoryIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const ARROW_TRANSITION: Transition = {
  type: "spring",
  stiffness: 250,
  damping: 25,
};

const ARROW_VARIANTS: Variants = {
  normal: {
    rotate: "0deg",
  },
  animate: {
    rotate: "-50deg",
  },
};

const HAND_TRANSITION: Transition = {
  duration: 0.6,
  ease: [0.4, 0, 0.2, 1],
};

const HAND_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    originX: "0%",
    originY: "100%",
  },
  animate: {
    rotate: -360,
    originX: "0%",
    originY: "100%",
  },
};

const MINUTE_HAND_TRANSITION: Transition = {
  duration: 0.5,
  ease: "easeInOut",
};

const MINUTE_HAND_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    originX: "0%",
    originY: "0%",
  },
  animate: {
    rotate: -45,
    originX: "0%",
    originY: "0%",
  },
};

const HistoryIcon = forwardRef<HistoryIconHandle, HistoryIconProps>(
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
          <motion.g
            animate={controls}
            transition={ARROW_TRANSITION}
            variants={ARROW_VARIANTS}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </motion.g>
          <motion.line
            animate={controls}
            initial="normal"
            transition={HAND_TRANSITION}
            variants={HAND_VARIANTS}
            x1="12"
            x2="12"
            y1="12"
            y2="7"
          />
          <motion.line
            animate={controls}
            initial="normal"
            transition={MINUTE_HAND_TRANSITION}
            variants={MINUTE_HAND_VARIANTS}
            x1="12"
            x2="16"
            y1="12"
            y2="14"
          />
        </svg>
      </span>
    );
  }
);

HistoryIcon.displayName = "HistoryIcon";
  return HistoryIcon;
})();

// Animated icon: layout-grid
const LayoutGridIcon = (() => {
interface LayoutGridIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LayoutGridIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const RECT_1_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: {
    translateX: [0, 11, 11, 0],
    translateY: [0, 0, 0, 0],
    transition: { duration: 0.8, ease: "easeInOut", times: [0, 0.4, 0.6, 1] },
  },
};

const RECT_2_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: {
    translateX: [0, 0, 0, 0],
    translateY: [0, 11, 11, 0],
    transition: { duration: 0.8, ease: "easeInOut", times: [0, 0.4, 0.6, 1] },
  },
};

const RECT_3_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: {
    translateX: [0, -11, -11, 0],
    translateY: [0, 0, 0, 0],
    transition: { duration: 0.8, ease: "easeInOut", times: [0, 0.4, 0.6, 1] },
  },
};

const RECT_4_VARIANTS: Variants = {
  normal: { translateX: 0, translateY: 0 },
  animate: {
    translateX: [0, 0, 0, 0],
    translateY: [0, -11, -11, 0],
    transition: { duration: 0.8, ease: "easeInOut", times: [0, 0.4, 0.6, 1] },
  },
};

const LayoutGridIcon = forwardRef<LayoutGridIconHandle, LayoutGridIconProps>(
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
          <motion.rect
            animate={controls}
            height="7"
            initial="normal"
            rx="1"
            variants={RECT_1_VARIANTS}
            width="7"
            x="3"
            y="3"
          />
          <motion.rect
            animate={controls}
            height="7"
            initial="normal"
            rx="1"
            variants={RECT_2_VARIANTS}
            width="7"
            x="14"
            y="3"
          />
          <motion.rect
            animate={controls}
            height="7"
            initial="normal"
            rx="1"
            variants={RECT_3_VARIANTS}
            width="7"
            x="14"
            y="14"
          />
          <motion.rect
            animate={controls}
            height="7"
            initial="normal"
            rx="1"
            variants={RECT_4_VARIANTS}
            width="7"
            x="3"
            y="14"
          />
        </svg>
      </span>
    );
  }
);

LayoutGridIcon.displayName = "LayoutGridIcon";
  return LayoutGridIcon;
})();

// Animated icon: search
const SearchIcon = (() => {
interface SearchIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SearchIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const SearchIcon = forwardRef<SearchIconHandle, SearchIconProps>(
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
        <motion.svg
          animate={controls}
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth ?? 2}
          transition={{
            duration: 1,
            bounce: 0.3,
          }}
          variants={{
            normal: { x: 0, y: 0 },
            animate: {
              x: [0, 0, -3, 0],
              y: [0, -4, 0, 0],
            },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </motion.svg>
      </span>
    );
  }
);

SearchIcon.displayName = "SearchIcon";
  return SearchIcon;
})();

// Animated icon: trending-up
const TrendingUpIcon = (() => {
interface TrendingUpIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface TrendingUpIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const SVG_VARIANTS: Variants = {
  animate: {
    x: 0,
    y: 0,
    translateX: [0, 2, 0],
    translateY: [0, -2, 0],
    transition: {
      duration: 0.5,
    },
  },
};

const PATH_VARIANTS: Variants = {
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
    pathOffset: [1, 0],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  },
};

const ARROW_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    transition: {
      delay: 0.3,
      duration: 0.3,
      opacity: { duration: 0.1, delay: 0.3 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    pathOffset: [0.5, 0],
    transition: {
      delay: 0.3,
      duration: 0.3,
      opacity: { duration: 0.1, delay: 0.3 },
    },
  },
};

const TrendingUpIcon = forwardRef<TrendingUpIconHandle, TrendingUpIconProps>(
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
        <motion.svg
          animate={controls}
          fill="none"
          height={size}
          initial="normal"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth ?? 2}
          variants={SVG_VARIANTS}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.polyline
            animate={controls}
            initial="normal"
            points="22 7 13.5 15.5 8.5 10.5 2 17"
            variants={PATH_VARIANTS}
          />
          <motion.polyline
            animate={controls}
            initial="normal"
            points="16 7 22 7 22 13"
            variants={ARROW_VARIANTS}
          />
        </motion.svg>
      </span>
    );
  }
);

TrendingUpIcon.displayName = "TrendingUpIcon";
  return TrendingUpIcon;
})();

// Animated icon: x
const XIcon = (() => {
interface XIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface XIconProps extends React.HTMLAttributes<HTMLSpanElement> {
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
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
  },
};

const XIcon = forwardRef<XIconHandle, XIconProps>(
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
            d="M18 6 6 18"
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="m6 6 12 12"
            transition={{ delay: 0.2 }}
            variants={PATH_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

XIcon.displayName = "XIcon";
  return XIcon;
})();

// SearchModal

/**
 * SearchModal
 *
 * Trigger: type and press (plus keys and in view). A search field with a
 * card that drops down once it is used. The empty field rolls through
 * example searches, and Tab takes the one showing. Across the top of the
 * card a segmented scope control (All, Products, Shops and so on) slides a
 * white pill to the chosen scope, and while you type each scope shows how
 * many matches it holds. With nothing typed the card offers Jump back in, a
 * grid of soft tinted cards for recent things, and Shortcuts, small pills
 * whose keys slide out on hover. As you type, the best match rises in as a
 * featured Top result card and the rest follow as a quiet list, each tagged
 * with its group and with the matched letters marked by a soft highlight
 * that sweeps in. The active item (pointer or arrow keys) lifts or gains a
 * soft pill and shows an Open hint; Enter or a press opens it.
 * The card's height glides to fit, the search icon plays while you type, and
 * a slim line at the foot counts the results. Set `modal` to open it over the
 * page with Cmd or Ctrl K. Reduced motion keeps every state without movement.
 *
 * Engine: motion/react (a layoutId scope pill and row highlight, rolling
 * counts, a measured height glide, staggered entrances) with animated icons
 * from lucide-animated (MIT), vendored in src/icons.
 */

export interface SearchModalItem {
  id: string;
  title: string;
  /** Which group (scope) it belongs to. */
  group: string;
  /** A short figure, like "1,210 sales". */
  meta?: string;
  /** Background of its tile and card. */
  tint?: string;
}

export interface SearchModalAction {
  id: string;
  label: string;
  icon: "chart" | "grid" | "compass" | "trend" | "bookmark";
  /** The letter after ⌘, like "R". */
  key?: string;
}

export interface SearchModalProps {
  items?: SearchModalItem[];
  /** The scopes, after All. */
  groups?: string[];
  /** The scope at first. Default `"All"`. */
  defaultScope?: string;
  /** Ids offered under Jump back in before anything is typed, up to four. */
  recent?: string[];
  actions?: SearchModalAction[];
  /** Shown when there are no `examples`. */
  placeholder?: string;
  /** Example searches the empty field rolls through, as Search for "kettle". Tab fills the one showing. */
  examples?: string[];
  /** Open over the page with a backdrop, toggled with Cmd or Ctrl K. Default `false` (inline). */
  modal?: boolean;
  /** With `modal`, whether it starts open. */
  defaultOpen?: boolean;
  onSelect?: (item: SearchModalItem | SearchModalAction) => void;
  className?: string;
}

const DEFAULT_GROUPS = ["Products", "Shops", "Watchlist", "Keywords"];

const DEFAULT_ITEMS: SearchModalItem[] = [
  {
    id: "p1",
    group: "Products",
    title: "Ceramic pour over kettle",
    meta: "1,210 sales",
    tint: "#18181B",
  },
  {
    id: "p2",
    group: "Products",
    title: "Linen tote bag",
    meta: "970 sales",
    tint: "#18181B",
  },
  {
    id: "p3",
    group: "Products",
    title: "Walnut desk organiser",
    meta: "640 sales",
    tint: "#18181B",
  },
  {
    id: "p4",
    group: "Products",
    title: "Matte steel water bottle",
    meta: "2,140 sales",
    tint: "#18181B",
  },
  {
    id: "p5",
    group: "Products",
    title: "Stoneware mug set",
    meta: "388 sales",
    tint: "#18181B",
  },
  {
    id: "s1",
    group: "Shops",
    title: "Northwind Goods",
    meta: "12 products",
    tint: "#18181B",
  },
  {
    id: "s2",
    group: "Shops",
    title: "Moonspirit Studio",
    meta: "48 products",
    tint: "#18181B",
  },
  {
    id: "s3",
    group: "Shops",
    title: "Paper and Pine",
    meta: "31 products",
    tint: "#18181B",
  },
  {
    id: "s4",
    group: "Shops",
    title: "Switchback Supply",
    meta: "86 products",
    tint: "#18181B",
  },
  {
    id: "w1",
    group: "Watchlist",
    title: "Kettle price drops",
    meta: "3 alerts",
    tint: "#18181B",
  },
  {
    id: "w2",
    group: "Watchlist",
    title: "Spring launch keywords",
    meta: "12 terms",
    tint: "#18181B",
  },
  {
    id: "k1",
    group: "Keywords",
    title: "pour over coffee",
    meta: "8.2k searches",
    tint: "#18181B",
  },
  {
    id: "k2",
    group: "Keywords",
    title: "minimal desk setup",
    meta: "5.1k searches",
    tint: "#18181B",
  },
  {
    id: "k3",
    group: "Keywords",
    title: "linen tote",
    meta: "2.4k searches",
    tint: "#18181B",
  },
  {
    id: "t1",
    group: "Tags",
    title: "handmade",
    meta: "1.9k items",
    tint: "#18181B",
  },
  {
    id: "t2",
    group: "Tags",
    title: "stoneware",
    meta: "740 items",
    tint: "#18181B",
  },
  {
    id: "p6",
    group: "Products",
    title: "Gooseneck kettle, matte black",
    meta: "1,880 sales",
    tint: "#18181B",
  },
  {
    id: "p7",
    group: "Products",
    title: "Studio desk lamp",
    meta: "512 sales",
    tint: "#18181B",
  },
  {
    id: "p8",
    group: "Products",
    title: "Linen napkin set",
    meta: "430 sales",
    tint: "#18181B",
  },
  {
    id: "p9",
    group: "Products",
    title: "Standing desk mat",
    meta: "296 sales",
    tint: "#18181B",
  },
  {
    id: "s5",
    group: "Shops",
    title: "Studio North",
    meta: "22 products",
    tint: "#18181B",
  },
  {
    id: "s6",
    group: "Shops",
    title: "Linen and Loom",
    meta: "64 products",
    tint: "#18181B",
  },
  {
    id: "s7",
    group: "Shops",
    title: "Stoneware Co.",
    meta: "19 products",
    tint: "#18181B",
  },
  {
    id: "w3",
    group: "Watchlist",
    title: "Studio lamp restock",
    meta: "1 alert",
    tint: "#18181B",
  },
  {
    id: "w4",
    group: "Watchlist",
    title: "Desk accessories trend",
    meta: "6 terms",
    tint: "#18181B",
  },
  {
    id: "w5",
    group: "Watchlist",
    title: "Stoneware competitors",
    meta: "4 shops",
    tint: "#18181B",
  },
];

const DEFAULT_ACTIONS: SearchModalAction[] = [
  { id: "a1", label: "Product analytics", icon: "chart", key: "R" },
  { id: "a2", label: "Shop analyser", icon: "grid", key: "Y" },
  { id: "a3", label: "Keyword research", icon: "compass", key: "F" },
  { id: "a4", label: "Trends", icon: "trend", key: "T" },
];

const ACTION_ICONS: Record<
  SearchModalAction["icon"],
  React.ComponentType<{ active?: boolean; className?: string }>
> = {
  chart: ChartLineIcon,
  grid: LayoutGridIcon,
  compass: CompassIcon,
  trend: TrendingUpIcon,
  bookmark: BookmarkIcon,
};

const GLIDE = [0.22, 1, 0.36, 1] as const;
const POP: Transition = { type: "spring", stiffness: 520, damping: 30 };
const SOFT: Transition = { type: "spring", stiffness: 340, damping: 34 };

type Entry =
  | { kind: "item"; key: string; item: SearchModalItem }
  | { kind: "action"; key: string; action: SearchModalAction };

/** The title with every match of the query marked by a soft highlight that sweeps in. */
function Marked({
  text,
  query,
  still,
}: {
  text: string;
  query: string;
  still: boolean;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  let k = 0;
  for (;;) {
    const i = lower.indexOf(q, at);
    if (i < 0) break;
    if (i > at) parts.push(text.slice(at, i));
    parts.push(
      <span key={k++} className="relative">
        <motion.span
          aria-hidden
          className="absolute -inset-x-0.5 inset-y-0 rounded-[4px] bg-[#D8FF0A]/25"
          initial={still ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.35, ease: GLIDE }}
          style={{ originX: 0 }}
        />
        <span className="relative text-[#D8FF0A]">{text.slice(i, i + q.length)}</span>
      </span>,
    );
    at = i + q.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** A small keycap. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-6 min-w-6 place-items-center rounded-md border border-[#27272A] bg-[#18181B] px-1.5 text-[11px] font-medium text-[#A1A1AA]">
      {children}
    </span>
  );
}

/** A number that rolls when it changes. */
function Count({
  value,
  still,
  className,
}: {
  value: number;
  still: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-grid overflow-hidden tabular-nums",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={still ? { opacity: 0 } : { y: "80%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={still ? { opacity: 0 } : { y: "-80%", opacity: 0 }}
          transition={{ duration: 0.25, ease: GLIDE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export const SearchModal = React.forwardRef<HTMLDivElement, SearchModalProps>(
  function SearchModal(
    {
      items = DEFAULT_ITEMS,
      groups = DEFAULT_GROUPS,
      defaultScope = "All",
      recent = ["p1", "s2", "p2", "s3"],
      actions = DEFAULT_ACTIONS,
      placeholder = "Search products, shops and more",
      examples = ["kettle", "studio", "linen", "desk", "stoneware"],
      modal = false,
      defaultOpen = false,
      onSelect,
      className,
    },
    ref,
  ) {
    const still = !!useReducedMotion();
    const uid = React.useId();
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const input = React.useRef<HTMLInputElement>(null);
    const body = React.useRef<HTMLDivElement>(null);
    const seen = useInView(root, { once: true, amount: 0.3 });
    const shown = seen || still || modal;

    const [isMac, setIsMac] = React.useState(false);
    React.useEffect(() => {
      if (typeof navigator !== "undefined") {
        setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || ""));
      }
    }, []);
    const modKey = isMac ? "⌘" : "Ctrl";

    const [open, setOpen] = React.useState(!modal || defaultOpen);
    // Inline, the card drops down only once the field is used.
    const [expanded, setExpanded] = React.useState(modal);
    const showCard = modal || expanded;
    const [query, setQuery] = React.useState("");
    const [scope, setScope] = React.useState(defaultScope);
    const [cursor, setCursor] = React.useState(0);
    const [focused, setFocused] = React.useState(false);
    const [typing, setTyping] = React.useState(false);
    const [hint, setHint] = React.useState(0);
    const typingTimer = React.useRef(0);
    React.useEffect(() => () => window.clearTimeout(typingTimer.current), []);

    const scopes = ["All", ...groups];
    const q = query.trim().toLowerCase();
    const inScope = (i: SearchModalItem) =>
      scope === "All" || i.group === scope;
    const matches = React.useMemo(
      () =>
        q
          ? items.filter(
              (i) =>
                i.title.toLowerCase().includes(q) ||
                i.meta?.toLowerCase().includes(q) ||
                i.group.toLowerCase().includes(q),
            )
          : [],
      [q, items],
    );
    const counts = React.useMemo(() => {
      const c: Record<string, number> = { All: matches.length };
      for (const g of groups)
        c[g] = matches.filter((i) => i.group === g).length;
      return c;
    }, [matches, groups]);

    // What can be chosen, in order: recent cards and shortcuts, or results.
    const recentItems = recent
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is SearchModalItem => !!i && inScope(i))
      .slice(0, 4);
    const found = matches.filter(inScope);
    const results = found.slice(0, 7);
    const entries: Entry[] = q
      ? results.map((item) => ({
          kind: "item" as const,
          key: `i-${item.id}`,
          item,
        }))
      : [
          ...recentItems.map((item) => ({
            kind: "item" as const,
            key: `r-${item.id}`,
            item,
          })),
          ...actions.map((action) => ({
            kind: "action" as const,
            key: `a-${action.id}`,
            action,
          })),
        ];
    const at = entries.length ? Math.min(cursor, entries.length - 1) : -1;
    const activeKey = at >= 0 ? entries[at]!.key : null;

    React.useEffect(() => setCursor(0), [q, scope]);

    // The empty field rolls through examples.
    React.useEffect(() => {
      if (query || examples.length < 2 || still) return;
      const t = window.setInterval(
        () => setHint((h) => (h + 1) % examples.length),
        2400,
      );
      return () => window.clearInterval(t);
    }, [query, examples.length, still]);
    const example = examples.length
      ? examples[hint % examples.length]
      : undefined;

    // The body's height follows its content, so changes glide.
    const [height, setHeight] = React.useState<number | "auto">("auto");
    React.useLayoutEffect(() => {
      const el = body.current;
      if (!el) return;
      setHeight(el.offsetHeight);
      if (typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
      ro.observe(el);
      return () => ro.disconnect();
    }, [showCard]);

    // Inline: a press outside folds the card away.
    React.useEffect(() => {
      if (modal || !expanded) return;
      const away = (e: PointerEvent) => {
        if (!root.current?.contains(e.target as Node)) setExpanded(false);
      };
      document.addEventListener("pointerdown", away);
      return () => document.removeEventListener("pointerdown", away);
    }, [modal, expanded]);

    // Modal: Cmd or Ctrl K toggles it, and opening focuses the field.
    React.useEffect(() => {
      if (!modal) return;
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setOpen((o) => !o);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [modal]);
    React.useEffect(() => {
      if (modal && open) requestAnimationFrame(() => input.current?.focus());
    }, [modal, open]);

    const choose = (entry: Entry | undefined) => {
      if (!entry) return;
      onSelect?.(entry.kind === "item" ? entry.item : entry.action);
      if (modal) {
        setOpen(false);
        setQuery("");
      }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!expanded) setExpanded(true);
      if (e.key === "Tab" && !query && example && !e.shiftKey) {
        // Tab takes the example that is showing.
        e.preventDefault();
        setQuery(example);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!entries.length) return;
        setCursor(
          (c) =>
            (Math.min(c, entries.length - 1) +
              (e.key === "ArrowDown" ? 1 : entries.length - 1)) %
            entries.length,
        );
      } else if (
        (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
        e.altKey
      ) {
        // Alt and the side arrows step through the scopes.
        e.preventDefault();
        const i = scopes.indexOf(scope);
        setScope(
          scopes[
            (i + (e.key === "ArrowRight" ? 1 : scopes.length - 1)) %
              scopes.length
          ]!,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(entries[at]);
      } else if (e.key === "Escape") {
        if (query) setQuery("");
        else if (modal) setOpen(false);
        else if (expanded) setExpanded(false);
        else return;
        e.preventDefault();
        e.stopPropagation();
      } else if ((e.metaKey || e.ctrlKey) && e.key.length === 1) {
        const action = actions.find(
          (a) => a.key?.toLowerCase() === e.key.toLowerCase(),
        );
        if (!action) return;
        e.preventDefault();
        choose({ kind: "action", key: `a-${action.id}`, action });
      }
    };

    const enter = (delay: number) => ({
      initial: still
        ? (false as const)
        : { opacity: 0, y: 10, filter: "blur(4px)" },
      animate: shown ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined,
      transition: { duration: 0.5, ease: GLIDE, delay: still ? 0 : delay },
    });
    const rise = (i: number) => ({
      initial: still
        ? (false as const)
        : { opacity: 0, y: 8, filter: "blur(4px)" },
      animate: { opacity: 1, y: 0, filter: "blur(0px)" },
      transition: { duration: 0.35, ease: GLIDE, delay: still ? 0 : i * 0.04 },
    });

    const optionProps = (entry: Entry, index: number) => ({
      id: `${uid}-${entry.key}`,
      role: "option" as const,
      "aria-selected": entry.key === activeKey,
      onPointerEnter: () => setCursor(index),
      onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
      onClick: () => choose(entry),
    });

    /** The Open hint, on the right of the active entry. */
    const tail = (key: string, extra?: React.ReactNode) => (
      <AnimatePresence mode="popLayout" initial={false}>
        {activeKey === key ? (
          <motion.span
            key="open"
            initial={still ? { opacity: 0 } : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.25, ease: GLIDE }}
            className="relative flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#A1A1AA]"
          >
            Open
            <span className="grid h-5 min-w-5 place-items-center rounded-[6px] border border-[#27272A] bg-[#18181B] px-1 text-[12px] text-[#D8FF0A]">
              ↵
            </span>
          </motion.span>
        ) : (
          extra
        )}
      </AnimatePresence>
    );

    const top = q ? results[0] : undefined;
    const rest = q ? results.slice(1) : [];

    const panel = (
      <div
        ref={root}
        onKeyDown={(e) => {
          // Escape from inside the card clears first, before the page sees it.
          if (e.key !== "Escape" || e.target === input.current || !query)
            return;
          setQuery("");
          input.current?.focus();
          e.stopPropagation();
        }}
        className={cn(
          "relative w-[560px] max-w-full text-[#F4F4F5]",
          !modal && className,
        )}
      >
        {/* The field */}
        <motion.div
          {...enter(0)}
          animate={
            shown
              ? {
                  opacity: 1,
                  y: 0,
                  filter: "blur(0px)",
                  boxShadow: focused
                    ? "0 0 0 2px rgba(216,255,10,0.3), 0 18px 44px -16px rgba(0,0,0,0.85)"
                    : "0 0 0 0px rgba(216,255,10,0), 0 12px 32px -16px rgba(0,0,0,0.7)",
                }
              : undefined
          }
          className="relative flex h-14 items-center gap-3 rounded-[22px] border border-[#27272A] bg-[#111111] pl-4 pr-2.5"
        >
          <SearchIcon
            className="size-5 shrink-0 text-[#71717A]"
            active={typing}
          />
          <div className="relative h-full min-w-0 flex-1">
            <input
              ref={input}
              value={query}
              role="combobox"
              aria-expanded={showCard}
              aria-controls={`${uid}-list`}
              aria-activedescendant={
                activeKey ? `${uid}-${activeKey}` : undefined
              }
              aria-label="Search"
              placeholder={example ? "" : placeholder}
              onChange={(e) => {
                setQuery(e.target.value);
                setTyping(true);
                window.clearTimeout(typingTimer.current);
                typingTimer.current = window.setTimeout(
                  () => setTyping(false),
                  600,
                );
              }}
              onFocus={() => {
                setFocused(true);
                setExpanded(true);
              }}
              onPointerDown={() => setExpanded(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              className="h-full w-full bg-transparent text-[16px] text-[#F4F4F5] caret-[#D8FF0A] outline-none placeholder:text-[#71717A]"
            />
            {/* The rolling example, shown while the field is empty. */}
            {!query && example && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-nowrap text-[16px] text-[#71717A]"
              >
                Search for&nbsp;
                <span className="relative inline-grid overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={example}
                      initial={
                        still
                          ? { opacity: 0 }
                          : { y: "80%", opacity: 0, filter: "blur(3px)" }
                      }
                      animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                      exit={
                        still
                          ? { opacity: 0 }
                          : { y: "-80%", opacity: 0, filter: "blur(3px)" }
                      }
                      transition={{ duration: 0.4, ease: GLIDE }}
                      className="text-[#A1A1AA]"
                    >
                      &ldquo;{example}&rdquo;
                    </motion.span>
                  </AnimatePresence>
                </span>
                {focused && (
                  <span className="ml-2 rounded-md border border-[#27272A] bg-[#18181B] px-1.5 text-[12px] leading-5 text-[#A1A1AA]">
                    Tab
                  </span>
                )}
              </span>
            )}
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {query ? (
              <motion.button
                key="clear"
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
                initial={
                  still
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.6, rotate: -90 }
                }
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={
                  still
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.6, rotate: 90 }
                }
                whileTap={still ? undefined : { scale: 0.88 }}
                transition={POP}
                className="group grid size-9 cursor-pointer place-items-center rounded-full text-[#71717A] outline-none transition-colors hover:bg-[#18181B] hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
              >
                <XIcon className="size-4" />
              </motion.button>
            ) : (
              <motion.span
                key="keys"
                aria-hidden
                initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={POP}
                className="flex gap-1 pr-1"
              >
                <Key>{modKey}</Key>
                <Key>K</Key>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>

        {/* The card: inline it drops down over the page once the field is used. */}
        <AnimatePresence>
          {showCard && (
            <motion.div
              key="card"
              initial={
                still
                  ? { opacity: 0 }
                  : { opacity: 0, y: -8, scale: 0.98, filter: "blur(6px)" }
              }
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={
                still
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: -6,
                      scale: 0.98,
                      filter: "blur(4px)",
                      transition: { duration: 0.18 },
                    }
              }
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              style={{ transformOrigin: "50% 0%" }}
              className={cn(
                "mt-2 overflow-hidden rounded-[24px] border border-[#27272A] bg-[#111111] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]",
                modal ? "relative" : "absolute inset-x-0 top-full z-30",
              )}
            >
              {/* Scope: a segmented control with a gliding pill, and live counts while typing. */}
              <div className="p-2">
                <div
                  role="tablist"
                  aria-label="Search in"
                  className="flex gap-0.5 overflow-x-auto rounded-full border border-[#27272A] bg-[#0A0A0A] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {scopes.map((s) => {
                    const on = s === scope;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setScope(s)}
                        className={cn(
                          "relative flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
                          on
                            ? "font-semibold text-[#0A0A0A]"
                            : "text-[#A1A1AA] hover:text-[#F4F4F5]",
                        )}
                      >
                        {on && (
                          <motion.span
                            layoutId={`${uid}-scope`}
                            transition={still ? { duration: 0 } : POP}
                            className="absolute inset-0 rounded-full bg-[#D8FF0A]"
                          />
                        )}
                        <span className="relative">{s}</span>
                        <AnimatePresence initial={false}>
                          {q && (
                            <motion.span
                              initial={
                                still
                                  ? { opacity: 0 }
                                  : { opacity: 0, width: 0, scale: 0.6 }
                              }
                              animate={{ opacity: 1, width: "auto", scale: 1 }}
                              exit={
                                still
                                  ? { opacity: 0 }
                                  : { opacity: 0, width: 0, scale: 0.6 }
                              }
                              transition={POP}
                              className={cn(
                                "relative grid h-5 min-w-5 place-items-center rounded-full px-1 text-[12px]",
                                counts[s]
                                  ? on
                                    ? "bg-[#0A0A0A]/20 text-[#0A0A0A]"
                                    : "bg-[#18181B] text-[#A1A1AA]"
                                  : "bg-transparent text-[#71717A]",
                              )}
                            >
                              <Count value={counts[s] ?? 0} still={still} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    );
                  })}
                </div>
              </div>

              <motion.div
                animate={{ height }}
                transition={still ? { duration: 0 } : SOFT}
                className="overflow-hidden"
              >
                <div
                  ref={body}
                  id={`${uid}-list`}
                  role="listbox"
                  aria-label="Results"
                  className="flow-root px-3 pb-3"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {!q ? (
                      <motion.div
                        key="idle"
                        exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      >
                        {/* Jump back in: a grid of soft cards. */}
                        {recentItems.length > 0 && (
                          <>
                            <p className="px-1 pb-2 pt-2 text-[12px] font-medium text-[#71717A]">
                              Jump back in
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {recentItems.map((item, i) => {
                                const entry = entries[i]!;
                                const on = entry.key === activeKey;
                                return (
                                  <motion.div
                                    key={entry.key}
                                    {...rise(i)}
                                    {...optionProps(entry, i)}
                                    whileTap={
                                      still ? undefined : { scale: 0.97 }
                                    }
                                    className="group relative cursor-pointer rounded-2xl border border-[#27272A] p-3"
                                    style={{
                                      backgroundColor: item.tint ?? "#18181B",
                                    }}
                                  >
                                    <motion.span
                                      aria-hidden
                                      animate={{ opacity: on ? 1 : 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="absolute inset-0 rounded-2xl bg-[#D8FF0A]/[0.08] ring-1 ring-[#D8FF0A]/35"
                                    />
                                    <div className="relative flex items-start justify-between gap-2">
                                      <motion.span
                                        animate={{
                                          rotate: on && !still ? -6 : 0,
                                          scale: on && !still ? 1.06 : 1,
                                        }}
                                        transition={POP}
                                        className="grid size-8 place-items-center rounded-[10px] border border-[#27272A] bg-[#0A0A0A] text-[14px] font-semibold text-[#D8FF0A]"
                                      >
                                        {item.title[0]!.toUpperCase()}
                                      </motion.span>
                                      {tail(
                                        entry.key,
                                        <span
                                          key="group"
                                          className="text-[12px] text-[#71717A]"
                                        >
                                          {item.group}
                                        </span>,
                                      )}
                                    </div>
                                    <p className="relative mt-3 truncate text-[14px] font-medium text-[#F4F4F5]">
                                      {item.title}
                                    </p>
                                    {item.meta && (
                                      <p className="relative truncate text-[12px] text-[#A1A1AA]">
                                        {item.meta}
                                      </p>
                                    )}
                                  </motion.div>
                                );
                              })}
                            </div>
                          </>
                        )}
                        {/* Shortcuts: small pills, their keys slide out on hover. */}
                        {actions.length > 0 && (
                          <>
                            <p className="px-1 pb-2 pt-4 text-[12px] font-medium text-[#71717A]">
                              Shortcuts
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {actions.map((action, j) => {
                                const index = recentItems.length + j;
                                const entry = entries[index]!;
                                const on = entry.key === activeKey;
                                const Icon = ACTION_ICONS[action.icon];
                                return (
                                  <motion.div
                                    key={entry.key}
                                    {...rise(index)}
                                    {...optionProps(entry, index)}
                                    whileTap={
                                      still ? undefined : { scale: 0.95 }
                                    }
                                    className={cn(
                                      "group relative flex h-9 cursor-pointer items-center gap-2 rounded-full border pl-2.5 pr-3 text-[14px] transition-colors",
                                      on
                                        ? "border-[#D8FF0A]/35 bg-[#D8FF0A]/12 text-[#F4F4F5]"
                                        : "border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:text-[#F4F4F5]",
                                    )}
                                  >
                                    <Icon
                                      className={cn(
                                        "size-4",
                                        on ? "text-[#D8FF0A]" : "text-[#A1A1AA]",
                                      )}
                                      active={on}
                                    />
                                    {action.label}
                                    <AnimatePresence initial={false}>
                                      {on && action.key && (
                                        <motion.span
                                          initial={
                                            still
                                              ? { opacity: 0 }
                                              : { opacity: 0, width: 0 }
                                          }
                                          animate={{
                                            opacity: 1,
                                            width: "auto",
                                          }}
                                          exit={
                                            still
                                              ? { opacity: 0 }
                                              : { opacity: 0, width: 0 }
                                          }
                                          transition={{
                                            duration: 0.25,
                                            ease: GLIDE,
                                          }}
                                          className="overflow-hidden whitespace-nowrap text-[12px] text-[#D8FF0A]"
                                        >
                                          {modKey} {action.key}
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
                                  </motion.div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </motion.div>
                    ) : top ? (
                      <motion.div
                        key={`found-${scope}`}
                        exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      >
                        {/* Top result: the best match, featured. */}
                        <p className="px-1 pb-2 pt-2 text-[12px] font-medium text-[#71717A]">
                          Top result
                        </p>
                        {(() => {
                          const entry = entries[0]!;
                          const on = entry.key === activeKey;
                          return (
                            <motion.div
                              key={entry.key}
                              {...rise(0)}
                              {...optionProps(entry, 0)}
                              animate={{
                                opacity: 1,
                                y: on && !still ? -1 : 0,
                                filter: "blur(0px)",
                              }}
                              whileTap={still ? undefined : { scale: 0.985 }}
                              className="group relative flex cursor-pointer items-center gap-3 rounded-2xl border border-[#27272A] p-3"
                              style={{ backgroundColor: top.tint ?? "#18181B" }}
                            >
                              <motion.span
                                aria-hidden
                                animate={{ opacity: on ? 1 : 0 }}
                                transition={{ duration: 0.2 }}
                                className="absolute inset-0 rounded-2xl bg-[#D8FF0A]/[0.08] ring-1 ring-[#D8FF0A]/35"
                              />
                              <motion.span
                                animate={{
                                  rotate: on && !still ? -6 : 0,
                                  scale: on && !still ? 1.06 : 1,
                                }}
                                transition={POP}
                                className="relative grid size-11 shrink-0 place-items-center rounded-[14px] border border-[#27272A] bg-[#0A0A0A] text-[16px] font-semibold text-[#D8FF0A]"
                              >
                                {top.title[0]!.toUpperCase()}
                              </motion.span>
                              <span className="relative min-w-0 flex-1">
                                <span className="block truncate text-[16px] font-medium leading-6 text-[#F4F4F5]">
                                  <Marked
                                    text={top.title}
                                    query={query}
                                    still={still}
                                  />
                                </span>
                                <span className="block truncate text-[12px] text-[#A1A1AA]">
                                  {top.group}
                                  {top.meta ? ` · ${top.meta}` : ""}
                                </span>
                              </span>
                              {tail(
                                entry.key,
                                <span
                                  key="arrow"
                                  className="relative grid size-8 place-items-center rounded-full border border-[#27272A] bg-[#0A0A0A] text-[#A1A1AA]"
                                >
                                  <ArrowRightIcon className="size-4" />
                                </span>,
                              )}
                            </motion.div>
                          );
                        })()}
                        {/* The rest: a quiet list, each tagged with its group. */}
                        {rest.length > 0 && (
                          <>
                            <p className="px-1 pb-1 pt-4 text-[12px] font-medium text-[#71717A]">
                              More results
                            </p>
                            {rest.map((item, j) => {
                              const index = j + 1;
                              const entry = entries[index]!;
                              const on = entry.key === activeKey;
                              return (
                                <motion.div
                                  key={entry.key}
                                  {...rise(index)}
                                  {...optionProps(entry, index)}
                                  className="group relative flex h-11 cursor-pointer items-center gap-3 rounded-xl px-2"
                                >
                                  {on && (
                                    <motion.span
                                      layoutId={`${uid}-row`}
                                      transition={still ? { duration: 0 } : POP}
                                      className="absolute inset-0 rounded-xl border border-[#27272A] bg-[#18181B]"
                                    />
                                  )}
                                  <span
                                    className="relative size-2 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: on ? "#D8FF0A" : "#14FF73",
                                    }}
                                  />
                                  <span className="relative min-w-0 flex-1 truncate text-[14px] text-[#F4F4F5]">
                                    <Marked
                                      text={item.title}
                                      query={query}
                                      still={still}
                                    />
                                  </span>
                                  {tail(
                                    entry.key,
                                    <span
                                      key="tag"
                                      className="relative flex shrink-0 items-center gap-2 text-[12px] text-[#71717A]"
                                    >
                                      {item.meta && (
                                        <span className="max-w-[160px] truncate tabular-nums text-[#A1A1AA]">
                                          {item.meta}
                                        </span>
                                      )}
                                      <span className="rounded-full border border-[#27272A] bg-[#18181B] px-2 py-0.5 text-[#A1A1AA]">
                                        {item.group}
                                      </span>
                                    </span>,
                                  )}
                                </motion.div>
                              );
                            })}
                          </>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="none"
                        initial={
                          still
                            ? { opacity: 0 }
                            : { opacity: 0, y: 8, filter: "blur(4px)" }
                        }
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.35, ease: GLIDE }}
                        className="flex flex-col items-center px-6 pb-4 pt-8 text-center"
                      >
                        <span className="grid size-11 place-items-center rounded-full border border-[#27272A] bg-[#18181B] text-[#71717A]">
                          <SearchIcon className="size-5" active />
                        </span>
                        <p className="mt-3 text-[14px] font-medium text-[#F4F4F5]">
                          Nothing for &ldquo;{query.trim()}&rdquo;
                          {scope !== "All" ? ` in ${scope}` : ""}
                        </p>
                        <p className="mt-1 text-[12px] text-[#71717A]">
                          {scope !== "All" && counts.All ? (
                            <button
                              type="button"
                              onClick={() => setScope("All")}
                              className="cursor-pointer text-[#D8FF0A] underline decoration-[#D8FF0A]/40 underline-offset-2 hover:text-[#14FF73]"
                            >
                              Search everything instead ({counts.All})
                            </button>
                          ) : (
                            "Try another word."
                          )}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* A slim line at the foot. */}
              <div className="flex items-center justify-between border-t border-[#27272A] px-5 py-2.5 text-[12px] text-[#71717A]">
                <span>
                  {q ? (
                    <>
                      {found.length > results.length ? "Showing " : ""}
                      <Count
                        value={results.length}
                        still={still}
                        className="font-medium text-[#F4F4F5]"
                      />
                      {found.length > results.length
                        ? ` of ${found.length}`
                        : ""}{" "}
                      {found.length === 1 ? "result" : "results"}
                      {scope !== "All" ? ` in ${scope}` : ""}
                    </>
                  ) : (
                    "Type to search, Tab for the example"
                  )}
                </span>
                <span>
                  ↑ ↓ to move, ↵ to open, Esc to {modal ? "close" : "clear"}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <span role="status" aria-live="polite" className="sr-only">
          {q ? `${found.length} results` : ""}
        </span>
      </div>
    );

    if (!modal) return panel;

    // Modal: a trigger, then the search over a soft backdrop, on the body.
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "group flex h-9 w-64 max-w-full cursor-pointer items-center gap-2 rounded-full border border-[#27272A] bg-[#111111] pl-3.5 pr-2 text-[13px] text-[#A1A1AA] outline-none transition-colors hover:border-[#3F3F46] hover:bg-[#18181B] hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
            className,
          )}
        >
          <SearchIcon className="size-4 text-[#71717A] transition-colors group-hover:text-[#D8FF0A]" />
          <span className="flex-1 truncate text-left">Search views, apps, models…</span>
          <span className="flex shrink-0 gap-1">
            <Key>{modKey}</Key>
            <Key>K</Key>
          </span>
        </button>
        {typeof document !== "undefined" &&
          createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    aria-hidden
                    onClick={() => setOpen(false)}
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                  />
                  <motion.div
                    role="dialog"
                    aria-modal
                    aria-label="Search"
                    initial={
                      still
                        ? false
                        : {
                            opacity: 0,
                            y: -12,
                            scale: 0.97,
                            filter: "blur(6px)",
                          }
                    }
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      filter: "blur(0px)",
                    }}
                    exit={
                      still
                        ? { opacity: 0 }
                        : {
                            opacity: 0,
                            y: -8,
                            scale: 0.98,
                            filter: "blur(4px)",
                          }
                    }
                    transition={{ duration: 0.3, ease: GLIDE }}
                    className="relative"
                  >
                    {panel}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )}
      </>
    );
  },
);

