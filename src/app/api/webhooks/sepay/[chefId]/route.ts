import { api } from "@/lib/http";
import { receiveSePay } from "@/lib/sepay-webhook";
export const runtime = "nodejs";
// API-key authenticated server webhook; browser session/origin is not authentication here.
export const POST = api(
  async (request, context) => {
    const { chefId } = await (
      context as { params: Promise<{ chefId: string }> }
    ).params;
    return receiveSePay(chefId, request);
  },
  { checkOrigin: false },
);
