import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hash } from "bcryptjs";
import mysql from "mysql2";
import { seedDemo } from "./demo-data";

// Export only: no DATABASE_URL, connection, or remote writes are used.
const output = resolve(process.argv[2] || ".local/production-demo.sql");
const credentialsFile = output.replace(/\.sql$/i, "") + ".credentials.txt";
for (const file of [output, credentialsFile]) {
  try {
    await access(file);
  } catch {
    continue;
  }
  throw new Error(
    `File đã tồn tại: ${file}. Chọn tên khác để tạo bộ seed mới.`,
  );
}
const password = randomBytes(24).toString("base64url");
const passwordHash = await hash(password, 12);
const expressions = new Map<string, string>();
function expression(sql: string) {
  const token = `__DEMO_SQL_${expressions.size}__`;
  expressions.set(token, sql);
  return token;
}
const statements = [
  "-- Dữ liệu mẫu dùng thử trên production. Không chứa thông tin ngân hàng.",
  "-- INSERT IGNORE giữ lại dữ liệu đã có; chạy lại không đổi mật khẩu.",
  "-- Thực đơn được tính cho hôm nay theo giờ Việt Nam tại lúc chạy SQL.",
  "USE toigibanthe;",
];
const emails = await seedDemo(
  async (sql, values) => {
    const fragments = sql.split("?");
    if (fragments.length !== values.length + 1)
      throw new Error("Số placeholder không khớp dữ liệu seed.");
    statements.push(
      fragments.reduce((result, fragment, index) => {
        if (!index) return fragment;
        const value = values[index - 1];
        if (
          value !== null &&
          !["string", "number", "boolean"].includes(typeof value)
        )
          throw new Error("Giá trị seed không được hỗ trợ khi xuất SQL.");
        const literal =
          typeof value === "string" ? expressions.get(value) : undefined;
        return (
          result +
          (literal || mysql.escape(value as string | number | boolean | null)) +
          fragment
        );
      }, "") + ";",
    );
  },
  passwordHash,
  {
    now: () => expression("UTC_TIMESTAMP(3)"),
    date: () => expression("DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR))"),
    inDays: (days) =>
      expression(`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${days} DAY)`),
    cutoff: (time, offset) =>
      expression(
        `DATE_SUB(TIMESTAMP(DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)), INTERVAL ${offset} DAY), '${time}:00'), INTERVAL 7 HOUR)`,
      ),
  },
);
statements.push(
  "SELECT email,role FROM users WHERE id IN ('dev-admin','dev-user','dev-chef-1','dev-chef-2','dev-chef-3','dev-chef-4');",
  "SELECT COUNT(*) AS demo_products FROM products WHERE chef_id IN ('chef-1','chef-2','chef-3','chef-4');",
);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  credentialsFile,
  [
    "Tài khoản dữ liệu mẫu production",
    ...emails,
    "",
    `Mật khẩu: ${password}`,
    "",
    "Bếp ở Quận 3, TP.HCM, bán kính 5 km. Mật khẩu khác tài khoản local.",
    "Đây là tài khoản dùng thử, không nhập thông tin ngân hàng thật.",
    "Giữ file này riêng; không commit hoặc gửi lên chat.",
  ].join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
await writeFile(output, statements.join("\n\n") + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(`Đã xuất SQL: ${output}`);
console.log(`Thông tin đăng nhập: ${credentialsFile}`);
