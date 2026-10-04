import { api } from "@/lib/http";
import { receiveSePay } from "@/lib/sepay-webhook";
import { dispatchPushAfterResponse } from "@/lib/push-dispatch";
import { ensurePushSchema } from "@/lib/push-schema";
import { pushConfig } from "@/lib/push";
export const runtime = "nodejs";
// API-key authenticated server webhook; browser session/origin is not authentication here.
export const POST = api(
  async (request, context) => {
    if (pushConfig().configured) await ensurePushSchema();
    const { chefId } = await (
      context as { params: Promise<{ chefId: string }> }
    ).params;
    const result = await receiveSePay(chefId, request);
    dispatchPushAfterResponse();
    return result;
  },
  { checkOrigin: false },
);
