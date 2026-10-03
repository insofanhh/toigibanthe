import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { jwtVerify } from "jose";
import { rows, exec, sqlDate, pool } from "../../src/lib/db";
import { expireOrders } from "../../src/lib/orders";
import { randomUUID } from "node:crypto";
import { processBroadcasts } from "../../src/lib/jobs";
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32)
  throw new Error("AUTH_SECRET phải có ít nhất 32 ký tự.");
const allowed = (process.env.WS_ALLOWED_ORIGINS || "")
  .split(",")
  .filter(Boolean);
if (!allowed.length) throw new Error("Cần WS_ALLOWED_ORIGINS.");
const clients = new Map<
  WebSocket,
  { userId: string; sessionHash: string; alive: boolean }
>();
const serviceId = randomUUID(),
  startedAt = sqlDate();
const http = createServer((req, res) => {
  res.writeHead(req.url?.endsWith("/health") ? 200 : 404, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ ok: req.url?.endsWith("/health") }));
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
http.on("upgrade", async (req, socket, head) => {
  try {
    if (!allowed.includes(req.headers.origin || "")) throw new Error("Origin");
    const url = new URL(req.url || "/", "http://localhost");
    if (!["/socket", "/realtime/socket"].includes(url.pathname))
      throw new Error("Path");
    const token = url.searchParams.get("ticket");
    if (!token) throw new Error("Ticket");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] },
    );
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string")
      throw new Error("Claims");
    const s = (
      await rows(
        "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.active=TRUE",
        [payload.sid, payload.sub, sqlDate()],
      )
    )[0];
    if (!s) throw new Error("Session");
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.set(ws, {
        userId: payload.sub!,
        sessionHash: payload.sid as string,
        alive: true,
      });
      ws.on("pong", () => {
        const c = clients.get(ws);
        if (c) c.alive = true;
      });
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      ws.send(JSON.stringify({ type: "connected" }));
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
  }
});
let busy = false;
const outbox = setInterval(async () => {
  if (busy || !clients.size) return;
  busy = true;
  try {
    const events = await rows<{
      id: string;
      user_id: string;
      payload: unknown;
    }>(
      "SELECT e.id,e.user_id,e.payload FROM realtime_outbox e LEFT JOIN outbox_receipts r ON r.event_id=e.id AND r.service_id=? WHERE r.event_id IS NULL AND e.created_at>=? ORDER BY e.created_at LIMIT 100",
      [serviceId, startedAt],
    );
    for (const e of events) {
      const payload =
        typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload);
      for (const [ws, c] of clients)
        if (c.userId === e.user_id && ws.readyState === WebSocket.OPEN) {
          const valid = await rows(
            "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE",
            [c.sessionHash, sqlDate()],
          );
          if (valid.length) ws.send(payload);
          else ws.close(1008, "Session expired");
        }
      await exec("INSERT IGNORE INTO outbox_receipts VALUES (?,?,?)", [
        serviceId,
        e.id,
        sqlDate(),
      ]);
    }
  } catch (e) {
    console.error("Outbox retry", e instanceof Error ? e.message : "error");
  } finally {
    busy = false;
  }
}, 1000);
const heartbeat = setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) {
      ws.terminate();
      clients.delete(ws);
      continue;
    }
    c.alive = false;
    ws.ping();
  }
}, 30000);
const revalidate = setInterval(async () => {
  for (const [ws, c] of clients) {
    try {
      if (
        !(
          await rows(
            "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=TRUE",
            [c.sessionHash, sqlDate()],
          )
        ).length
      )
        ws.close(1008, "Session expired");
    } catch {
      ws.close(1011, "Session check failed");
    }
  }
}, 60000);
let jobsBusy = false;
const jobs = setInterval(async () => {
  if (jobsBusy) return;
  jobsBusy = true;
  try {
    await expireOrders();
    await processBroadcasts();
  } catch (e) {
    console.error("Job retry", e instanceof Error ? e.message : "error");
  } finally {
    jobsBusy = false;
  }
}, 5000);
if (!process.env.VERCEL)
  http.listen(Number(process.env.WS_PORT || 3001), "0.0.0.0", () =>
    console.log(
      `WebSocket service đang nghe cổng ${process.env.WS_PORT || 3001}.`,
    ),
  );
export default http;
process.on("SIGTERM", async () => {
  clearInterval(outbox);
  clearInterval(heartbeat);
  clearInterval(revalidate);
  clearInterval(jobs);
  for (const ws of clients.keys()) ws.close(1001, "Restart");
  wss.close();
  http.close();
  await pool().end();
  process.exit(0);
});
