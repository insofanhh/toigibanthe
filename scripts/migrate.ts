import mysql from "mysql2/promise";
import { readFile, readdir } from "node:fs/promises";
const url = new URL(process.env.DATABASE_URL!);
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
  multipleStatements: true,
});
const name = url.pathname.slice(1);
if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("Tên database không hợp lệ");
await db.query(
  `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await db.query(`USE \`${name}\``);
for (const file of (await readdir(new URL("../database/", import.meta.url)))
  .filter((x) => x.endsWith(".sql"))
  .sort())
  await db.query(
    await readFile(new URL("../database/" + file, import.meta.url), "utf8"),
  );
await db.end();
console.log("MySQL schema đã sẵn sàng.");
