"use client";

/**
 * ToastStack, from https://motion-brew.com/components/toast-stack
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
import { animate, AnimatePresence, cubicBezier, motion, type Transition, useAnimation, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: badge-alert
const BadgeAlertIcon = (() => {
interface BadgeAlertIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BadgeAlertIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const ICON_VARIANTS: Variants = {
  normal: { scale: 1, rotate: 0 },
  animate: {
    scale: [1, 1.1, 1.1, 1.1, 1],
    rotate: [0, -3, 3, -2, 2, 0],
    transition: {
      duration: 0.5,
      times: [0, 0.2, 0.4, 0.6, 1],
      ease: "easeInOut",
    },
  },
};
const BadgeAlertIcon = forwardRef<BadgeAlertIconHandle, BadgeAlertIconProps>(
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
          variants={ICON_VARIANTS}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </motion.svg>
      </span>
    );
  }
);

BadgeAlertIcon.displayName = "BadgeAlertIcon";
  return BadgeAlertIcon;
})();

// Animated icon: bell
const BellIcon = (() => {
interface BellIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface BellIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const SVG_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: { rotate: [0, -10, 10, -10, 0] },
};

const BellIcon = forwardRef<BellIconHandle, BellIconProps>(
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
            duration: 0.5,
            ease: "easeInOut",
          }}
          variants={SVG_VARIANTS}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </motion.svg>
      </span>
    );
  }
);

BellIcon.displayName = "BellIcon";
  return BellIcon;
})();

// Animated icon: circle-check
const CircleCheckIcon = (() => {
interface CircleCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CircleCheckIconProps extends React.HTMLAttributes<HTMLSpanElement> {
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
      duration: 0.3,
      opacity: { duration: 0.1 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  },
};

const CircleCheckIcon = forwardRef<CircleCheckIconHandle, CircleCheckIconProps>(
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
          <motion.path
            animate={controls}
            d="m9 12 2 2 4-4"
            initial="normal"
            variants={PATH_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

CircleCheckIcon.displayName = "CircleCheckIcon";
  return CircleCheckIcon;
})();

// Animated icon: delete
const DeleteIcon = (() => {
interface DeleteIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface DeleteIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const LID_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: -1.1 },
};

const SPRING_TRANSITION: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
};

const DeleteIcon = forwardRef<DeleteIconHandle, DeleteIconProps>(
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
            transition={SPRING_TRANSITION}
            variants={LID_VARIANTS}
          >
            <path d="M3 6h18" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </motion.g>
          <motion.path
            animate={controls}
            d="M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8"
            transition={SPRING_TRANSITION}
            variants={{
              normal: { d: "M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8" },
              animate: { d: "M19 9v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V9" },
            }}
          />
          <motion.line
            animate={controls}
            transition={SPRING_TRANSITION}
            variants={{
              normal: { y1: 11, y2: 17 },
              animate: { y1: 11.5, y2: 17.5 },
            }}
            x1="10"
            x2="10"
            y1="11"
            y2="17"
          />
          <motion.line
            animate={controls}
            transition={SPRING_TRANSITION}
            variants={{
              normal: { y1: 11, y2: 17 },
              animate: { y1: 11.5, y2: 17.5 },
            }}
            x1="14"
            x2="14"
            y1="11"
            y2="17"
          />
        </svg>
      </span>
    );
  }
);

DeleteIcon.displayName = "DeleteIcon";
  return DeleteIcon;
})();

// Animated icon: undo
const UndoIcon = (() => {
interface UndoIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UndoIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const CUSTOM_EASING = cubicBezier(0.25, 0.1, 0.25, 1);

const UndoIcon = forwardRef<UndoIconHandle, UndoIconProps>(
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
            d="M3 7v6h6"
            transition={{
              duration: 0.6,
              ease: CUSTOM_EASING,
            }}
            variants={{
              normal: { translateX: 0, translateY: 0, rotate: 0 },
              animate: {
                translateX: [0, 2.1, 0],
                translateY: [0, -1.4, 0],
                rotate: [0, 12, 0],
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"
            transition={{
              duration: 0.6,
              ease: CUSTOM_EASING,
            }}
            variants={{
              normal: { pathLength: 1 },
              animate: { pathLength: [1, 0.8, 1] },
            }}
          />
        </svg>
      </span>
    );
  }
);

UndoIcon.displayName = "UndoIcon";
  return UndoIcon;
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

// ToastStack

/**
 * ToastStack
 *
 * Trigger: drag (plus hover and press). Notifications gather in a neat stack in
 * the middle of their container instead of a screen corner: the newest sits in
 * front and up to two older ones peek out behind it, smaller and quieter. A new
 * toast rises in from below out of a blur and its icon plays (the check draws,
 * the badge shakes, the bin lid lifts), while the rest step back. Hover or
 * focus the stack and it fans open into a list, pausing every timer; leave and
 * it folds back. Swipe a toast left or right and it tilts and fades with your
 * finger, then flies off past a threshold (or springs back); the close button
 * or Delete key works too. Toasts with a timer show a thin line that runs down
 * at their foot. A row of pills below adds sample toasts, and Clear all sweeps
 * them away one after another. Reduced motion keeps the states without the
 * movement.
 *
 * Engine: motion/react (springs for the stack positions and heights, drag with
 * transforms for the swipe, AnimatePresence for enter and exit, a motion value
 * for each timer line).
 */

