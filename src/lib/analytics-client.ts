import type { Location, MealId } from "./domain";
import type { AnalyticsEventName } from "./analytics-domain";
const recent = new Map<string, number>();
export function analyticsContext() {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem("tgbd-analytics-session");
    let s: { sessionId: string; source: string; last: number } | null = raw
      ? JSON.parse(raw)
      : null;
    const source = new URLSearchParams(window.location.search)
      .get("utm_source")
      ?.trim()
      .slice(0, 100);
    if (!s || Date.now() - s.last > 1800000)
      s = {
        sessionId: crypto.randomUUID(),
        source: source || "",
        last: Date.now(),
      };
    if (source) s.source = source;
    s.last = Date.now();
    sessionStorage.setItem("tgbd-analytics-session", JSON.stringify(s));
    return { sessionId: s.sessionId, source: s.source };
  } catch {
    return undefined;
  }
}
export function trackEvent(
  event: Exclude<AnalyticsEventName, "order_created">,
  location: Location | null,
  options: {
    productId?: string;
    meal?: MealId;
    resultCount?: number;
    dedupe?: string;
    role?: string;
  } = {},
) {
  if (!location || options.role === "admin") return;
  const context = analyticsContext();
  if (!context) return;
  const key = context.sessionId + ":" + event + ":" + (options.dedupe || "");
  if (options.dedupe && Date.now() - (recent.get(key) || 0) < 30000) return;
  if (recent.size > 200) recent.clear();
  recent.set(key, Date.now());
  const body = {
    ...context,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    event,
    lat: location.lat,
    lng: location.lng,
    area: (location as Location & { area?: string }).area || "",
    productId: options.productId,
    meal: options.meal,
    resultCount: options.resultCount,
  };
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
