import test from "node:test";
import assert from "node:assert/strict";
import {
  ClientLoadCache,
  disabledLoad,
  pendingLoad,
} from "../src/lib/client-load-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("keeps loaded orders visible during refresh and navigation", async () => {
  const cache = new ClientLoadCache();
  const key = "chef:orders";
  const orders = { orders: [{ id: "paid-order" }] };
  await cache.load(key, async () => orders);
  const next = deferred<typeof orders>();
  const refresh = cache.load(key, () => next.promise, true);
  assert.equal(cache.read(key).data, orders);
  assert.equal(cache.read(key).loading, true);
  assert.equal(cache.read("chef:other-order").data, null);
  assert.equal(cache.read(null), disabledLoad);
  next.resolve({ orders: [] });
  await refresh;
  assert.deepEqual(cache.read(key).data, { orders: [] });
});

test("late responses cannot replace a newer request or a different account", async () => {
  const cache = new ClientLoadCache();
  const first = deferred<string>();
  const old = cache.load("user-a:orders", () => first.promise);
  await Promise.resolve();
  await cache.load("user-a:orders", async () => "updated", true);
  first.resolve("old");
  await old;
  assert.equal(cache.read("user-a:orders").data, "updated");
  assert.equal(cache.read("user-b:orders"), pendingLoad);
});

test("session clearing aborts requests and prevents data from reappearing", async () => {
  const cache = new ClientLoadCache();
  const next = deferred<string>();
  let signal: AbortSignal | undefined;
  const loading = cache.load("private", (value) => {
    signal = value;
    return next.promise;
  });
  await Promise.resolve();
  cache.clear();
  assert.equal(signal?.aborted, true);
  next.resolve("private data");
  await loading;
  assert.equal(cache.read("private").data, null);
  assert.equal(new ClientLoadCache().read("private").data, null);
});

test("deduplicates concurrent readers and preserves data on refresh failure", async () => {
  const cache = new ClientLoadCache();
  const next = deferred<string>();
  let count = 0;
  const fetcher = () => {
    count++;
    return next.promise;
  };
  const a = cache.load("orders", fetcher);
  const b = cache.load("orders", fetcher);
  assert.equal(a, b);
  next.resolve("loaded");
  await a;
  assert.equal(count, 1);
  await cache.load(
    "orders",
    async () => {
      throw new Error("network error");
    },
    true,
  );
  assert.equal(cache.read("orders").data, "loaded");
  assert.equal(cache.read("orders").error, "network error");
  assert.equal(cache.read("orders").loading, false);
});

test("evicts unused entries and stops displaying expired cached data", async () => {
  const cache = new ClientLoadCache(120_000, 2);
  const release = cache.subscribe("visible", () => {});
  for (const key of ["visible", "old", "new"]) cache.set(key, key);
  assert.equal(cache.read("visible").data, "visible");
  assert.equal(cache.read("old").data, null);
  release();
  const expired = new ClientLoadCache(-1);
  expired.set("catalog", "yesterday");
  assert.equal(expired.read("catalog"), pendingLoad);
});