export type ToastKind = "success" | "warning" | "error" | "info";

export interface ToastItem {
  id?: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** A button in the toast, such as Undo. The toast closes after it runs. */
  action?: { label: string; onClick?: () => void };
  /** Milliseconds before it leaves on its own; 0 keeps it. Default: the stack's `duration`. */
  duration?: number;
}

export interface ToastStackHandle {
  /** Add a toast to the front. Returns its id. */
  push: (toast: ToastItem) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export interface ToastStackProps {
  /** Toasts shown at the start, oldest first. They stay until dismissed. */
  initial?: ToastItem[];
  /** Default time on screen for new toasts, in ms; 0 keeps them. Default `6000`. */
  duration?: number;
  /** How many toasts the folded stack shows. Default `3`. */
  visible?: number;
  /** Show the row of sample buttons under the stack. Default `true`. */
  triggers?: boolean;
  /** Called when a toast leaves, for any reason. */
  onDismiss?: (toast: ToastItem & { id: string }) => void;
  className?: string;
}

type Live = ToastItem & { id: string; duration: number };

const SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 34,
  mass: 0.9,
};
const POP: Transition = { type: "spring", stiffness: 520, damping: 30 };
const PEEK = 12;
const GAP = 10;
const MAX = 6;
const SWIPE = 90;

const KINDS: Record<
  ToastKind,
  {
    color: string;
    label: string;
    Icon: React.ComponentType<{
      className?: string;
      strokeWidth?: number;
      active?: boolean;
    }>;
  }
> = {
  success: { color: "#14FF73", label: "Success", Icon: CircleCheckIcon },
  warning: { color: "#D8FF0A", label: "Warning", Icon: BadgeAlertIcon },
  error: { color: "#F87171", label: "Delete", Icon: DeleteIcon },
  info: { color: "#F4F4F5", label: "Info", Icon: BellIcon },
};

const SAMPLES: Record<ToastKind, ToastItem[]> = {
  success: [
    {
      kind: "success",
      title: "Changes saved",
      description: "Your workspace settings are live.",
    },
    {
      kind: "success",
      title: "Invite sent",
      description: "Priya will get an email in a moment.",
    },
  ],
  warning: [
    {
      kind: "warning",
      title: "Storage almost full",
      description: "You have used 92% of your plan.",
    },
    {
      kind: "warning",
      title: "Card expires soon",
      description: "Update your billing details by Friday.",
    },
  ],
  error: [
    {
      kind: "error",
      title: "Project deleted",
      description: "Moved to trash with 14 files.",
      action: { label: "Undo" },
    },
    {
      kind: "error",
      title: "Member removed",
      description: "Leo no longer has access.",
      action: { label: "Undo" },
    },
  ],
  info: [
    {
      kind: "info",
      title: "New comment",
      description: "Maya replied on Homepage redesign.",
    },
    {
      kind: "info",
      title: "Deploy started",
      description: "Building main, about a minute left.",
    },
  ],
};

const DEFAULT_INITIAL: ToastItem[] = [
  {
    kind: "info",
    title: "New comment",
    description: "Maya replied on Homepage redesign.",
    duration: 0,
  },
  {
    kind: "warning",
    title: "Storage almost full",
    description: "You have used 92% of your plan.",
    duration: 0,
  },
  {
    kind: "success",
    title: "Changes saved",
    description: "Your workspace settings are live.",
    duration: 0,
  },
];

