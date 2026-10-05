/** Explicit frontend origins plus the application's canonical origin. */
export function realtimeOrigins(allowlist = "", siteUrl = "") {
  const origins = new Set<string>();
  for (const value of [...allowlist.split(","), siteUrl]) {
    if (!value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === "https:" || url.protocol === "http:")
        origins.add(url.origin);
    } catch {
      // Invalid entries never broaden access to arbitrary origins.
    }
  }
  return origins;
}
