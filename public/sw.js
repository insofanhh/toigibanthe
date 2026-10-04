/* Notifications only: do not cache pages, API responses or authentication state. */
const identityDB = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("tgbd-push", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function identity(value, write = false) {
  const db = await identityDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", write ? "readwrite" : "readonly");
      const request = write
        ? tx.objectStore("settings").put(value, "userId")
        : tx.objectStore("settings").get("userId");
      tx.oncomplete = () => resolve(write ? value : request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const localHref = (href) =>
  typeof href === "string" &&
  href.startsWith("/") &&
  !href.startsWith("//") &&
  !/[\\\u0000-\u001f]/.test(href)
    ? href
    : "/notifications";
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  if (event.data?.type !== "push-identity") return;
  event.waitUntil(
    (async () => {
      try {
        const old = await identity();
        const userId =
          typeof event.data.userId === "string" ? event.data.userId : null;
        await identity(userId, true);
        if (old !== userId || !userId)
          for (const n of await self.registration.getNotifications()) n.close();
        event.ports[0]?.postMessage({ ok: true });
      } catch {
        event.ports[0]?.postMessage({ ok: false });
      }
    })(),
  );
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data?.json() || {};
      } catch {}
      const userId = await identity().catch(() => null);
      const own = userId && userId === payload.userId;
      // Every push is visible (required by Safari); hide private content after account changes.
      await self.registration.showNotification(
        own
          ? String(payload.title || "Thông báo mới").slice(0, 100)
          : "Tôi gì, bạn đó!",
        {
          body: own
            ? String(payload.body || "").slice(0, 240)
            : "Mở ứng dụng để xem thông báo mới.",
          icon: "/icon-192.png",
        badge: "/push-badge.png",
          tag: String(payload.id || "tgbd-new"),
          data: own
            ? {
                id: payload.id,
                userId,
                category: payload.category,
                href: localHref(payload.href),
              }
            : { href: "/notifications" },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const data = event.notification.data || {};
      let href = "/notifications";
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const { user } = await response.json();
        if (user?.id === data.userId && (await identity()) === data.userId) {
          href = String(data.id || "").startsWith("test-")
            ? "/me/settings"
            : "/notifications?tab=" +
              (data.category === "order" ? "order" : "news") +
              "&open=" +
              encodeURIComponent(data.id);
        }
      } catch {}
      const url = new URL(localHref(href), self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows)
        if (
          new URL(client.url).origin === self.location.origin &&
          "focus" in client
        ) {
          await client.navigate(url);
          await client.focus();
          return;
        }
      await self.clients.openWindow(url);
    })(),
  );
});
