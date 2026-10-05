import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { exec, sqlDate } from "../src/lib/db";
import type { Actor } from "../src/lib/domain";

// Local fixtures for tests whose subject is not registration/email delivery.
export async function authenticatedFixture(email: string, name: string) {
  assert.ok(
    ["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    ),
  );
  const user: Actor = {
    id: randomUUID(),
    email,
    name,
    phone: "",
    role: "user",
    active: 1,
  };
  const token = randomBytes(32).toString("base64url");
  await exec(
    "INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)",
    [user.id, name, email, "unusable-test-password", sqlDate()],
  );
  await exec("INSERT INTO sessions VALUES (?,?,?)", [
    createHash("sha256").update(token).digest("hex"),
    user.id,
    sqlDate(new Date(Date.now() + 3600000)),
  ]);
  return { user, cookie: "tgbd_session=" + token };
}
