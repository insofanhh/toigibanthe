"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useApp, post, request } from "./providers";
import { Button, Field, Notice, PageTitle, NeedLogin } from "./app";
import { FilePicker } from "./file-picker";
import { PushSettings } from "./push-settings";
import { UserAvatar } from "./user-avatar";

export function AccountSettings() {
  const { user, refreshAuth, deleteAccount, toast } = useApp();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [avatar, setAvatar] = useState({
    id: user?.avatar_asset_id || null,
    url: user?.avatar_url || null,
  });
  useEffect(() => {
    setAvatarChanged(false);
    setAvatar({
      id: user?.avatar_asset_id || null,
      url: user?.avatar_url || null,
    });
  }, [user?.id, user?.avatar_asset_id, user?.avatar_url]);
  if (!user)
    return deleting ? (
      <div className="loading" role="status">
        Đang trở về trang chủ…
      </div>
    ) : (
      <NeedLogin />
    );
  async function upload(file: File) {
    if (uploading || saving || deleting) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "avatar");
      const result = await request<{ id: string; url: string }>("upload", {
        method: "POST",
        body: form,
      });
      setAvatar({ id: result.id, url: result.url });
      setAvatarChanged(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || uploading || deleting) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await post(
        "profile",
        {
          name: form.get("name"),
          phone: form.get("phone"),
          ...(avatarChanged ? { avatarAssetId: avatar.id } : {}),
        },
        "PATCH",
      );
      await refreshAuth();
      toast("Đã lưu thông tin.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteAccount();
      dialog.current?.close();
      router.replace("/", { transitionTypes: ["page-back"] });
      toast("Đã xóa tài khoản.");
    } catch (error) {
      setDeleteError((error as Error).message);
      setDeleting(false);
    }
  }
  return (
    <>
      <PageTitle title="Cài đặt tài khoản" back />
      <form className="panel form narrow" onSubmit={save}>
        <div className="account-avatar-field">
          <UserAvatar
            name={user.name}
            src={avatar.url}
            className="account-avatar-preview"
          />
          <div>
            <span className="account-field-label">Ảnh đại diện</span>
            <FilePicker
              aria-label="Chọn ảnh đại diện"
              buttonLabel="Chọn ảnh"
              accept="image/jpeg,image/png,image/webp"
              busy={uploading}
              disabled={saving || uploading || deleting}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
            <p className="muted small">
              JPG, PNG hoặc WebP, tối đa 3 MB. Bấm lưu để cập nhật ảnh.
            </p>
            {avatar.url && (
              <button
                type="button"
                className="text-button"
                disabled={saving || uploading || deleting}
                onClick={() => {
                  setAvatar({ id: null, url: null });
                  setAvatarChanged(true);
                }}
              >
                Gỡ ảnh
              </button>
            )}
          </div>
        </div>
        <Field label="Tên hiển thị">
          <input
            name="name"
            defaultValue={user.name}
            required
            minLength={2}
            maxLength={100}
            disabled={saving || deleting}
          />
        </Field>
        <Field label="Số điện thoại">
          <input
            name="phone"
            defaultValue={user.phone}
            inputMode="tel"
            maxLength={30}
            disabled={saving || deleting}
          />
        </Field>
        <Field label="Email">
          <input value={user.email} disabled />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <Button type="submit" disabled={saving || uploading || deleting}>
          {saving ? "Đang lưu…" : "Lưu thông tin"}
        </Button>
      </form>
      <PushSettings />
      <section className="panel account-delete-section narrow">
        <h2>Xóa tài khoản</h2>
        <p>
          Tài khoản sẽ ngừng hoạt động và bạn sẽ được đăng xuất. Lịch sử đơn
          hàng được giữ lại để đối soát.
        </p>
        <Button
          secondary
          className="account-delete-button"
          disabled={saving || uploading || deleting}
          onClick={() => {
            setDeleteError("");
            dialog.current?.showModal();
          }}
        >
          <Trash2 size={17} /> Xóa tài khoản
        </Button>
      </section>
      <dialog
        ref={dialog}
        className="account-delete-dialog"
        aria-labelledby="delete-account-title"
        onCancel={(event) => {
          if (deleting) event.preventDefault();
        }}
      >
        <h2 id="delete-account-title">Xóa tài khoản của bạn?</h2>
        <p>
          Bạn sẽ không thể đăng nhập bằng tài khoản này. Sau khi xóa, hệ thống
          sẽ đưa bạn về trang chủ.
        </p>
        {deleteError && <Notice error>{deleteError}</Notice>}
        <div className="account-delete-actions">
          <Button
            secondary
            disabled={deleting}
            onClick={() => dialog.current?.close()}
          >
            Giữ tài khoản
          </Button>
          <Button
            className="account-delete-confirm"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? "Đang xóa…" : "Xác nhận xóa"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
