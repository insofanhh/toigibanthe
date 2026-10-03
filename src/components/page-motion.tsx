"use client";

import { ViewTransition, type ComponentProps, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

const tabs = ["/", "/orders", "/favorites", "/notifications", "/me"];

function direction(from: string, to: string) {
  const currentTab = tabs.indexOf(from);
  const nextTab = tabs.indexOf(to);
  if (currentTab >= 0 && nextTab >= 0)
    return nextTab < currentTab ? "page-back" : "page-forward";
  if (to === "/" || from.startsWith(to + "/")) return "page-back";
  return "page-forward";
}

/** Keep Next.js prefetching and navigation; only tag the motion direction. */
export function Link(props: ComponentProps<typeof NextLink>) {
  const path = usePathname();
  const target =
    typeof props.href === "string"
      ? props.href.split(/[?#]/)[0]
      : props.href.pathname;
  return (
    <NextLink
      {...props}
      transitionTypes={
        props.transitionTypes ?? [direction(path, target || path)]
      }
    />
  );
}

/** React/browser snapshots retain the exiting page without keeping its effects alive. */
export function PageMotion({
  pageKey,
  children,
}: {
  pageKey: string;
  children: ReactNode;
}) {
  const classes = {
    "page-back": "page-slide-back",
    "page-forward": "page-slide-forward",
    default: "page-slide-forward",
  };
  return (
    <ViewTransition key={pageKey} enter={classes} exit={classes} default="none">
      <div className="page-content">{children}</div>
    </ViewTransition>
  );
}
