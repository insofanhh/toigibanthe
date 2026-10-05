"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, ShieldCheck } from "lucide-react";
import { AppIcon } from "./brand-symbol";
import { useApp, post, request } from "./providers";
import { Button, Notice } from "./app";
import { safeLoginNext } from "@/lib/google-auth-domain";
import { Link } from "./page-motion";

export function PendingVerification({
  email,
  next,
  mailSent,
  mailFailed = false,
  onBack,
}: {
  email: string;
  next: string;
  mailSent: boolean;
  mailFailed?: boolean;
  onBack: () => void;
}) {
  const { refreshAuth } = useApp();
  const router = useRouter();
  const [remaining, setRemaining] = useState(mailSent || mailFailed ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    mailSent
      ? "Đã gửi email xác minh. Kiểm tra hộp thư và thư rác."
      : mailFailed
        ? "Đã tạo tài khoản nhưng chưa gửi được email xác minh. Vui lòng gửi lại sau 60 giây."
        : "Tài khoản đang chờ xác minh. Nếu chưa nhận được email, hãy gửi lại. Mỗi lần gửi cách nhau ít nhất 60 giây.",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await request("auth/me", { signal: controller.signal });
        if (!stopped && data.user?.email === email) {
          await refreshAuth();
          if (!stopped) router.replace(safeLoginNext(next));
        }
      } catch {
        /* Keep the pending screen when offline. */
      }
    }
    const timer = setInterval(check, 5000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [email, next, refreshAuth, router]);
  async function resend() {
    if (busy || remaining) return;
    setBusy(true);
    setError("");
    try {
      const result = await post("auth/verification/resend", { email, next });
      setMessage(result.message);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRemaining(60);
      setBusy(false);
    }
  }
  return (
    <div className="auth-wrap email-verification">
      <div className="auth-icon">
        <Mail size={28} strokeWidth={1.5} />
      </div>
      <h1>Xác minh email</h1>
      <p>
        Mở email gửi đến <strong>{email}</strong>, bấm liên kết xác minh để tiếp
        tục.
      </p>
      <Notice>{message}</Notice>
      {error && <Notice error>{error}</Notice>}
      <Button
        secondary
        onClick={() => void resend()}
        disabled={busy || remaining > 0}
      >
        {busy
          ? "Đang gửi…"
          : remaining
            ? `Gửi lại sau ${remaining}s`
            : "Gửi lại email xác minh"}
      </Button>
      <p className="muted small">
        Liên kết có hiệu lực 24 giờ. Tài khoản chưa xác minh chưa thể đăng nhập
        bằng mật khẩu.
      </p>
      <button className="text-button" onClick={onBack}>
        Trở về đăng nhập
      </button>
    </div>
  );
}

export function EmailVerification() {
  const params = useSearchParams();
  const [token] = useState(() => params.get("token") || "");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const { refreshAuth } = useApp();
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    // Remove the bearer token from browser history once captured. No token is stored in localStorage.
    window.history.replaceState(window.history.state, "", "/verify-email");
    request("auth/verification/info", {
      method: "POST",
      body: JSON.stringify({ token }),
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setEmail(data.email);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);
  async function confirm() {
    if (busy || done) return;
    setBusy(true);
    setError("");
    try {
      const result = await post("auth/verification/confirm", { token });
      setDone(true);
      await refreshAuth();
      router.replace(safeLoginNext(result.next));
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="main">
      <div className="auth-wrap email-verification">
        <div className="auth-icon">
          <AppIcon />
        </div>
        <h1>{done ? "Email đã được xác minh" : "Xác minh email"}</h1>
        {loading ? (
          <p role="status">Đang kiểm tra liên kết…</p>
        ) : (
          <>
            {email && (
              <p>
                Xác minh <strong>{email}</strong> để đăng nhập và tiếp tục.
              </p>
            )}
            {error && <Notice error>{error}</Notice>}
            {done ? (
              <Notice>
                Đã xác minh thành công. Đang chuyển tới trang của bạn…
              </Notice>
            ) : (
              email && (
                <Button onClick={() => void confirm()} disabled={busy}>
                  <ShieldCheck size={18} />{" "}
                  {busy ? "Đang xác minh…" : "Xác minh email"}
                </Button>
              )
            )}
            <Link className="text-button" href="/login">
              Trở về đăng nhập / gửi lại email
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
