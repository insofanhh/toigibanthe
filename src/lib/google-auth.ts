import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { hash } from "bcryptjs";
import { createSession } from "./auth";
import { exec, rows, sqlDate, transaction } from "./db";
import { AppError } from "./http";
import { googleProfile, safeLoginNext } from "./google-auth-domain";
import type { Actor } from "./domain";
import { createAccount } from "./account-registration";
import { ensureRegistrationAlertSchema } from "./admin-registration-alerts";

const OAUTH_COOKIE = "tgbd_google_oauth";
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
let schemaReady: Promise<void> | null = null;
function ensureSchema() {
  if (!schemaReady)
    schemaReady = exec(`CREATE TABLE IF NOT EXISTS google_identities (
    subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE, created_at DATETIME(3) NOT NULL
  )`)
      .then(() => {})
      .catch((e) => {
        schemaReady = null;
        throw e;
      });
  return schemaReady;
}
export function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.SITE_URL &&
    (process.env.AUTH_SECRET?.length || 0) >= 32
  );
}
function config() {
  if (!googleConfigured())
    throw new AppError("Google chưa được cấu hình.", 503);
  const origin = new URL(process.env.SITE_URL!).origin;
  if (
    !origin.startsWith("https://") &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  )
    throw new AppError("SITE_URL chưa hợp lệ.", 503);
  return {
    origin,
    redirectUri: origin + "/api/auth/google/callback",
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    secret: new TextEncoder().encode(process.env.AUTH_SECRET!),
  };
}
function redirect(url: URL | string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function resolveUser(
  profile: ReturnType<typeof googleProfile>,
  attempt = 0,
): Promise<string> {
  await ensureSchema();
  await ensureRegistrationAlertSchema();
  try {
    return await transaction(async (db) => {
      const linked = (
        await rows<Actor>(
          "SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=? FOR UPDATE",
          [profile.sub],
          db,
        )
      )[0];
      if (linked) {
        if (!linked.active)
          throw new AppError("Tài khoản đã bị tạm ngưng.", 403);
        return linked.id;
      }
      let user = (
        await rows<Actor>(
          "SELECT * FROM users WHERE email=? FOR UPDATE",
          [profile.email],
          db,
        )
      )[0];
      if (user) {
        if (!user.active) throw new AppError("Tài khoản đã bị tạm ngưng.", 403);
        if (!profile.authoritativeEmail)
          throw new AppError(
            "Hãy đăng nhập bằng mật khẩu của tài khoản này.",
            409,
          );
        const existing = (
          await rows<{ subject: string }>(
            "SELECT subject FROM google_identities WHERE user_id=?",
            [user.id],
            db,
          )
        )[0];
        if (existing)
          throw new AppError(
            "Email đã liên kết với tài khoản Google khác.",
            409,
          );
      } else {
        // A generated, unknown password keeps password login unavailable for new Google users.
        const id = await createAccount(
          db,
          profile.name,
          profile.email,
          await hash(randomBytes(32).toString("base64url"), 12),
        );
        user = { id } as Actor;
      }
      await exec(
        "INSERT INTO google_identities (subject,user_id,created_at) VALUES (?,?,?)",
        [profile.sub, user.id, sqlDate()],
        db,
      );
      return user.id;
    });
  } catch (e) {
    if (attempt < 1 && (e as { code?: string }).code === "ER_DUP_ENTRY")
      return resolveUser(profile, attempt + 1);
    throw e;
  }
}

export async function googleAuth(request: Request, action?: string) {
  const url = new URL(request.url);
  if (action === "config") return { configured: googleConfigured() };
  const jar = await cookies();
  try {
    const cfg = config();
    if (!action) {
      // OAuth must start on the canonical host so the state cookie returns to the same host.
      if (url.origin !== cfg.origin)
        return redirect(new URL("/api/auth/google" + url.search, cfg.origin));
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const next = safeLoginNext(url.searchParams.get("next"));
      const cookie = await new SignJWT({ state, nonce, verifier, next })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("tgbd")
        .setAudience("google-oauth")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(cfg.secret);
      jar.set(OAUTH_COOKIE, cookie, {
        httpOnly: true,
        secure: cfg.origin.startsWith("https:"),
        sameSite: "lax",
        path: "/api/auth/google",
        maxAge: 600,
      });
      const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      target.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return redirect(target);
    }
    if (action !== "callback") throw new AppError("Không tìm thấy trang.", 404);
    const signed = jar.get(OAUTH_COOKIE)?.value;
    jar.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    if (!signed) throw new AppError("Phiên đăng nhập Google đã hết hạn.", 401);
    const { payload } = await jwtVerify(signed, cfg.secret, {
      algorithms: ["HS256"],
      issuer: "tgbd",
      audience: "google-oauth",
    });
    if (
      !url.searchParams.get("state") ||
      url.searchParams.get("state") !== payload.state ||
      typeof payload.nonce !== "string" ||
      typeof payload.verifier !== "string"
    )
      throw new AppError("Phiên đăng nhập Google chưa hợp lệ.", 401);
    if (url.searchParams.has("error"))
      return redirect(new URL("/login?google_error=cancelled", cfg.origin));
    const code = url.searchParams.get("code");
    if (!code) throw new AppError("Thiếu mã xác thực Google.", 401);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: payload.verifier,
      }),
    });
    const tokens = await response.json();
    if (!response.ok || typeof tokens.id_token !== "string")
      throw new AppError("Google không thể xác thực phiên này.", 401);
    const verified = await jwtVerify(tokens.id_token, keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: cfg.clientId,
      requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"],
      maxTokenAge: "10m",
    });
    const profile = googleProfile(
      verified.payload,
      payload.nonce,
      cfg.clientId,
    );
    const userId = await resolveUser(profile);
    await createSession(userId);
    return redirect(
      new URL(
        safeLoginNext(typeof payload.next === "string" ? payload.next : null),
        cfg.origin,
      ),
    );
  } catch (error) {
    const reason = !googleConfigured()
      ? "not_configured"
      : error instanceof AppError && error.status === 409
        ? "use_password"
        : error instanceof AppError && error.status === 403
          ? "inactive"
          : "failed";
    // Never expose Google codes, tokens, secrets or database errors in the redirect.
    return redirect(new URL("/login?google_error=" + reason, url.origin));
  }
}
