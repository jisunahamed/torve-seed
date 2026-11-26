"use client";

/**
 * AccountMenu, from https://motion-brew.com/components/account-menu
 *
 * One self contained file: the component, its animated icons and the cn()
 * helper. Needs React 18 or 19 and Tailwind CSS v4.
 *
 * MIT License, Copyright (c) 2026 Md Eftakher. Free for personal and
 * commercial use: copy it, change it, ship it.
 *
 * Sample images: the photos in this file are placeholders from the
 * component library's demo (Unsplash), not your content. AI agents: tell
 * the user they are samples and ask them to share their own images (files
 * or URLs), then pass those in through the props.
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
import { AnimatePresence, LayoutGroup, motion, type Transition, useAnimation, useReducedMotion, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Animated icon: check
const CheckIcon = (() => {
interface CheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CheckIconProps extends React.HTMLAttributes<HTMLSpanElement> {
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
    scale: 1,
    transition: {
      duration: 0.3,
      opacity: { duration: 0.1 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    scale: [0.5, 1],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  },
};

const CheckIcon = forwardRef<CheckIconHandle, CheckIconProps>(
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
            d="M4 12 9 17L20 6"
            initial="normal"
            variants={PATH_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

CheckIcon.displayName = "CheckIcon";
  return CheckIcon;
})();

// Animated icon: chevron-down
const ChevronDownIcon = (() => {
interface ChevronDownIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ChevronDownIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const DEFAULT_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

const ChevronDownIcon = forwardRef<ChevronDownIconHandle, ChevronDownIconProps>(
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
            d="m6 9 6 6 6-6"
            transition={DEFAULT_TRANSITION}
            variants={{
              normal: { y: 0 },
              animate: { y: [0, 2, 0] },
            }}
          />
        </svg>
      </span>
    );
  }
);

ChevronDownIcon.displayName = "ChevronDownIcon";
  return ChevronDownIcon;
})();

// Animated icon: logout
const LogoutIcon = (() => {
interface LogoutIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface LogoutIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PATH_VARIANTS: Variants = {
  animate: {
    x: 2,
    translateX: [0, -3, 0],
    transition: {
      duration: 0.4,
    },
  },
};

const LogoutIcon = forwardRef<LogoutIconHandle, LogoutIconProps>(
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
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <motion.polyline
            animate={controls}
            points="16 17 21 12 16 7"
            variants={PATH_VARIANTS}
          />
          <motion.line
            animate={controls}
            variants={PATH_VARIANTS}
            x1="21"
            x2="9"
            y1="12"
            y2="12"
          />
        </svg>
      </span>
    );
  }
);

LogoutIcon.displayName = "LogoutIcon";
  return LogoutIcon;
})();

// Animated icon: plus
const PlusIcon = (() => {
interface PlusIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PlusIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PlusIcon = forwardRef<PlusIconHandle, PlusIconProps>(
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
          transition={{ type: "spring", stiffness: 100, damping: 15 }}
          variants={{
            normal: {
              rotate: 0,
            },
            animate: {
              rotate: 180,
            },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </motion.svg>
      </span>
    );
  }
);

PlusIcon.displayName = "PlusIcon";
  return PlusIcon;
})();

// Animated icon: settings
const SettingsIcon = (() => {
interface SettingsIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SettingsIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const SettingsIcon = forwardRef<SettingsIconHandle, SettingsIconProps>(
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
          transition={{ type: "spring", stiffness: 50, damping: 10 }}
          variants={{
            normal: {
              rotate: 0,
            },
            animate: {
              rotate: 180,
            },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </motion.svg>
      </span>
    );
  }
);

SettingsIcon.displayName = "SettingsIcon";
  return SettingsIcon;
})();

// Animated icon: sparkles
const SparklesIcon = (() => {
interface SparklesIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SparklesIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const SPARKLE_VARIANTS: Variants = {
  initial: {
    y: 0,
    fill: "none",
  },
  hover: {
    y: [0, -1, 0, 0],
    fill: "currentColor",
    transition: {
      duration: 1,
      bounce: 0.3,
    },
  },
};

const STAR_VARIANTS: Variants = {
  initial: {
    opacity: 1,
    x: 0,
    y: 0,
  },
  blink: () => ({
    opacity: [0, 1, 0, 0, 0, 0, 1],
    transition: {
      duration: 2,
      type: "spring",
      stiffness: 70,
      damping: 10,
      mass: 0.4,
    },
  }),
};

const SparklesIcon = forwardRef<SparklesIconHandle, SparklesIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size, active, style, strokeWidth, ...props }, ref) => {
    const starControls = useAnimation();
    const sparkleControls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => {
          sparkleControls.start("hover");
          starControls.start("blink", { delay: 1 });
        },
        stopAnimation: () => {
          sparkleControls.start("initial");
          starControls.start("initial");
        },
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          sparkleControls.start("hover");
          starControls.start("blink", { delay: 1 });
        }
      },
      [onMouseEnter, sparkleControls, starControls]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLSpanElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          sparkleControls.start("initial");
          starControls.start("initial");
        }
      },
      [sparkleControls, starControls, onMouseLeave]
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
            animate={sparkleControls}
            d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
            variants={SPARKLE_VARIANTS}
          />
          <motion.path
            animate={starControls}
            d="M20 3v4"
            variants={STAR_VARIANTS}
          />
          <motion.path
            animate={starControls}
            d="M22 5h-4"
            variants={STAR_VARIANTS}
          />
          <motion.path
            animate={starControls}
            d="M4 17v2"
            variants={STAR_VARIANTS}
          />
          <motion.path
            animate={starControls}
            d="M5 18H3"
            variants={STAR_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

SparklesIcon.displayName = "SparklesIcon";
  return SparklesIcon;
})();

// Animated icon: user
const UserIcon = (() => {
interface UserIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UserIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const PATH_VARIANT: Variants = {
  normal: { pathLength: 1, opacity: 1, pathOffset: 0 },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    pathOffset: [1, 0],
  },
};

const CIRCLE_VARIANT: Variants = {
  normal: {
    pathLength: 1,
    pathOffset: 0,
    scale: 1,
  },
  animate: {
    pathLength: [0, 1],
    pathOffset: [1, 0],
    scale: [0.5, 1],
  },
};

const UserIcon = forwardRef<UserIconHandle, UserIconProps>(
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
          <motion.circle
            animate={controls}
            cx="12"
            cy="8"
            r="5"
            variants={CIRCLE_VARIANT}
          />

          <motion.path
            animate={controls}
            d="M20 21a8 8 0 0 0-16 0"
            transition={{
              delay: 0.2,
              duration: 0.4,
            }}
            variants={PATH_VARIANT}
          />
        </svg>
      </span>
    );
  }
);

UserIcon.displayName = "UserIcon";
  return UserIcon;
})();

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

// AccountMenu

/**
 * AccountMenu
 *
 * Trigger: press (plus hover and keys). A profile pill (avatar with a status
 * dot, name and a chevron) that morphs into a full account card when pressed:
 * the pill's outline grows into the card while the avatar and name fly into
 * the header and the rest of the card rises in after them. In the header band
 * a status picker slides a white pill between Online, Focus, Away and Hidden;
 * the avatar's dot changes colour with a pop and a ring pulses out of it, and
 * the line under the name rolls to match. Three quick tiles lift on hover and
 * play their icons. A workspace switcher glides a pill under the pointer and
 * the check flies to the chosen workspace while the header's plan line rolls.
 * A storage meter fills with a spring and a sheen runs across it. Log out asks
 * twice: the first press rolls the label and a red wash fills from the left
 * as a countdown, and the second press signs out. Escape or the chevron folds
 * the card back into the pill. Arrow keys move through the rows. Reduced
 * motion keeps every state without movement.
 *
 * Engine: motion/react (a layout morph between the pill and the card,
 * shared layoutIds for the avatar and name, layoutId pills and checks,
 * staggered entrances and rolling labels) with animated icons from
 * lucide-animated (MIT), vendored in src/icons.
 */