interface ToastProps {
  toast: Live;
  index: number;
  count: number;
  open: boolean;
  visible: number;
  y: number;
  height: number | undefined;
  frontHeight: number;
  still: boolean;
  paused: boolean;
  onMeasure: (id: string, h: number) => void;
  onDismiss: (id: string) => void;
  onDrag: (dragging: boolean) => void;
}

function Toast({
  toast,
  index,
  count,
  open,
  visible,
  y,
  height,
  frontHeight,
  still,
  paused,
  onMeasure,
  onDismiss,
  onDrag,
}: ToastProps) {
  const inner = React.useRef<HTMLDivElement>(null);
  const kind = KINDS[toast.kind];
  const front = index === 0;
  const shown = open || index < visible;
  const folded = !open && !front;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-7, 7]);
  const fade = useTransform(
    x,
    [-240, -SWIPE, 0, SWIPE, 240],
    [0, 0.65, 1, 0.65, 0],
  );
  const left = useMotionValue(1);
  const [gone, setGone] = React.useState(false);
  const [play, setPlay] = React.useState(true);

  // Report the natural height, so the stack can lay out and fold to the front one.
  React.useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    onMeasure(toast.id, el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => onMeasure(toast.id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [toast.id, onMeasure]);

  // The icon plays once as the toast arrives.
  React.useEffect(() => {
    const t = window.setTimeout(() => setPlay(false), 1100);
    return () => window.clearTimeout(t);
  }, []);

  // The timer runs down unless the stack is open or a toast is being dragged.
  React.useEffect(() => {
    if (!toast.duration || paused || gone) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = left.get() - (now - last) / toast.duration;
      last = now;
      if (next <= 0) {
        left.set(0);
        onDismiss(toast.id);
        return;
      }
      left.set(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [toast.duration, toast.id, paused, gone, left, onDismiss]);

  React.useEffect(() => {
    if (gone) onDismiss(toast.id);
  }, [gone, toast.id, onDismiss]);

  const fling = (dir: number) => {
    void animate(
      x,
      dir * 460,
      still
        ? { duration: 0 }
        : { type: "spring", stiffness: 260, damping: 30, velocity: dir * 900 },
    ).then(() => setGone(true));
  };

  return (
    <motion.li
      layout={false}
      initial={
        still
          ? { opacity: 0 }
          : { opacity: 0, y: y + 48, scale: 0.9, filter: "blur(6px)" }
      }
      animate={{
        opacity: shown ? 1 : 0,
        y,
        scale: open ? 1 : 1 - index * 0.05,
        filter: "blur(0px)",
        height: folded ? frontHeight : (height ?? "auto"),
      }}
      exit={
        gone
          ? { opacity: 0, transition: { duration: 0 } }
          : still
            ? { opacity: 0 }
            : {
                opacity: 0,
                scale: 0.92,
                y: y + 10,
                filter: "blur(4px)",
                transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
              }
      }
      transition={still ? { duration: 0 } : SPRING}
      style={{
        zIndex: count - index,
        transformOrigin: "50% 0%",
        pointerEvents: shown ? "auto" : "none",
      }}
      className="absolute inset-x-0 bottom-0 list-none"
    >
      <motion.div
        role="status"
        tabIndex={front || open ? 0 : -1}
        aria-label={`${kind.label}: ${toast.title}`}
        drag={front || open ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        dragSnapToOrigin={false}
        onDragStart={() => onDrag(true)}
        onDragEnd={(_, info) => {
          onDrag(false);
          const far =
            Math.abs(info.offset.x) > SWIPE || Math.abs(info.velocity.x) > 600;
          if (far) fling(Math.sign(info.offset.x || info.velocity.x) || 1);
          else void animate(x, 0, POP);
        }}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onDismiss(toast.id);
          }
        }}
        style={{ x, rotate, opacity: fade }}
        className={cn(
          "group relative h-full cursor-grab touch-pan-y overflow-hidden rounded-[22px] border border-[#27272A] bg-[#111111] text-[#F4F4F5] outline-none active:cursor-grabbing",
          "shadow-[0_12px_32px_-12px_rgba(0,0,0,0.85)]",
          "focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
        )}
      >
        <motion.div
          ref={inner}
          animate={{ opacity: folded ? 0 : 1 }}
          transition={{ duration: still ? 0 : 0.2 }}
          className="flex items-start gap-3 p-3.5 pr-11"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ backgroundColor: `${kind.color}1F`, color: kind.color }}
          >
            <kind.Icon
              className="size-[18px]"
              strokeWidth={2}
              active={play && !still ? true : undefined}
            />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-semibold leading-5 tracking-tight text-[#F4F4F5]">
              {toast.title}
            </p>
            {toast.description && (
              <p className="mt-0.5 text-sm leading-5 text-[#A1A1AA]">
                {toast.description}
              </p>
            )}
            {toast.action && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  toast.action!.onClick?.();
                  onDismiss(toast.id);
                }}
                className="mt-2.5 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[#27272A] bg-[#18181B] px-3 text-sm font-medium text-[#F4F4F5] outline-none transition-colors hover:bg-[#27272A] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
              >
                <UndoIcon className="size-3.5" strokeWidth={2.25} />
                {toast.action.label}
              </button>
            )}
          </div>
        </motion.div>

        {/* Close: fades in on hover or focus. */}
        <button
          type="button"
          aria-label="Dismiss"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDismiss(toast.id)}
          className="absolute right-2.5 top-2.5 grid size-7 scale-75 cursor-pointer place-items-center rounded-full text-[#71717A] opacity-0 outline-none transition-[opacity,transform,background-color,color] duration-200 hover:bg-[#27272A] hover:text-[#F4F4F5] focus-visible:scale-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
        >
          <XIcon className="size-3.5" strokeWidth={2.25} />
        </button>

        {/* The timer line runs down along the foot. */}
        {toast.duration > 0 && !folded && (
          <motion.span
            aria-hidden
            className="absolute inset-x-4 bottom-0 h-[2px] origin-left rounded-full"
            style={{ scaleX: left, backgroundColor: kind.color, opacity: 0.65 }}
          />
        )}
      </motion.div>
    </motion.li>
  );
}

