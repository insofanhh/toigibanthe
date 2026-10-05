import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { exec, sqlDate } from "./db";
import { analyticsLive } from "./admin-events";
import { registrationCreated } from "./admin-registration-alerts";

// Account creation and the dashboard event commit together for both login methods.
export async function createAccount(
  db: PoolConnection,
  name: string,
  email: string,
  passwordHash: string,
  verification: "pending" | "google" = "pending",
) {
  const id = randomUUID();
  await exec(
    "INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)",
    [id, name, email.toLowerCase(), passwordHash, sqlDate()],
    db,
  );
  await exec(
    "INSERT INTO user_email_status (user_id,verification_required,verified_at) VALUES (?,?,?)",
    [id, verification === "pending", verification === "google" ? sqlDate() : null],
    db,
  );
  await analyticsLive(db, id);
  await registrationCreated(db, id);
  return id;
}
