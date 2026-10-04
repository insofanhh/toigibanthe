const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function setup() {
  const listeners = {},
    shown = [],
    navigations = [],
    settings = new Map();
  let actor = { id: "a" };
  const indexedDB = {
    open() {
      const request = {
        result: {
          createObjectStore() {},
          close() {},
          transaction() {
            const tx = {
              objectStore() {
                return {
                  get(k) {
                    return { result: settings.get(k) };
                  },
                  put(v, k) {
                    settings.set(k, v);
                    return {};
                  },
                };
              },
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const client = {
    url: "https://toigibanthe.vercel.app/orders",
    async navigate(url) {
      navigations.push(url);
      return this;
    },
    async focus() {
      return this;
    },
  };
  const self = {
    location: { origin: "https://toigibanthe.vercel.app" },
    addEventListener: (type, cb) => (listeners[type] = cb),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [client],
      openWindow: async (url) => navigations.push(url),
    },
    registration: {
      getNotifications: async () => shown,
      showNotification: async (title, options) => {
        const old = shown.find((n) => n.tag === options.tag);
        old?.close();
        const notification = {
          title,
          ...options,
          closed: false,
          close() {
            this.closed = true;
          },
        };
        shown.push(notification);
      },
    },
  };
  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), {
    self,
    indexedDB,
    URL,
    encodeURIComponent,
    fetch: async () => ({ json: async () => ({ user: actor }) }),
  });
  async function event(type, data = {}) {
    let pending;
    listeners[type]({ ...data, waitUntil: (p) => (pending = p) });
    await pending;
  }
  return {
    listeners,
    shown,
    navigations,
    event,
    setActor: (v) => (actor = v),
    identity: async (userId) =>
      event("message", {
        data: { type: "push-identity", userId },
        ports: [{ postMessage: () => {} }],
      }),
  };
}
test("worker is notifications-only, visible pushes, private identity and duplicate tag", async () => {
  const w = setup();
  assert.equal(w.listeners.fetch, undefined);
  assert.equal(w.listeners.pushsubscriptionchange, undefined);
  await w.identity("a");
  const payload = {
    id: "n-1",
    userId: "a",
    category: "order",
    title: "Đơn mới",
    body: "Chi tiết riêng",
    href: "/orders/o-1",
  };
  await w.event("push", { data: { json: () => payload } });
  assert.equal(w.shown.at(-1).body, "Chi tiết riêng");
  assert.equal(w.shown.at(-1).icon, "/icon-192.png");
  await w.event("push", { data: { json: () => payload } });
  assert.equal(w.shown.filter((n) => !n.closed).length, 1);
  await w.identity("b");
  assert.ok(w.shown.every((n) => n.closed));
  await w.event("push", { data: { json: () => payload } });
  assert.equal(w.shown.at(-1).title, "Tôi gì, bạn đó!");
  assert.equal(w.shown.at(-1).body, "Mở ứng dụng để xem thông báo mới.");
  await w.identity(null);
  assert.ok(w.shown.every((n) => n.closed));
  await w.event("push", {
    data: {
      json() {
        throw new Error("malformed");
      },
    },
  });
  assert.ok(w.shown.at(-1).title);
});
test("click validates account and opens the right inbox tab before detail/read", async () => {
  const w = setup();
  await w.identity("a");
  await w.event("push", {
    data: {
      json: () => ({
        id: "n-1",
        userId: "a",
        category: "order",
        title: "Đơn",
        href: "https://evil.test/",
      }),
    },
  });
  const n = w.shown.at(-1);
  assert.equal(n.data.href, "/notifications");
  await w.event("notificationclick", { notification: n });
  assert.equal(
    w.navigations.at(-1),
    "https://toigibanthe.vercel.app/notifications?tab=order&open=n-1",
  );
  await w.event("push", {
    data: {
      json: () => ({ id: "n-2", userId: "a", category: "news", title: "Tin" }),
    },
  });
  await w.event("notificationclick", { notification: w.shown.at(-1) });
  assert.ok(w.navigations.at(-1).includes("tab=news&open=n-2"));
  await w.event("push", {
    data: { json: () => ({ id: "test-1", userId: "a", title: "Thử" }) },
  });
  await w.event("notificationclick", { notification: w.shown.at(-1) });
  assert.equal(
    w.navigations.at(-1),
    "https://toigibanthe.vercel.app/me/settings",
  );
  w.setActor({ id: "b" });
  await w.event("notificationclick", { notification: n });
  assert.equal(
    w.navigations.at(-1),
    "https://toigibanthe.vercel.app/notifications",
  );
});
