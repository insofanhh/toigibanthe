"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ChefHat } from "lucide-react";

const sessionKey = "tgbd-brand-icon";
const delay = 4000;
type BrandState = { main: boolean; animate: boolean };
const BrandContext = createContext<BrandState>({
  main: false,
  animate: false,
});

/** Starts once at app entry, even when the home header is not mounted. */
export function BrandSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrandState>({
    main: false,
    animate: false,
  });
  useEffect(() => {
    let startedAt = Date.now();
    let complete = false;
    try {
      const saved = window.sessionStorage.getItem(sessionKey);
      complete = saved === "done";
      if (saved && !complete && Number.isFinite(Number(saved)))
        startedAt = Number(saved);
      else if (!complete)
        window.sessionStorage.setItem(sessionKey, String(startedAt));
    } catch {
      // The root provider keeps the state during navigation if storage is blocked.
    }
    const remaining = Math.max(0, delay - (Date.now() - startedAt));
    if (complete || remaining === 0) {
      setState({ main: true, animate: false });
      try {
        window.sessionStorage.setItem(sessionKey, "done");
      } catch {}
      return;
    }
    setState({ main: false, animate: false });
    const timer = window.setTimeout(() => {
      setState({ main: true, animate: true });
      try {
        window.sessionStorage.setItem(sessionKey, "done");
      } catch {}
    }, remaining);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <BrandContext.Provider value={state}>{children}</BrandContext.Provider>
  );
}

/** Same bowl and steam paths as public/icon.svg; inherits the surrounding color. */
export function AppIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      className="app-icon"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M29 72h70c-3 20-14 30-35 30S32 92 29 72Z" />
      <path d="M22 72h84M44 54c-9-9 9-14 0-23m20 23c-9-9 9-14 0-23m20 23c-9-9 9-14 0-23" />
    </svg>
  );
}

export function BrandSymbol() {
  const { main, animate } = useContext(BrandContext);
  return (
    <span
      className={`brand-symbol${main ? " is-main" : ""}${animate ? " is-changing" : ""}`}
      aria-hidden="true"
    >
      <span className="brand-symbol-layer brand-symbol-intro">
        <ChefHat size={23} strokeWidth={1.6} />
      </span>
      <span className="brand-symbol-layer brand-symbol-main">
        <AppIcon />
      </span>
    </span>
  );
}
