import type { JWTPayload } from "jose";
import { AppError } from "./http";

export function safeLoginNext(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/me";
  const url = new URL(value, "https://app.invalid");
  if (
    url.origin !== "https://app.invalid" ||
    url.pathname.startsWith("//") ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login" ||
    url.pathname === "/verify-email"
  )
    return "/me";
  return url.pathname + url.search + url.hash;
}

export function googleProfile(
  payload: JWTPayload,
  nonce: string,
  clientId: string,
) {
  if (
    payload.nonce !== nonce ||
    (payload.azp && payload.azp !== clientId) ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 255 ||
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    payload.email.length > 190
  ) {
    throw new AppError("Không thể xác minh tài khoản Google.", 401);
  }
  const email = payload.email.toLowerCase();
  return {
    sub: payload.sub,
    email,
    name:
      (typeof payload.name === "string" ? payload.name.trim() : "").slice(
        0,
        100,
      ) || email.split("@")[0],
    authoritativeEmail:
      email.endsWith("@gmail.com") ||
      (typeof payload.hd === "string" && !!payload.hd),
  };
}