export type AccountStatus = "online" | "focus" | "away" | "hidden";

export interface AccountWorkspace {
  id: string;
  name: string;
  /** A short line under the name, like the plan. */
  plan: string;
  /** Background of the workspace's letter tile. */
  color?: string;
}

export interface AccountMenuProps {
  name?: string;
  /** A short line under the name, like a handle. */
  handle?: string;
  avatar?: string;
  /** Start as the open card instead of the pill. */
  defaultOpen?: boolean;
  defaultStatus?: AccountStatus;
  onStatusChange?: (status: AccountStatus) => void;
  workspaces?: AccountWorkspace[];
  defaultWorkspace?: string;
  onWorkspaceChange?: (id: string) => void;
  /** Section heading for workspaces/routes. Default `"Workspaces"`. */
  workspacesLabel?: string;
  /** Whether to show the "+ New workspace" action. Default `true`. */
  showNewWorkspace?: boolean;
  /** Used and total storage in GB. Default `[6.4, 10]`. Pass `null` to hide the meter. */
  storage?: [number, number] | null;
  onUpgrade?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  onShortcuts?: () => void;
  onNewWorkspace?: () => void;
  onSignOut?: () => void;
  className?: string;
}

const STATUS: Record<
  AccountStatus,
  { label: string; line: string; color: string }
