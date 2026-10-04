"use client";
import {
  createElement,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { animatedNumber } from "@/lib/animated-number";

let motion: MediaQueryList | undefined;
const reducedMotion = () =>
  (motion ||= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;

/** Animate changed values only. Initial data and assistive text always show the actual total. */
export function AnimatedValue({
  children,
  as = "data",
}: {
  children: ReactNode;
  as?: "data" | "tspan";
}) {
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : null;
  const number = useMemo(
    () => (text === null ? null : animatedNumber(text)),
    [text],
  );
  const element = useRef<HTMLElement | SVGElement>(null);
  const displayed = useRef<number | null>(number?.value ?? null);
  const previous = useRef<string | null>(text);
  useLayoutEffect(() => {
    const el = element.current;
    if (!number || !el || text === null) {
      displayed.current = null;
      previous.current = text;
      return;
    }
    const from = displayed.current,
      oldText = previous.current;
    previous.current = text;
    if (from === null || from === number.value || reducedMotion()) {
      el.textContent = text;
      displayed.current = number.value;
      return;
    }
    const direction = number.value > from ? "up" : "down";
    el.dataset.direction = direction;
    // Reserve the larger text width during the transition so cards/buttons do not jitter.
    el.textContent = oldText || text;
    const oldWidth = el.getBoundingClientRect().width;
    el.textContent = text;
    el.style.minInlineSize =
      Math.ceil(Math.max(oldWidth, el.getBoundingClientRect().width)) + "px";
    el.textContent = number.format(from);
    const animation = el.animate?.(
      as === "tspan"
        ? [{ opacity: 0.6 }, { opacity: 1 }]
        : [
            {
              opacity: 0.6,
              transform: `translateY(${direction === "up" ? "4" : "-4"}px)`,
            },
            { opacity: 1, transform: "translateY(0)" },
          ],
      { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = reducedMotion() ? 1 : Math.min(1, (now - start) / 320);
      const current = from + (number.value - from) * (1 - (1 - progress) ** 3);
      displayed.current = current;
      el.textContent = progress === 1 ? text : number.format(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        displayed.current = number.value;
        el.style.minInlineSize = "";
        delete el.dataset.direction;
        animation?.cancel();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      el.style.minInlineSize = "";
      delete el.dataset.direction;
    };
  }, [number, text, as]);
  return number ? (
    createElement(
      as,
      {
        className: "animated-number",
        "aria-label": text!,
        // A data element keeps surrounding label/heatmap span styles out of readouts.
        ...(as === "data" ? { value: String(number.value) } : {}),
        ref: element,
      },
      text,
    )
  ) : (
    <>{children}</>
  );
}
