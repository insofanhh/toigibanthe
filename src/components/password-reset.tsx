"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Link } from "./page-motion";
import { Button, Field, Notice } from "./app";
import { post } from "./providers";

function PasswordField({
  name,
  label,
  autoComplete,
  minLength = 10,
}: {
  name: string;
  label: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label}>
      <div className="password-input">
        <input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
    </Field>
  );
}

export function PasswordResetRequest({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      await post("auth/password-reset/request", { email: form.get("email") });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-wrap password-reset-wrap">
      <div className="auth-icon">
        <KeyRound size={28} strokeWidth={1.5} />
      </div>
      <h1>Quên mật khẩu?</h1>
      <p>Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu.</p>
      {done ? (
        <>
          <Notice>
            Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi. Hãy kiểm
            tra cả thư rác.
          </Notice>
          <Button secondary onClick={onBack}>
            Trở về đăng nhập
          </Button>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="Email">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          {error && <Notice error>{error}</Notice>}
          <Button type="submit" disabled={busy}>
            <Mail size={17} /> {busy ? "Đang gửi…" : "Gửi liên kết"}
          </Button>
          <button type="button" className="text-button" onClick={onBack}>
            Trở về đăng nhập
          </button>
        </form>
      )}
    </div>
  );
}

export function PasswordResetPage() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await post("auth/password-reset/confirm", {
        token,
        newPassword: form.get("newPassword"),
        confirmPassword: form.get("confirmPassword"),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-wrap password-reset-wrap">
      <div className="auth-icon">
        <KeyRound size={28} strokeWidth={1.5} />
      </div>
      <h1>Đặt lại mật khẩu</h1>
      {!token ? (
        <Notice error>Liên kết đặt lại mật khẩu không hợp lệ.</Notice>
      ) : done ? (
        <>
          <Notice>Mật khẩu đã được cập nhật. Hãy đăng nhập lại.</Notice>
          <Link href="/login" className="button">
            Đăng nhập
          </Link>
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <PasswordField
            name="newPassword"
            label="Mật khẩu mới"
            autoComplete="new-password"
          />
          <PasswordField
            name="confirmPassword"
            label="Nhập lại mật khẩu mới"
            autoComplete="new-password"
          />
          {error && <Notice error>{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
          </Button>
          <Link href="/login" className="text-button">
            Trở về đăng nhập
          </Link>
        </form>
      )}
    </div>
  );
}

export function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDone(false);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await post(
        "profile/password",
        {
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
          confirmPassword: form.get("confirmPassword"),
        },
        "PATCH",
      );
      event.currentTarget.reset();
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form narrow password-change-section">
      <h2>Đổi mật khẩu</h2>
      <p className="muted">
        Dùng mật khẩu hiện tại để tạo mật khẩu mới. Các thiết bị khác sẽ được
        đăng xuất.
      </p>
      <form className="form" onSubmit={submit}>
        <PasswordField
          name="currentPassword"
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          minLength={1}
        />
        <PasswordField
          name="newPassword"
          label="Mật khẩu mới"
          autoComplete="new-password"
        />
        <PasswordField
          name="confirmPassword"
          label="Nhập lại mật khẩu mới"
          autoComplete="new-password"
        />
        {error && <Notice error>{error}</Notice>}
        {done && (
          <Notice>Đã đổi mật khẩu. Các phiên khác đã được đăng xuất.</Notice>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Đang lưu…" : "Đổi mật khẩu"}
        </Button>
      </form>
    </section>
  );
}
