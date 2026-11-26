"use client";

/**
 * LiquidTabs, from https://motion-brew.com/components/liquid-tabs
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
import { animate, AnimatePresence, motion, type MotionValue, useAnimation, useInView, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";
import { twMerge } from "tailwind-merge";

// cn(): merges Tailwind classes, later ones win.
/** Merge Tailwind classes, letting later classes win conflicts. */
function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

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

// Animated icon: monitor-check
const MonitorCheckIcon = (() => {
interface MonitorCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MonitorCheckIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" },
      opacity: { duration: 0.4, ease: "easeInOut" },
    },
  },
};

const MonitorCheckIcon = forwardRef<
  MonitorCheckIconHandle,
  MonitorCheckIconProps
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
        <rect height="14" rx="2" width="20" x="2" y="3" />
        <path d="M12 17v4" />
        <path d="M8 21h8" />
        <motion.path
          animate={controls}
          d="m9 10 2 2 4-4"
          initial="normal"
          style={{ transformOrigin: "center" }}
          variants={CHECK_VARIANTS}
        />
      </svg>
    </span>
  );
});

MonitorCheckIcon.displayName = "MonitorCheckIcon";
  return MonitorCheckIcon;
})();

// Animated icon: shield-check
const ShieldCheckIcon = (() => {
interface ShieldCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ShieldCheckIconProps extends React.HTMLAttributes<HTMLSpanElement> {
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

const ShieldCheckIcon = forwardRef<ShieldCheckIconHandle, ShieldCheckIconProps>(
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
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
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

ShieldCheckIcon.displayName = "ShieldCheckIcon";
  return ShieldCheckIcon;
})();

// Animated icon: smartphone-nfc
const SmartphoneNfcIcon = (() => {
interface SmartphoneNfcIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface SmartphoneNfcIconProps extends React.HTMLAttributes<HTMLSpanElement> {
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
    transition: {
      duration: 0.4,
    },
  },
  fadeOut: {
    opacity: 0,
    transition: { duration: 0.3 },
  },
  fadeIn: (i: number) => ({
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 20,
      delay: i * 0.1,
    },
  }),
};

const SmartphoneNfcIcon = forwardRef<
  SmartphoneNfcIconHandle,
  SmartphoneNfcIconProps
>(({ onMouseEnter, onMouseLeave, className, size, active, style, strokeWidth, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: async () => {
        await controls.start("fadeOut");
        controls.start("fadeIn");
      },
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    async (e: React.MouseEvent<HTMLSpanElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        await controls.start("fadeOut");
        controls.start("fadeIn");
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
        <rect height="12" rx="1" width="7" x="2" y="6" />
        <motion.path
          animate={controls}
          custom={0}
          d="M13 8.32a7.43 7.43 0 0 1 0 7.36"
          initial={{ opacity: 1 }}
          variants={PATH_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={1}
          d="M16.46 6.21a11.76 11.76 0 0 1 0 11.58"
          initial={{ opacity: 1 }}
          variants={PATH_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={2}
          d="M19.91 4.1a15.91 15.91 0 0 1 .01 15.8"
          initial={{ opacity: 1 }}
          variants={PATH_VARIANTS}
        />
      </svg>
    </span>
  );
});

SmartphoneNfcIcon.displayName = "SmartphoneNfcIcon";
  return SmartphoneNfcIcon;
})();

// Animated icon: user-check
const UserCheckIcon = (() => {
interface UserCheckIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface UserCheckIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size in px; by default it follows className, like a lucide icon. */
  size?: number;
  /** Play while true; when set, hover no longer drives it. */
  active?: boolean;
  /** Line weight, like a lucide icon's. Default `2`. */
  strokeWidth?: number | string;
}

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" },
      opacity: { duration: 0.4, ease: "easeInOut" },
    },
  },
};

const UserCheckIcon = forwardRef<UserCheckIconHandle, UserCheckIconProps>(
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
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <motion.path
            animate={controls}
            d="M16 11L18 13L22 9"
            initial="normal"
            style={{ transformOrigin: "center" }}
            variants={CHECK_VARIANTS}
          />
        </svg>
      </span>
    );
  }
);

UserCheckIcon.displayName = "UserCheckIcon";
  return UserCheckIcon;
})();

// LiquidTabs

