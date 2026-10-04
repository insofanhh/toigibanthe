"use client";

import { useEffect } from "react";

/** Safari may ignore viewport scale limits; cancel its browser zoom gestures. */
export function MobileZoomGuard() {
  useEffect(() => {
    if (
      !navigator.maxTouchPoints &&
      !window.matchMedia("(any-pointer: coarse)").matches
    )
      return;
    const blockGesture = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    const blockPinch = (event: TouchEvent) => {
      if (event.touches.length > 1 && event.cancelable) event.preventDefault();
    };
    const options = { passive: false, capture: true } as const;
    document.addEventListener("gesturestart", blockGesture, options);
    document.addEventListener("gesturechange", blockGesture, options);
    document.addEventListener("touchmove", blockPinch, options);
    return () => {
      document.removeEventListener("gesturestart", blockGesture, options);
      document.removeEventListener("gesturechange", blockGesture, options);
      document.removeEventListener("touchmove", blockPinch, options);
    };
  }, []);
  return null;
}