> = {
  online: { label: "Online", line: "Available", color: "#14FF73" },
  focus: { label: "Focus", line: "Notifications paused", color: "#D8FF0A" },
  away: { label: "Away", line: "Back soon", color: "#FBBF24" },
  hidden: { label: "Hidden", line: "Appears offline", color: "#71717A" },
};
const ORDER: AccountStatus[] = ["online", "focus", "away", "hidden"];

const DEFAULT_WORKSPACES: AccountWorkspace[] = [
  {
    id: "torve-cloud",
    name: "Torve Cloud",
    plan: "Direct router · 127.0.0.1:8378",
    color: "#18181B",
  },
  {
    id: "sandbox",
    name: "Local Dev",
    plan: "Free tier · Key active",
    color: "#27272A",
  },
];

const GLIDE = [0.22, 1, 0.36, 1] as const;
const POP: Transition = { type: "spring", stiffness: 520, damping: 30 };
const MORPH: Transition = { type: "spring", stiffness: 340, damping: 32 };
const PILL: Transition = { type: "spring", stiffness: 500, damping: 38 };

const CARD: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.045, delayChildren: 0.12 } },
};
const ITEM: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.42, ease: GLIDE },
  },
};

/** Text that rolls up through a blur when it changes. */
function Roll({
  value,
  still,
  className,
}: {
  value: string;
  still: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-grid overflow-hidden", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="truncate"
          initial={
            still
              ? { opacity: 0 }
              : { opacity: 0, y: "90%", filter: "blur(3px)" }
          }
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={
            still
              ? { opacity: 0 }
              : { opacity: 0, y: "-90%", filter: "blur(3px)" }
          }
          transition={{ duration: 0.3, ease: GLIDE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The avatar with its status dot; a ring pulses out of the dot when it changes. */
function Avatar({
  src,
  name,
  status,
  size,
  layoutId,
  still,
}: {
  src?: string;
  name: string;
  status: AccountStatus;
  size: number;
  layoutId: string;
  still: boolean;
}) {
  const color = STATUS[status].color;
  const dot = Math.round(size * 0.3);
  const initial = (name.trim()[0] || "T").toUpperCase();
  return (
    <motion.span
      layoutId={layoutId}
      transition={still ? { duration: 0 } : MORPH}
      className="relative block shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full rounded-full object-cover ring-1 ring-[#27272A]"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center rounded-full border border-[#27272A] bg-[#18181B] font-semibold text-[#D8FF0A]"
          style={{ fontSize: Math.max(12, Math.round(size * 0.42)) }}
        >
          {initial}
        </span>
      )}
      <span
        className="absolute -bottom-px -right-px grid place-items-center"
        style={{ width: dot, height: dot }}
      >
        <AnimatePresence initial={false}>
          {!still && (
            <motion.span
              key={status}
              aria-hidden
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: 0.7, ease: GLIDE }}
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          )}
        </AnimatePresence>
        <motion.span
          key={`dot-${status}`}
          initial={still ? false : { scale: 0.4 }}
          animate={{ scale: 1, backgroundColor: color }}
          transition={POP}
          className="relative size-full rounded-full ring-2 ring-[#111111]"
        />
      </span>
    </motion.span>
  );
}

export const AccountMenu = React.forwardRef<HTMLDivElement, AccountMenuProps>(
  function AccountMenu(
    {
      name = "Torve User",
      handle = "@torve",
      avatar,
      defaultOpen = false,
      defaultStatus = "online",
      onStatusChange,
      workspaces = DEFAULT_WORKSPACES,
      defaultWorkspace,
      onWorkspaceChange,
      workspacesLabel = "Workspaces",
      showNewWorkspace = true,
      storage = [6.4, 10],
      onUpgrade,
      onProfile,
      onSettings,
      onShortcuts,
      onNewWorkspace,
      onSignOut,
      className,
    },
    ref,
  ) {
    const still = !!useReducedMotion();
    const id = React.useId();
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const pill = React.useRef<HTMLButtonElement>(null);
    const card = React.useRef<HTMLDivElement>(null);
    const [open, setOpen] = React.useState(defaultOpen);
    const [status, setStatus] = React.useState(defaultStatus);
    const [space, setSpace] = React.useState(
      defaultWorkspace ?? workspaces[0]?.id ?? "",
    );
    const [hover, setHover] = React.useState<string | null>(null);
    const [leaving, setLeaving] = React.useState<"ask" | "done" | null>(null);
    const byKeyboard = React.useRef(false);

    // Folding back returns focus to the pill.
    const close = React.useCallback(() => {
      setOpen(false);
      setHover(null);
      setLeaving(null);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => pill.current?.focus({ preventScroll: true }));
      }
    }, []);

    // A keyboard open puts focus on the first control in the card.
    React.useEffect(() => {
      if (typeof window === "undefined" || !open || !byKeyboard.current) return;
      byKeyboard.current = false;
      const t = window.setTimeout(
        () =>
          card.current
            ?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")
            ?.focus(),
        still ? 0 : 260,
      );
      return () => window.clearTimeout(t);
    }, [open, still]);

    // Log out asks twice; the wash counts down, then it asks again from the start.
    React.useEffect(() => {
      if (typeof window === "undefined" || leaving !== "ask") return;
      const t = window.setTimeout(() => setLeaving(null), 2600);
      return () => window.clearTimeout(t);
    }, [leaving]);

    const signOut = () => {
      if (leaving === null) return setLeaving("ask");
      if (leaving === "done") return;
      setLeaving("done");
      onSignOut?.();
      if (typeof window !== "undefined") {
        window.setTimeout(close, still ? 400 : 1100);
      }
    };

    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(
        card.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [],
      );
      if (!items.length) return;
      e.preventDefault();
      const activeEl = typeof document !== "undefined" ? document.activeElement : null;
      const at = items.indexOf(activeEl as HTMLElement);
      const next =
        e.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
      items[at < 0 ? 0 : next]?.focus();
    };

    const glide = (key: string) =>
      hover === key && (
        <motion.span
          layoutId={`${id}-glide`}
          transition={still ? { duration: 0 } : PILL}
          className="absolute inset-0 rounded-2xl border border-[#27272A] bg-[#18181B]"
        />
      );

    const tiles = [
      { key: "profile", label: "Profile", Icon: UserIcon, on: onProfile },
      {
        key: "settings",
        label: "Settings",
        Icon: SettingsIcon,
        on: onSettings,
      },
      {
        key: "shortcuts",
        label: "Shortcuts",
        Icon: ZapIcon,
        on: onShortcuts,
        kbd: "?",
      },
    ];

    const used = storage && storage[1] > 0 ? Math.min(1, Math.max(0, storage[0] / storage[1])) : 0;

    return (
      <div
        ref={root}
        onKeyDown={onKey}
        className={cn(
          // It only takes the pill's room; the card drops over what is below, like a menu.
          "relative h-12 w-[320px] max-w-full",
          className,
        )}
      >
        <div className="absolute inset-x-0 top-0 z-30 flex justify-center">
          <LayoutGroup id={id}>
            <motion.div
              layout
              transition={still ? { duration: 0 } : MORPH}
              style={{ borderRadius: open ? 28 : 999 }}
              className={cn(
                "overflow-hidden border border-[#27272A] bg-[#111111] text-[#F4F4F5]",
                open ? "w-full shadow-[0_16px_40px_rgba(0,0,0,0.65)]" : "w-auto shadow-none",
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {!open ? (
                  /* The pill */
                  <motion.button
                    key="pill"
                    ref={pill}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={false}
                    onClick={(e) => {
                      byKeyboard.current = e.detail === 0;
                      setOpen(true);
                    }}
                    initial={
                      still
                        ? { opacity: 0 }
                        : { opacity: 0, filter: "blur(4px)" }
                    }
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    whileHover={still ? undefined : { scale: 1.02 }}
                    whileTap={still ? undefined : { scale: 0.96 }}
                    transition={{ duration: 0.25 }}
                    className="group flex h-12 cursor-pointer items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 outline-none focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                  >
                    <Avatar
                      src={avatar}
                      name={name}
                      status={status}
                      size={36}
                      layoutId={`${id}-avatar`}
                      still={still}
                    />
                    <motion.span
                      layoutId={`${id}-name`}
                      transition={still ? { duration: 0 } : MORPH}
                      className="text-[14px] font-semibold text-[#F4F4F5]"
                    >
                      {name}
                    </motion.span>
                    <span className="grid text-[#A1A1AA] transition-transform duration-300 group-hover:translate-y-px group-hover:text-[#F4F4F5]">
                      <ChevronDownIcon className="size-4" strokeWidth={2.25} />
                    </span>
                  </motion.button>
                ) : (
                  /* The card */
                  <motion.div
                    key="card"
                    ref={card}
                    role="menu"
                    aria-label={`${name} account`}
                    variants={still ? undefined : CARD}
                    initial="hidden"
                    animate="shown"
                    exit={{
                      opacity: 0,
                      filter: "blur(4px)",
                      transition: { duration: 0.15 },
                    }}
                    onPointerLeave={() => setHover(null)}
                    className="w-[320px] max-w-full p-2"
                  >
                    {/* Header band */}
                    <div className="rounded-[22px] border border-[#27272A] bg-[#18181B] p-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={avatar}
                          name={name}
                          status={status}
                          size={48}
                          layoutId={`${id}-avatar`}
                          still={still}
                        />
                        <div className="min-w-0 flex-1">
                          <motion.p
                            layoutId={`${id}-name`}
                            transition={still ? { duration: 0 } : MORPH}
                            className="w-fit truncate text-[16px] font-semibold leading-6 text-[#F4F4F5]"
                          >
                            {name}
                          </motion.p>
                          <motion.p
                            variants={ITEM}
                            className="flex items-center gap-1.5 text-[12px] leading-4 text-[#A1A1AA]"
                          >
                            <span className="truncate">{handle}</span>
                            <span aria-hidden className="text-[#71717A]">·</span>
                            <Roll value={STATUS[status].line} still={still} />
                          </motion.p>
                        </div>
                        <motion.button
                          variants={ITEM}
                          type="button"
                          aria-label="Collapse menu"
                          onClick={close}
                          whileTap={still ? undefined : { scale: 0.88 }}
                          className="group grid size-8 shrink-0 cursor-pointer place-items-center self-start rounded-full text-[#A1A1AA] outline-none transition-colors hover:bg-[#27272A] hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                        >
                          <span className="grid rotate-180">
                            <ChevronDownIcon
                              className="size-4"
                              strokeWidth={2.25}
                            />
                          </span>
                        </motion.button>
                      </div>

                      {/* Status picker */}
                      <motion.div
                        variants={ITEM}
                        role="radiogroup"
                        aria-label="Status"
                        className="mt-3 grid grid-cols-4 rounded-full border border-[#27272A] bg-[#0A0A0A] p-0.5"
                      >
                        {ORDER.map((s) => {
                          const on = status === s;
                          return (
                            <motion.button
                              key={s}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              data-item=""
                              onClick={() => {
                                setStatus(s);
                                onStatusChange?.(s);
                              }}
                              whileTap={still ? undefined : { scale: 0.92 }}
                              className={cn(
                                "relative flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
                                on
                                  ? "text-[#F4F4F5]"
                                  : "text-[#71717A] hover:text-[#A1A1AA]",
                              )}
                            >
                              {on && (
                                <motion.span
                                  layoutId={`${id}-status`}
                                  transition={still ? { duration: 0 } : PILL}
                                  className="absolute inset-0 rounded-full border border-[#27272A] bg-[#18181B]"
                                />
                              )}
                              <motion.span
                                animate={{ scale: on ? 1.25 : 1 }}
                                transition={POP}
                                className="relative size-1.5 rounded-full"
                                style={{ backgroundColor: STATUS[s].color }}
                              />
                              <span className="relative">
                                {STATUS[s].label}
                              </span>
                            </motion.button>
                          );
                        })}
                      </motion.div>
                    </div>

                    {/* Quick tiles */}
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {tiles.map(({ key, label, Icon, on, kbd }) => (
                        <motion.button
                          key={key}
                          variants={ITEM}
                          type="button"
                          role="menuitem"
                          data-item=""
                          onClick={on}
                          whileHover={still ? undefined : { y: -3 }}
                          whileTap={still ? undefined : { scale: 0.94 }}
                          transition={POP}
                          className="group relative flex h-[76px] cursor-pointer flex-col justify-between rounded-[18px] border border-[#27272A] bg-[#18181B] p-3 text-left text-[#F4F4F5] outline-none transition-colors duration-200 hover:border-[#3F3F46] hover:bg-[#27272A]/80 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                        >
                          <span className="flex items-start justify-between">
                            <Icon className="size-[18px] text-[#A1A1AA] transition-colors group-hover:text-[#D8FF0A]" />
                            {kbd && (
                              <span className="grid h-5 min-w-5 place-items-center rounded-md border border-[#27272A] bg-[#0A0A0A] px-1 text-[12px] font-medium text-[#A1A1AA]">
                                {kbd}
                              </span>
                            )}
                          </span>
                          <span className="text-[12px] font-medium text-[#F4F4F5]">
                            {label}
                          </span>
                        </motion.button>
                      ))}
                    </div>

                    {/* Workspaces / Routes */}
                    <motion.p
                      variants={ITEM}
                      className="px-3 pb-1 pt-3 text-[12px] font-medium text-[#71717A]"
                    >
                      {workspacesLabel}
                    </motion.p>
                    {workspaces.map((w) => {
                      const on = w.id === space;
                      const key = `ws-${w.id}`;
                      return (
                        <motion.button
                          key={w.id}
                          variants={ITEM}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          data-item=""
                          onPointerEnter={() => setHover(key)}
                          onFocus={() => setHover(key)}
                          onClick={() => {
                            setSpace(w.id);
                            onWorkspaceChange?.(w.id);
                          }}
                          whileTap={still ? undefined : { scale: 0.98 }}
                          className="group relative flex h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                        >
                          {glide(key)}
                          <motion.span
                            animate={{
                              rotate: hover === key && !still ? -6 : 0,
                              scale: hover === key && !still ? 1.06 : 1,
                            }}
                            transition={POP}
                            className="relative grid size-8 shrink-0 place-items-center rounded-[10px] border border-[#27272A] text-[14px] font-semibold text-[#D8FF0A]"
                            style={{ backgroundColor: w.color ?? "#18181B" }}
                          >
                            {w.name[0]}
                          </motion.span>
                          <span className="relative min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium leading-5 text-[#F4F4F5]">
                              {w.name}
                            </span>
                            <span className="block truncate text-[12px] leading-4 text-[#A1A1AA]">
                              {w.plan}
                            </span>
                          </span>
                          <span className="relative grid size-6 place-items-center">
                            {on && (
                              <motion.span
                                layoutId={`${id}-ws-check`}
                                transition={still ? { duration: 0 } : POP}
                                className="grid size-6 place-items-center rounded-full bg-[#D8FF0A] text-[#0A0A0A]"
                              >
                                <CheckIcon
                                  className="size-3.5"
                                  strokeWidth={2.75}
                                  active
                                />
                              </motion.span>
                            )}
                          </span>
                        </motion.button>
                      );
                    })}
                    {showNewWorkspace && (
                      <motion.button
                        variants={ITEM}
                        type="button"
                        role="menuitem"
                        data-item=""
                        onPointerEnter={() => setHover("new")}
                        onFocus={() => setHover("new")}
                        onClick={onNewWorkspace}
                        whileTap={still ? undefined : { scale: 0.98 }}
                        className="group relative flex h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-2 text-left text-[14px] font-medium text-[#A1A1AA] outline-none hover:text-[#F4F4F5] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                      >
                        {glide("new")}
                        <span className="relative grid size-8 place-items-center rounded-[10px] border border-dashed border-[#27272A] transition-colors group-hover:border-[#D8FF0A]/50 group-hover:text-[#D8FF0A]">
                          <PlusIcon className="size-4" strokeWidth={2.25} />
                        </span>
                        <span className="relative">New workspace</span>
                      </motion.button>
                    )}

                    {/* Storage */}
                    {storage && (
                      <motion.div
                        variants={ITEM}
                        className="mx-1 mt-2 rounded-[18px] border border-[#27272A] bg-[#18181B] p-3"
                      >
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="font-medium text-[#F4F4F5]">Storage</span>
                          <span className="tabular-nums text-[#A1A1AA]">
                            {storage[0]} of {storage[1]} GB
                          </span>
                        </div>
                        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full border border-[#27272A] bg-[#0A0A0A]">
                          <motion.div
                            initial={still ? false : { width: 0 }}
                            animate={{ width: `${used * 100}%` }}
                            transition={
                              still
                                ? { duration: 0 }
                                : {
                                    type: "spring",
                                    stiffness: 120,
                                    damping: 20,
                                    delay: 0.35,
                                  }
                            }
                            className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-[#14FF73] to-[#D8FF0A]"
                          >
                            {!still && (
                              <motion.span
                                aria-hidden
                                className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                                initial={{ x: "-150%" }}
                                animate={{ x: "600%" }}
                                transition={{
                                  duration: 1.4,
                                  delay: 0.9,
                                  ease: "easeInOut",
                                  repeat: Infinity,
                                  repeatDelay: 2.6,
                                }}
                              />
                            )}
                          </motion.div>
                        </div>
                        <button
                          type="button"
                          data-item=""
                          onClick={onUpgrade}
                          className="group mt-2.5 flex cursor-pointer items-center gap-1.5 rounded-full text-[12px] font-medium text-[#A1A1AA] outline-none transition-colors hover:text-[#D8FF0A] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                        >
                          <SparklesIcon className="size-3.5 text-[#D8FF0A]" />
                          Upgrade for 100 GB
                          <span className="transition-transform duration-300 group-hover:translate-x-0.5">
                            →
                          </span>
                        </button>
                      </motion.div>
                    )}

                    {/* Log out, asked twice */}
                    <motion.div
                      variants={ITEM}
                      aria-hidden
                      className="mx-1 my-2 h-px bg-[#27272A]"
                    />
                    <motion.button
                      variants={ITEM}
                      type="button"
                      role="menuitem"
                      data-item=""
                      onPointerEnter={() => setHover("out")}
                      onFocus={() => setHover("out")}
                      onClick={signOut}
                      whileTap={still ? undefined : { scale: 0.98 }}
                      className={cn(
                        "group relative flex h-11 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl px-3 text-left text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
                        leaving ? "text-[#F87171]" : "text-[#F4F4F5]",
                      )}
                    >
                      {!leaving && glide("out")}
                      <AnimatePresence>
                        {leaving && (
                          <motion.span
                            key="wash"
                            aria-hidden
                            initial={{
                              scaleX: leaving === "done" ? 1 : 0,
                              opacity: 1,
                            }}
                            animate={{ scaleX: 1, opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={
                              leaving === "ask" && !still
                                ? { duration: 2.6, ease: "linear" }
                                : { duration: 0.2 }
                            }
                            style={{ transformOrigin: "0% 50%" }}
                            className="absolute inset-0 rounded-2xl bg-[#EF4444]/15"
                          />
                        )}
                      </AnimatePresence>
                      <span className="relative grid">
                        {leaving === "done" ? (
                          <CheckIcon
                            className="size-[18px] text-[#14FF73]"
                            strokeWidth={2.5}
                            active
                          />
                        ) : (
                          <LogoutIcon
                            className="size-[18px]"
                            active={hover === "out" || leaving === "ask"}
                          />
                        )}
                      </span>
                      <Roll
                        value={
                          leaving === "done"
                            ? "Signed out"
                            : leaving === "ask"
                              ? "Click again to log out"
                              : "Log out"
                        }
                        still={still}
                        className="relative"
                      />
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {leaving === "done"
            ? "Signed out."
            : `Status: ${STATUS[status].label}.`}
        </span>
      </div>
    );
  },
);