/**
 * LiquidTabs
 *
 * Trigger: press (plus hover, keys and in view). Icon tabs over a white
 * panel. The chosen tab is a white bump that grows out of the panel's top
 * edge, joined to it by soft inward curves, so the tab and the panel read as
 * one piece. Choose another tab and the bump flows there like liquid: its
 * leading edge shoots ahead on a quick spring while the trailing edge follows
 * on a slower one, so the shape stretches into a long blob, its top sags and
 * its curves widen, then it snaps back into a round tab under the new icon.
 * The icon on the bump plays. The content slides in from the side you moved
 * toward through a blur while the panel eases to the new height. The demo is
 * a profile settings screen: a profile with a status picker, notification
 * switches, security with your signed in devices, and usage with a rolling
 * number and growing bars. The arrow keys, Home and End move
 * between tabs. Reduced motion jumps the bump and swaps content without
 * movement.
 *
 * Engine: motion/react (two springs for the bump's edges feeding one SVG
 * path, AnimatePresence for the content, a measured height tween) with
 * animated icons from lucide-animated (MIT), vendored in src/icons.
 */

export interface LiquidTab {
  id: string;
  /** Read by screen readers and shown in the tooltip. */
  label: string;
  /** An icon component; animated icons play while their tab is chosen. */
  icon: React.ComponentType<{ active?: boolean; className?: string }>;
  content: React.ReactNode;
}

export interface LiquidTabsProps {
  /** Tabs, left to right. Defaults to four demo tabs. */
  tabs?: LiquidTab[];
  /** Tab chosen first, by id. */
  defaultValue?: string;
  /** Chosen tab (controlled). */
  value?: string;
  onValueChange?: (id: string) => void;
  /** How far the liquid stretches between tabs: 0 is firm, 1 is very stretchy. Default `0.6`. */
  stretch?: number;
  className?: string;
}

const GLIDE = [0.22, 1, 0.36, 1] as const;

// Geometry of the bump and the panel's top edge, in px.
const ROW = 64; // height of the tab row; the panel's top edge sits here
const TOP = 4; // the bump's top, at rest
const PAD = 6; // the bump reaches this far past its tab button on each side
const PANEL_R = 18; // the panel's top corners
const NECK = 18; // the inward curves that join the bump to the panel
const CAP = 40; // the bump's top: as round as its width allows, a half circle at rest

/** The panel's top edge with the bump between `l` and `r`, as an SVG path. */
function edge(lIn: number, rIn: number, w: number, base: number) {
  // The bump never reaches past the panel's own edges.
  const l = Math.max(0, lIn);
  const r = Math.min(w, rIn);
  const width = r - l;
  // Stretching sags the top a little and widens the neck, like a drop pulled thin.
  const pull = Math.max(0, width - base);
  const top = TOP + Math.min(10, pull * 0.07);
  const neck = Math.min(NECK + pull * 0.05, 26);
  const cap = Math.min(CAP, width / 2, ROW - top - neck);
  // Near an edge, the panel's corner and the neck share the room that is left,
  // so a tab at either end meets the side cleanly instead of spilling past it.
  const side = (room: number) => {
    const k = Math.max(0, Math.min(1, room / (PANEL_R + neck)));
    return { corner: PANEL_R * k, neck: neck * k };
  };
  const a = side(l);
  const b = side(w - r);
  const H = ROW;
  return [
    `M0 ${H + PANEL_R}`,
    `L0 ${H + a.corner}`,
    `A${a.corner} ${a.corner} 0 0 1 ${a.corner} ${H}`,
    `L${l - a.neck} ${H}`,
    `A${a.neck} ${a.neck} 0 0 0 ${l} ${H - a.neck}`,
    `L${l} ${top + cap}`,
    `A${cap} ${cap} 0 0 1 ${l + cap} ${top}`,
    `L${r - cap} ${top}`,
    `A${cap} ${cap} 0 0 1 ${r} ${top + cap}`,
    `L${r} ${H - b.neck}`,
    `A${b.neck} ${b.neck} 0 0 0 ${r + b.neck} ${H}`,
    `L${w - b.corner} ${H}`,
    `A${b.corner} ${b.corner} 0 0 1 ${w} ${H + b.corner}`,
    `L${w} ${H + PANEL_R + 1}`,
    `L0 ${H + PANEL_R + 1}`,
    "Z",
  ].join(" ");
}