export const ToastStack = React.forwardRef<ToastStackHandle, ToastStackProps>(
  function ToastStack(
    {
      initial = DEFAULT_INITIAL,
      duration = 6000,
      visible = 3,
      triggers = true,
      onDismiss,
      className,
    },
    ref,
  ) {
    const still = !!useReducedMotion();
    const seq = React.useRef(0);
    const turn = React.useRef<Record<ToastKind, number>>({
      success: 0,
      warning: 0,
      error: 0,
      info: 0,
    });
    const make = React.useCallback(
      (t: ToastItem): Live => ({
        ...t,
        id: t.id ?? `toast-${++seq.current}`,
        duration: t.duration ?? duration,
      }),
      [duration],
    );
    const [toasts, setToasts] = React.useState<Live[]>(() =>
      initial.map((t) => ({ ...make(t), duration: t.duration ?? 0 })),
    );
    const [heights, setHeights] = React.useState<Record<string, number>>({});
    const [hover, setHover] = React.useState(false);
    const [focus, setFocus] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const box = React.useRef<HTMLDivElement>(null);
    const all = React.useRef(toasts);
    all.current = toasts;

    const dismiss = React.useCallback(
      (id: string) => {
        const t = all.current.find((x) => x.id === id);
        if (!t) return;
        setToasts((list) => list.filter((x) => x.id !== id));
        onDismiss?.(t);
      },
      [onDismiss],
    );
    const push = React.useCallback(
      (t: ToastItem) => {
        const live = make(t);
        setToasts((list) => [...list, live].slice(-MAX));
        return live.id;
      },
      [make],
    );
    const clear = React.useCallback(() => {
      if (typeof window === "undefined") return;
      // Front first, one after another.
      const ids = all.current.map((t) => t.id).reverse();
      ids.forEach((id, i) =>
        window.setTimeout(() => dismiss(id), still ? 0 : i * 70),
      );
    }, [dismiss, still]);
    React.useImperativeHandle(ref, () => ({ push, dismiss, clear }), [
      push,
      dismiss,
      clear,
    ]);

    // A drag holds the pointer, so the leave event can be missed; fold once the
    // pointer is seen anywhere outside the stack.
    React.useEffect(() => {
      if (!hover || dragging) return;
      const away = (e: PointerEvent) => {
        if (
          e.pointerType === "mouse" &&
          !box.current?.contains(e.target as Node)
        )
          setHover(false);
      };
      window.addEventListener("pointermove", away);
      return () => window.removeEventListener("pointermove", away);
    }, [hover, dragging]);

    const measure = React.useCallback((id: string, h: number) => {
      setHeights((m) => (m[id] === h ? m : { ...m, [id]: h }));
    }, []);

    const order = [...toasts].reverse(); // front first
    const count = order.length;
    // Dragging pauses the timers but does not fan the stack out under your finger.
    const open = (hover || focus) && count > 1;
    const sized = (id: string) => heights[id] ?? 76;
    const frontHeight = count ? sized(order[0]!.id) : 76;
    const offsets: number[] = [];
    let run = 0;
    order.forEach((t, i) => {
      offsets.push(open ? -run : -PEEK * Math.min(i, visible - 1));
      run += sized(t.id) + GAP;
    });
    const height = !count
      ? 76
      : open
        ? run - GAP
        : frontHeight + PEEK * (Math.min(count, visible) - 1);

    const sample = (kind: ToastKind) => {
      const list = SAMPLES[kind];
      const t = list[turn.current[kind]++ % list.length]!;
      push(
        kind === "error"
          ? {
              ...t,
              duration: Math.max(duration, 8000) || 0,
              action: {
                label: "Undo",
                onClick: () =>
                  window.setTimeout(
                    () =>
                      push({
                        kind: "success",
                        title: "Restored",
                        description: `${t.title.split(" ")[0]} is back where it was.`,
                      }),
                    still ? 0 : 160,
                  ),
              },
            }
          : t,
      );
    };

    return (
      <div
        className={cn(
          "flex w-[380px] max-w-full flex-col items-center gap-6",
          className,
        )}
      >
        <motion.div
          ref={box}
          className="relative w-full"
          animate={{ height }}
          transition={still ? { duration: 0 } : SPRING}
          onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
          onPointerDown={(e) =>
            e.pointerType !== "mouse" && setHover((h) => !h)
          }
          // Only keyboard focus opens it; a click or drag focuses a toast too.
          onFocus={(e) =>
            (e.target as Element).matches(":focus-visible") && setFocus(true)
          }
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setFocus(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setHover(false);
              (document.activeElement as HTMLElement | null)?.blur();
            }
          }}
        >
          <ol
            aria-label="Notifications"
            aria-live="polite"
            className="contents"
          >
            <AnimatePresence initial={false}>
              {order.map((t, i) => (
                <Toast
                  key={t.id}
                  toast={t}
                  index={i}
                  count={count}
                  open={open}
                  visible={visible}
                  y={offsets[i]!}
                  height={heights[t.id]}
                  frontHeight={frontHeight}
                  still={still}
                  paused={open || dragging}
                  onMeasure={measure}
                  onDismiss={dismiss}
                  onDrag={setDragging}
                />
              ))}
            </AnimatePresence>
          </ol>

          {/* Nothing left. */}
          <AnimatePresence>
            {count === 0 && (
              <motion.p
                initial={
                  still
                    ? { opacity: 0 }
                    : { opacity: 0, y: 8, filter: "blur(4px)" }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{
                  duration: 0.4,
                  delay: still ? 0 : 0.2,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute inset-0 flex items-center justify-center gap-2 rounded-[22px] border border-dashed border-[#27272A] bg-[#111111]/60 text-sm text-[#71717A]"
              >
                <CircleCheckIcon
                  className="size-4 text-[#14FF73]"
                  strokeWidth={2}
                  active={!still}
                />
                You are all caught up
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {triggers && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(Object.keys(KINDS) as ToastKind[]).map((k) => (
              <motion.button
                key={k}
                type="button"
                whileTap={still ? undefined : { scale: 0.94 }}
                transition={POP}
                onClick={() => sample(k)}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-[#27272A] bg-[#111111] pl-3 pr-3.5 text-sm font-medium text-[#F4F4F5] outline-none transition-colors hover:bg-[#18181B] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: KINDS[k].color }}
                />
                {KINDS[k].label}
              </motion.button>
            ))}
            <AnimatePresence>
              {count > 1 && (
                <motion.button
                  type="button"
                  onClick={clear}
                  initial={
                    still
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.8, filter: "blur(4px)" }
                  }
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={
                    still
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.8, filter: "blur(4px)" }
                  }
                  transition={POP}
                  className="h-9 cursor-pointer rounded-full px-3 text-sm font-medium text-[#71717A] outline-none transition-colors hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                >
                  Clear all
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  },
);

