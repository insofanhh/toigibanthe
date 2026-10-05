import assert from "node:assert/strict";
import test from "node:test";
import { realtimeOrigins } from "../src/lib/realtime-config";

test("domain migration keeps the new canonical frontend eligible for WSS", () => {
  const origins = realtimeOrigins(
    "https://toigibando.app",
    "https://www.toigibando.app",
  );
  assert.ok(origins.has("https://www.toigibando.app"));
  assert.ok(origins.has("https://toigibando.app"));
  assert.equal(origins.has("https://untrusted.example"), false);
});

test("normalizes comma-separated origins without allowing invalid schemes", () => {
  const origins = realtimeOrigins(
    " https://www.toigibando.app/ , http://127.0.0.1:3000,*,file:///tmp,garbage",
    "https://www.toigibando.app/",
  );
  assert.deepEqual([...origins], [
    "https://www.toigibando.app",
    "http://127.0.0.1:3000",
  ]);
  assert.equal(realtimeOrigins("*", "").size, 0);
});
