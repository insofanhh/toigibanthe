"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type InstallEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" } | void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export function usePwaInstall() {
  const event = useRef<InstallEvent | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">(
    "other",
  );
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setPlatform(
      ios ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : "other",
    );
    setEmbedded(/FBAN|FBAV|Instagram|Zalo|; wv\)/i.test(navigator.userAgent));
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () =>
      setInstalled(
        display.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    update();
    const capture = (value: Event) => {
      value.preventDefault();
      event.current = value as InstallEvent;
      setCanPrompt(true);
    };
    const complete = () => {
      event.current = null;
      setCanPrompt(false);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    display.addEventListener("change", update);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
      display.removeEventListener("change", update);
    };
  }, []);
  const prompt = useCallback(async () => {
    const current = event.current;
    if (!current) return "unavailable" as const;
    // A browser install event can be consumed only once.
    event.current = null;
    setCanPrompt(false);
    const result = await current.prompt();
    const outcome = result?.outcome || (await current.userChoice).outcome;
    if (outcome === "accepted") setInstalled(true);
    return outcome;
  }, []);
  return { canPrompt, installed, platform, embedded, prompt };
}
