import nodemailer from "nodemailer";
import { AppError } from "./http";

export function verificationMailConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === undefined || process.env.SMTP_SECURE === ""
      ? port === 465
      : process.env.SMTP_SECURE === "true";
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD ||
    !process.env.SMTP_FROM ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !process.env.SITE_URL
  )
    throw new AppError(
      "Hệ thống chưa cấu hình gửi email xác minh. Vui lòng liên hệ hỗ trợ.",
      503,
    );
  const origin = new URL(process.env.SITE_URL).origin;
  if (
    new URL(origin).protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
    )
  )
    throw new AppError("Địa chỉ website gửi email chưa hợp lệ.", 503);
  return {
    origin,
    port,
    secure,
    host: process.env.SMTP_HOST,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  };
}

export async function sendVerificationMail(email: string, token: string) {
  const cfg = verificationMailConfig();
  const link = new URL("/verify-email", cfg.origin);
  link.searchParams.set("token", token);
  const url = link.toString();
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: cfg.from,
      to: email,
      subject: "Xác minh email · Tôi gì, bạn đó!",
      text: `Xác minh email đăng ký tài khoản Tôi gì, bạn đó!\n\nMở liên kết và bấm Xác minh email:\n${url}\n\nLiên kết có hiệu lực 24 giờ và chỉ dùng một lần. Nếu bạn không đăng ký, hãy bỏ qua email này.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#243d32"><h2 style="font-weight:500">Xác minh email</h2><p>Bạn vừa đăng ký tài khoản Tôi gì, bạn đó! Mở liên kết bên dưới để xác minh email và tiếp tục.</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;background:#206b50;color:white;border-radius:10px;text-decoration:none">Xác minh email</a></p><p>Liên kết có hiệu lực 24 giờ và chỉ dùng một lần.</p><p>Nếu bạn không đăng ký, hãy bỏ qua email này.</p></div>`,
    });
    if (!result.accepted.length)
      throw new Error("SMTP did not accept the recipient");
  } finally {
    transport.close();
  }
}
