import nodemailer from "nodemailer";
import { verificationMailConfig } from "../src/lib/verification-mail";

const cfg = verificationMailConfig();
const transport = nodemailer.createTransport({
  host: cfg.host,
  port: cfg.port,
  secure: cfg.secure,
  requireTLS: !cfg.secure,
  auth: { user: cfg.user, pass: cfg.pass },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});
try {
  await transport.verify();
  console.log(
    "SMTP kết nối/xác thực thành công. Chưa gửi email; cần đăng ký thử để kiểm tra From và khả năng nhận thư.",
  );
} catch (error) {
  const code = (error as { code?: string }).code;
  console.error(
    "Không kết nối/xác thực được SMTP:",
    code && /^[A-Z0-9_]+$/.test(code) ? code : "VERIFY_FAILED",
  );
  process.exitCode = 1;
} finally {
  transport.close();
}
