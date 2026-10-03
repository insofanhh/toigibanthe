import { hash } from "bcryptjs";
import { exec, rows, pool, transaction } from "../src/lib/db";
import { seedDemo } from "./demo-data";
if (process.env.NODE_ENV === "production")
  throw new Error("Không seed tài khoản mẫu vào production.");
if (!process.env.SEED_PASSWORD)
  throw new Error("Cần SEED_PASSWORD trong .env.local.");
if ((await rows("SELECT id FROM users LIMIT 1")).length) {
  console.log("Đã có dữ liệu; không ghi đè.");
  await pool().end();
  process.exit(0);
}
const password = await hash(process.env.SEED_PASSWORD, 12);
await transaction(async (db) => {
  await seedDemo((sql, values) => exec(sql, values, db), password);
});
await pool().end();
console.log(
  "Đã seed dữ liệu local. Đăng nhập bằng các email .local và SEED_PASSWORD trong .env.local.",
);
