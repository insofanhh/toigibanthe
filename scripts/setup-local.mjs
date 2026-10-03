import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
const alreadyConfigured = await access(".env.local").then(
  () => true,
  () => false,
);
if (alreadyConfigured)
  throw new Error(
    ".env.local đã tồn tại. Dùng cấu hình hiện có để tránh đổi mật khẩu database.",
  );
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: 3307,
  user: "root",
});
const password = randomBytes(24).toString("hex");
await db.query(
  "CREATE DATABASE IF NOT EXISTS toigibando CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
await db.query(
  "CREATE USER IF NOT EXISTS 'toigibando'@'127.0.0.1' IDENTIFIED BY ?",
  [password],
);
await db.query("ALTER USER 'toigibando'@'127.0.0.1' IDENTIFIED BY ?", [
  password,
]);
await db.query(
  "GRANT ALL PRIVILEGES ON toigibando.* TO 'toigibando'@'127.0.0.1'",
);
await db.end();
await writeFile(
  ".env.local",
  `DATABASE_URL=mysql://toigibando:${password}@127.0.0.1:3307/toigibando\nDATABASE_SSL=false\nSITE_URL=http://127.0.0.1:3000\nAUTH_SECRET=${randomBytes(32).toString("hex")}\nNEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001\nWS_PORT=3001\nWS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000\nCRON_SECRET=${randomBytes(32).toString("hex")}\nSEED_PASSWORD=${randomBytes(12).toString("base64url")}\n`,
);
console.log(
  "Database và cấu hình local đã tạo. Mật khẩu được lưu riêng trong .env.local.",
);
