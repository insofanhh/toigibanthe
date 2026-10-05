import { readApiResponse } from "./api-response";

export type PushPreferences = {
  orders: boolean;
  news: boolean;
  promotions: boolean;
};
export const defaultPushPreferences: PushPreferences = {
  orders: true,
  news: true,
  promotions: false,
};
const intentKey = "tgbd-push-intent";
let registration: Promise<ServiceWorkerRegistration> | undefined;
let syncQueue: Promise<void> = Promise.resolve();

export function pushSupport() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  return {
    iosNeedsInstall: ios && !standalone,
    supported:
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      typeof PushManager !== "undefined" &&
      typeof Notification !== "undefined",
  };
}
export function registerPushWorker() {
  if (!registration)
    registration = navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .catch((e) => {
        registration = undefined;
        throw e;
      });
  return registration;
}
export async function pushRequest(path: string, body?: unknown) {
  const response = await fetch("/api/push/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return readApiResponse(response);
}
export function readPushIntent(): {
  userId: string;
  preferences: PushPreferences;
} | null {
  try {
    return JSON.parse(localStorage.getItem(intentKey) || "null");
  } catch {
    return null;
  }
}
export function savePushIntent(userId: string, preferences: PushPreferences) {
  localStorage.setItem(intentKey, JSON.stringify({ userId, preferences }));
}
export function clearPushIntent() {
  localStorage.removeItem(intentKey);
}
export async function setPushIdentity(
  reg: ServiceWorkerRegistration,
  userId: string | null,
) {
  const worker = reg.active;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(
        new Error("Không thể kết nối dịch vụ thông báo. Hãy tải lại trang."),
      );
    }, 5000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      e.data?.ok
        ? resolve()
        : reject(new Error("Không thể lưu cài đặt thông báo."));
    };
    worker.postMessage({ type: "push-identity", userId }, [channel.port2]);
  });
}
export function applicationServerKey(value: string) {
  return Uint8Array.from(
    atob(
      value.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (value.length % 4)) % 4),
    ),
    (char) => char.charCodeAt(0),
  );
}
/** Renew an existing opt-in on login; this never asks permission or enables a new device. */
export function syncPushIdentity(userId: string | null) {
  syncQueue = syncQueue
    .catch(() => {})
    .then(async () => {
      if (!pushSupport().supported) return;
      const reg = await registerPushWorker();
      await setPushIdentity(reg, userId);
      const intent = readPushIntent();
      if (!userId || (intent && intent.userId !== userId)) {
        clearPushIntent();
        return;
      }
      if (intent?.userId !== userId || Notification.permission !== "granted")
        return;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription)
        await pushRequest("subscribe", {
          userId,
          subscription: subscription.toJSON(),
          preferences: intent.preferences,
        });
    });
  return syncQueue;
}
export async function clearDevicePush() {
  clearPushIntent();
  if (!pushSupport().supported) return;
  const reg = await registerPushWorker();
  await setPushIdentity(reg, null);
  await (await reg.pushManager.getSubscription())?.unsubscribe();
}