function Bump({
  l,
  r,
  w,
  base,
}: {
  l: MotionValue<number>;
  r: MotionValue<number>;
  w: number;
  base: number;
}) {
  const d = useTransform([l, r], ([a, b]) =>
    edge(a as number, b as number, w, base),
  );
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={w}
      height={ROW + PANEL_R + 1}
    >
      <motion.path d={d} fill="#111111" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Demo content

const STATUSES = [
  { id: "available", label: "Available", dot: "#14FF73" },
  { id: "focusing", label: "Focusing", dot: "#D8FF0A" },
  { id: "away", label: "Away", dot: "#71717A" },
] as const;

function ProfileDemo() {
  const still = !!useReducedMotion();
  // Scoped ids, so two copies on one page never share a pill.
  const uid = React.useId();
  const [status, setStatus] = React.useState<string>("available");
  const [hover, setHover] = React.useState(false);
  const dot = STATUSES.find((s) => s.id === status)!.dot;
  return (
    <div>
      <div className="flex items-center gap-4 px-1">
        <button
          type="button"
          aria-label="Change photo"
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className="relative grid size-16 shrink-0 cursor-pointer place-items-center rounded-full border border-[#27272A] bg-[#18181B] text-base font-semibold text-[#D8FF0A] outline-none focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111]"
        >
          <span>JL</span>
          <motion.span
            aria-hidden
            className="absolute inset-0 grid place-items-center rounded-full bg-black/65 text-xs font-medium text-[#F4F4F5]"
            animate={{ opacity: hover ? 1 : 0 }}
            transition={{ duration: 0.2 }}
          >
            Edit
          </motion.span>
          <motion.span
            className="absolute bottom-0.5 right-0.5 size-4 rounded-full ring-[3px] ring-[#111111]"
            animate={{ backgroundColor: dot }}
            transition={{ duration: 0.3 }}
          />
        </button>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-lg font-semibold tracking-tight text-[#F4F4F5]">
            Jordan Lee
          </p>
          <p className="mt-0.5 truncate text-sm text-[#A1A1AA]">
            jordan@torveai.com
          </p>
        </div>
      </div>

      <p className="mt-5 px-1 text-xs font-medium text-[#71717A]">Status</p>
      <div
        role="radiogroup"
        aria-label="Status"
        className="mt-2 flex rounded-full border border-[#27272A] bg-[#0A0A0A] p-1"
      >
        {STATUSES.map((s) => {
          const on = s.id === status;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setStatus(s.id)}
              className={cn(
                "relative flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50 max-[360px]:flex-auto max-[360px]:gap-1.5 max-[360px]:px-2",
                on ? "text-[#F4F4F5]" : "text-[#71717A] hover:text-[#F4F4F5]",
              )}
            >
              {on && (
                <motion.span
                  layoutId={`${uid}-status`}
                  className="absolute inset-0 rounded-full border border-[#27272A] bg-[#18181B]"
                  transition={
                    still
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 500, damping: 38 }
                  }
                />
              )}
              <span
                className="relative size-2 rounded-full"
                style={{ background: s.dot }}
              />
              <span className="relative">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SESSIONS = [
  {
    id: "mac",
    icon: MonitorCheckIcon,
    title: "MacBook Pro",
    place: "Lisbon",
    time: "Active now",
    current: true,
  },
  {
    id: "phone",
    icon: SmartphoneNfcIcon,
    title: "iPhone 15",
    place: "Lisbon",
    time: "2h ago",
  },
  {
    id: "ipad",
    icon: MonitorCheckIcon,
    title: "Chrome on Windows",
    place: "Porto",
    time: "3 days ago",
  },
];

function SecurityDemo() {
  const still = !!useReducedMotion();
  const uid = React.useId();
  const [signedOut, setSignedOut] = React.useState<Set<string>>(new Set());
  const [hover, setHover] = React.useState<string | null>(null);
  const others = SESSIONS.filter(
    (x) => !x.current && !signedOut.has(x.id),
  ).length;
  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[#F4F4F5]">
          <ShieldCheckIcon className="size-4 text-[#14FF73]" active />
          Two step sign in is on
        </p>
        <button
          type="button"
          disabled={!others}
          onClick={() =>
            setSignedOut(
              new Set(SESSIONS.filter((x) => !x.current).map((x) => x.id)),
            )
          }
          className="cursor-pointer rounded-full px-2 py-1 text-xs font-medium text-[#A1A1AA] outline-none transition-colors hover:text-[#F4F4F5] disabled:cursor-default disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
        >
          Sign out others
        </button>
      </div>
      <ul onPointerLeave={() => setHover(null)}>
        <AnimatePresence initial={false}>
          {SESSIONS.filter((x) => !signedOut.has(x.id)).map((x, i) => {
            const Icon = x.icon;
            return (
              <motion.li
                key={x.id}
                layout
                initial={still ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{
                  opacity: 0,
                  x: -16,
                  filter: "blur(4px)",
                  transition: { duration: 0.25 },
                }}
                transition={{
                  duration: 0.35,
                  ease: GLIDE,
                  delay: still ? 0 : 0.05 + i * 0.06,
                }}
              >
                <div
                  onPointerEnter={() => setHover(x.id)}
                  className="relative flex w-full items-center gap-3 rounded-xl px-2 py-2"
                >
                  {hover === x.id && (
                    <motion.span
                      layoutId={`${uid}-session`}
                      className="absolute inset-0 rounded-xl bg-[#18181B]"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 40,
                      }}
                    />
                  )}
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-[#27272A] bg-[#18181B] text-[#A1A1AA]">
                    <Icon className="size-4" active={hover === x.id} />
                  </span>
                  <span className="relative min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium text-[#F4F4F5]">
                      {x.title}
                    </span>
                    <span className="block truncate text-xs text-[#71717A]">
                      {x.place}, {x.time}
                    </span>
                  </span>
                  {x.current ? (
                    <span className="relative rounded-full border border-[#14FF73]/25 bg-[#14FF73]/10 px-2 py-0.5 text-xs font-medium text-[#14FF73]">
                      This device
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSignedOut((r) => new Set(r).add(x.id))}
                      className="relative cursor-pointer rounded-full px-2 py-1 text-xs font-medium text-[#A1A1AA] outline-none transition-colors hover:bg-[#27272A] hover:text-[#F87171] focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50"
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}

const BARS = [32, 48, 41, 66, 58, 82, 74];
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function UsageDemo() {
  const still = !!useReducedMotion();
  const count = useMotionValue(still ? 1284 : 0);
  const text = useTransform(count, (v) =>
    Math.round(v).toLocaleString("en-US"),
  );
  const [hover, setHover] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (still) return;
    const run = animate(count, 1284, { duration: 1.1, ease: GLIDE });
    return () => run.stop();
  }, [count, still]);
  return (
    <div>
      <p className="px-1 text-sm text-[#A1A1AA]">Credits used this month</p>
      <div className="mt-1 flex items-baseline gap-2 px-1">
        <motion.span className="text-[32px] font-semibold leading-none tracking-tight text-[#F4F4F5] tabular-nums">
          {text}
        </motion.span>
        <span className="text-sm font-medium text-[#71717A]">
          of 2,000 on Pro
        </span>
      </div>
      <div
        className="mt-5 flex h-24 items-end gap-2"
        onPointerLeave={() => setHover(null)}
      >
        {BARS.map((v, i) => (
          <div
            key={i}
            className="flex flex-1 flex-col items-center gap-1.5"
            onPointerEnter={() => setHover(i)}
          >
            <div className="relative flex h-20 w-full items-end">
              <AnimatePresence>
                {hover === i && (
                  <motion.span
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 2 }}
                    className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border border-[#27272A] bg-[#18181B] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[#F4F4F5]"
                  >
                    {v * 3}
                  </motion.span>
                )}
              </AnimatePresence>
              <motion.span
                className={cn(
                  "w-full origin-bottom rounded-lg transition-colors",
                  hover === i
                    ? "bg-[#D8FF0A]"
                    : i === BARS.length - 2
                      ? "bg-[#14FF73]"
                      : "bg-[#14FF73]/25",
                )}
                style={{ height: `${v}%` }}
                initial={still ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 240,
                  damping: 22,
                  delay: still ? 0 : 0.1 + i * 0.05,
                }}
              />
            </div>
            <span className="text-xs text-[#71717A]">{DAYS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Switch({
  label,
  detail,
  defaultOn,
}: {
  label: string;
  detail: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = React.useState(!!defaultOn);
  const id = React.useId();
  return (
    <div className="flex items-center gap-3 px-1 py-2.5">
      <div className="min-w-0 flex-1 leading-tight">
        <p id={id} className="text-sm font-medium text-[#F4F4F5]">
          {label}
        </p>
        <p className="mt-0.5 text-xs text-[#A1A1AA]">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        onClick={() => setOn((v) => !v)}
        className={cn(
          "relative h-6 w-10 shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111]",
          on ? "bg-[#14FF73]" : "bg-[#27272A]",
        )}
      >
        <motion.span
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
            on ? "bg-[#0A0A0A]" : "bg-[#F4F4F5]",
          )}
          animate={{ x: on ? 16 : 0 }}
          whileTap={{ scaleX: 1.2 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
        />
      </button>
    </div>
  );
}

function NotificationsDemo() {
  return (
    <div className="divide-y divide-[#27272A]">
      <Switch
        label="Mentions and replies"
        detail="When someone tags you or answers you"
        defaultOn
      />
      <Switch
        label="Weekly summary"
        detail="A short email every Monday morning"
        defaultOn
      />
      <Switch
        label="Product news"
        detail="New features, at most once a month"
      />
    </div>
  );
}

const DEFAULT_TABS: LiquidTab[] = [
  {
    id: "profile",
    label: "Profile",
    icon: UserCheckIcon,
    content: <ProfileDemo />,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellIcon,
    content: <NotificationsDemo />,
  },
  {
    id: "security",
    label: "Security",
    icon: ShieldCheckIcon,
    content: <SecurityDemo />,
  },
  { id: "usage", label: "Usage", icon: ChartLineIcon, content: <UsageDemo /> },
];

// ---------------------------------------------------------------------------

export const LiquidTabs = React.forwardRef<HTMLDivElement, LiquidTabsProps>(
  function LiquidTabs(
    {
      tabs = DEFAULT_TABS,
      defaultValue,
      value: valueProp,
      onValueChange,
      stretch = 0.6,
      className,
    },
    ref,
  ) {
    const still = !!useReducedMotion();
    const id = React.useId();
    const root = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => root.current!);
    const frame = React.useRef<HTMLDivElement>(null);
    const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
    const seen = useInView(root, { once: true, amount: 0.3 });

    const [own, setOwn] = React.useState(defaultValue ?? tabs[0]?.id ?? "");
    const value = valueProp ?? own;
    const index = Math.max(
      0,
      tabs.findIndex((t) => t.id === value),
    );
    const [dir, setDir] = React.useState(1);
    const choose = (next: number) => {
      const t = tabs[(next + tabs.length) % tabs.length];
      if (!t || t.id === value) return;
      setDir(next > index ? 1 : -1);
      setOwn(t.id);
      onValueChange?.(t.id);
    };

    // The bump's two edges, each on its own spring.
    const l = useMotionValue(0);
    const r = useMotionValue(0);
    const [width, setWidth] = React.useState(0);
    const [base, setBase] = React.useState(60);
    const placed = React.useRef(false);

    // Layout sizes, not screen rects: a parent that is scaling in would skew those.
    const measure = React.useCallback(() => {
      const box = frame.current;
      const b = buttons.current[index];
      if (!box || !b) return null;
      setWidth(box.offsetWidth);
      setBase(b.offsetWidth + PAD * 2);
      // The tab row is the buttons' offset parent; it is centred in the frame.
      const row = b.offsetParent as HTMLElement | null;
      const left = b.offsetLeft + (row && row !== box ? row.offsetLeft : 0);
      return { l: left - PAD, r: left + b.offsetWidth + PAD };
    }, [index]);

    React.useLayoutEffect(() => {
      const to = measure();
      if (!to) return;
      if (!placed.current || still) {
        l.set(to.l);
        r.set(to.r);
        placed.current = true;
        return;
      }
      // The edge in front leads on a quick spring; the one behind trails on a
      // looser one, so the bump stretches out and then pulls itself together.
      const forward = to.l > l.get();
      // The lead edge overshoots a touch and settles, like a drop landing.
      const lead = { type: "spring" as const, stiffness: 520, damping: 24 };
      const s = Math.min(1, Math.max(0, stretch));
      const trail = {
        type: "spring" as const,
        stiffness: 520 - 330 * s,
        damping: 30 - 10 * s,
        delay: 0.03 + 0.17 * s,
      };
      const a = animate(l, to.l, forward ? trail : lead);
      const b = animate(r, to.r, forward ? lead : trail);
      return () => {
        a.stop();
        b.stop();
      };
    }, [index, measure, still, stretch, l, r]);

    React.useEffect(() => {
      const el = frame.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => {
        const to = measure();
        if (to) {
          l.set(to.l);
          r.set(to.r);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [measure, l, r]);

    // The panel eases to the height of whatever it holds.
    const inner = React.useRef<HTMLDivElement>(null);
    const [height, setHeight] = React.useState<number | "auto">("auto");
    React.useEffect(() => {
      const el = inner.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const onKey = (e: React.KeyboardEvent) => {
      const keys: Record<string, number> = {
        ArrowRight: index + 1,
        ArrowLeft: index - 1,
        Home: 0,
        End: tabs.length - 1,
      };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const next = (keys[e.key]! + tabs.length) % tabs.length;
      choose(next);
      buttons.current[next]?.focus();
    };

    const current = tabs[index];

    return (
      <motion.div
        ref={root}
        initial={still ? false : { opacity: 0, y: 16 }}
        animate={seen || still ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.55, ease: GLIDE }}
        className={cn(
          "w-[380px] max-w-full rounded-[32px] border border-[#27272A] bg-[#18181B] p-2 text-[#F4F4F5]",
          className,
        )}
      >
        <div ref={frame} className="relative">
          {width > 0 && <Bump l={l} r={r} w={width} base={base} />}

          {/* Tab row */}
          <div
            role="tablist"
            aria-label="Sections"
            onKeyDown={onKey}
            className="relative mx-auto flex h-16 items-center justify-between"
            style={{ maxWidth: tabs.length * 44 + (tabs.length - 1) * 24 }}
          >
            {tabs.map((t, i) => {
              const Icon = t.icon;
              const on = i === index;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${t.id}`}
                  aria-selected={on}
                  aria-controls={`${id}-panel`}
                  aria-label={t.label}
                  title={t.label}
                  tabIndex={on ? 0 : -1}
                  onClick={() => choose(i)}
                  className={cn(
                    "group/tab relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-[#D8FF0A]/50",
                    on
                      ? "text-[#D8FF0A]"
                      : "text-[#A1A1AA] hover:text-[#F4F4F5]",
                  )}
                >
                  {/* Idle tabs sit on a soft dark disc that firms up on hover. */}
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full border border-[#27272A] bg-[#111111]/70 transition-colors duration-200 group-hover/tab:bg-[#111111]"
                    animate={{ opacity: on ? 0 : 1, scale: on ? 0.6 : 1 }}
                    transition={{ duration: 0.3, ease: GLIDE }}
                  />
                  <motion.span
                    className="relative grid"
                    animate={{ scale: on ? 1.08 : 1, y: on ? -1 : 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 22,
                      delay: on && !still ? 0.08 : 0,
                    }}
                  >
                    <Icon className="size-5" active={on} />
                  </motion.span>
                </button>
              );
            })}
          </div>

          {/* Panel */}
          <motion.div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={current ? `${id}-tab-${current.id}` : undefined}
            className="relative overflow-hidden rounded-b-[24px] bg-[#111111]"
            style={{ marginTop: PANEL_R }}
            initial={false}
            animate={{ height }}
            transition={
              still ? { duration: 0 } : { duration: 0.4, ease: GLIDE }
            }
          >
            <div ref={inner} className="px-4 pb-5 pt-0">
              <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                <motion.div
                  key={current?.id}
                  custom={dir}
                  variants={{
                    in: (d: number) => ({
                      opacity: 0,
                      x: d * 28,
                      filter: "blur(6px)",
                    }),
                    shown: { opacity: 1, x: 0, filter: "blur(0px)" },
                    out: (d: number) => ({
                      opacity: 0,
                      x: d * -28,
                      filter: "blur(6px)",
                    }),
                  }}
                  initial={still ? false : "in"}
                  animate="shown"
                  exit={still ? undefined : "out"}
                  transition={{ duration: 0.38, ease: GLIDE }}
                >
                  {current?.content}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  },
);

