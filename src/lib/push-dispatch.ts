import { after } from "next/server";
import { processBroadcasts } from "./jobs";
import { processPushQueue, pushConfig } from "./push";

/** Persist first; network delivery must not delay checkout or payment webhooks. */
export function dispatchPushAfterResponse(broadcast = false) {
  if (!pushConfig().configured) return;
  after(async () => {
    try {
      if (broadcast) await processBroadcasts();
      await processPushQueue();
    } catch {
      // Jobs retain their lease/retry state; never log endpoint or subscription keys.
      console.error("Push delivery deferred; durable queue will retry.");
    }
  });
}
