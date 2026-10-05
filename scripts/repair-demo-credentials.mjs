import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compare } from "bcryptjs";
import mysql from "mysql2";

// Export a repair file only. Never connects to a database or regenerates credentials.
const source = resolve(process.argv[2] || ".local/admin-chef-db.sql");
const credentials = source.replace(/\.sql$/i, ".credentials.txt");
const output = source.replace(/\.sql$/i, ".password-fix.sql");
const sql = await readFile(source, "utf8");
const credentialText = await readFile(credentials, "utf8");
const password = credentialText.match(/^Mật khẩu dùng chung: (.+)$/m)?.[1].trim();
if (!password) throw new Error("Không tìm được mật khẩu trong file credentials.");

const accounts = [
  ["demo-admin", "admin@toigibando.local"],
  ["demo-chef-user", "chef@toigibando.local"],
];
const statements = [
  "-- Align the two existing demo accounts with the current credentials file.",
  "USE toigibanthe;",
  "START TRANSACTION;",
];
for (const [id, email] of accounts) {
  const insert = sql.split("\n").find((line) =>
    line.startsWith("INSERT IGNORE INTO users ") &&
    line.includes(mysql.escape(id)) && line.includes(mysql.escape(email)),
  );
  const passwordHash = insert?.match(/'\$2[aby]\$[^']+'/)?.[0].slice(1, -1);
  if (!passwordHash || !(await compare(password, passwordHash))) {
    throw new Error(`SQL và credentials không khớp cho ${email}. Không tạo file sửa.`);
  }
  statements.push(
    `UPDATE users SET password_hash=${mysql.escape(passwordHash)} WHERE id=${mysql.escape(id)} AND email=${mysql.escape(email)};`,
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE id=${mysql.escape(id)} AND email=${mysql.escape(email)});`,
  );
}
statements.push(
  "COMMIT;",
  "SELECT id,email,role,active FROM users WHERE id IN ('demo-admin','demo-chef-user');",
);
await writeFile(output, statements.join("\n\n") + "\n", { mode: 0o600 });
console.log("Đã xác minh bcrypt cho cả hai tài khoản với credentials hiện tại.");
console.log(`SQL sửa mật khẩu: ${output}`);
