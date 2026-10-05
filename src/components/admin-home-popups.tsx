"use client";
import { useEffect, useState } from "react";
import { Clock, Eye, Megaphone, Save, Smartphone } from "lucide-react";
import { Button, Field, Notice, useLoad } from "./app";
import { FilePicker } from "./file-picker";
import { HomePopupDialog } from "./home-popups";
import { post, request, useApp } from "./providers";
import {
  defaultHomePopupSettings,
  type HomePopupSettings,
  type PopupKind,
} from "@/lib/home-popup-domain";

function localTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function AdminHomePopups() {
  const { revision, toast, refresh } = useApp();
  const load = useLoad<{ settings: HomePopupSettings }>("admin/home-popups", [
    revision,
  ]);
  const [draft, setDraft] = useState<HomePopupSettings>(
    structuredClone(defaultHomePopupSettings),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PopupKind | null>(null);
  useEffect(() => {
    if (load.data && !dirty) setDraft(load.data.settings);
  }, [load.data, dirty]);
  function edit(next: HomePopupSettings) {
    setDirty(true);
    setDraft(next);
    setError("");
  }
  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", "image");
      const result = await request("upload", { method: "POST", body });
      setDirty(true);
      setDraft((value) => ({
        ...value,
        promotion: { ...value.promotion, imageUrl: result.url },
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await post("admin/home-popups", draft);
      load.setData(result);
      setDraft(result.settings);
      setDirty(false);
      refresh();
      toast("Đã lưu cài đặt popup trang chủ.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!load.data)
    return (
      <section className="panel admin-popup-settings">
        <h2>Popup trang chủ</h2>
        {load.error ? (
          <Notice error>
            {load.error}{" "}
            <button className="text-button" onClick={load.reload}>
              Thử lại
            </button>
          </Notice>
        ) : (
          <p className="muted small">Đang tải cài đặt popup…</p>
        )}
      </section>
    );
  return (
    <>
      <form
        className="panel form admin-popup-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="admin-popup-fields" disabled={busy}>
          <div className="admin-settings-heading">
            <span>
              <Megaphone size={20} />
              <h2>Popup trang chủ</h2>
            </span>
            <small>Mỗi lượt vào Home hiển thị tối đa một popup.</small>
          </div>
          <div className="admin-popup-general">
            <Field label="Tần suất hiển thị">
              <select
                value={draft.frequency}
                onChange={(e) =>
                  edit({
                    ...draft,
                    frequency: e.target.value as HomePopupSettings["frequency"],
                  })
                }
              >
                <option value="session">Một lần mỗi phiên</option>
                <option value="daily">Một lần mỗi ngày</option>
                <option value="weekly">Một lần mỗi 7 ngày</option>
              </select>
            </Field>
            <Field label="Ưu tiên khi cả hai cùng bật">
              <select
                value={draft.priority}
                onChange={(e) =>
                  edit({ ...draft, priority: e.target.value as PopupKind })
                }
              >
                <option value="promotion">Khuyến mãi / sự kiện</option>
                <option value="install">Hướng dẫn cài app</option>
              </select>
            </Field>
            <Field label="Hiện sau (giây)">
              <input
                type="number"
                min="0"
                max="30"
                required
                value={draft.delaySeconds}
                onChange={(e) =>
                  edit({ ...draft, delaySeconds: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="admin-popup-options">
            <section className="admin-popup-option">
              <div className="admin-popup-option-heading">
                <h3>
                  <Smartphone size={18} /> Hướng dẫn cài app
                </h3>
                <label className="admin-popup-toggle">
                  <input
                    type="checkbox"
                    checked={draft.install.enabled}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        install: {
                          ...draft.install,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />{" "}
                  Bật
                </label>
              </div>
              <p className="muted small">
                Hướng dẫn iOS và Android. Tự ẩn khi đang mở app đã cài; chỉ hiển
                thị trên thiết bị di động.
              </p>
              <Field label="Tiêu đề hướng dẫn">
                <input
                  required
                  maxLength={100}
                  value={draft.install.title}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      install: { ...draft.install, title: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Mô tả hướng dẫn">
                <textarea
                  rows={2}
                  maxLength={300}
                  value={draft.install.description}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      install: {
                        ...draft.install,
                        description: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <label className="admin-popup-toggle">
                <input
                  type="checkbox"
                  checked={draft.install.showVideo}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      install: {
                        ...draft.install,
                        showVideo: e.target.checked,
                      },
                    })
                  }
                />{" "}
                Hiển thị video minh họa cài đặt
              </label>
              <Button secondary onClick={() => setPreview("install")}>
                <Eye size={16} /> Xem thử iOS / Android
              </Button>
            </section>
            <section className="admin-popup-option">
              <div className="admin-popup-option-heading">
                <h3>
                  <Megaphone size={18} /> Khuyến mãi / sự kiện
                </h3>
                <label className="admin-popup-toggle">
                  <input
                    type="checkbox"
                    checked={draft.promotion.enabled}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        promotion: {
                          ...draft.promotion,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />{" "}
                  Bật
                </label>
              </div>
              <Field label="Tên chương trình">
                <input
                  required={draft.promotion.enabled}
                  maxLength={100}
                  value={draft.promotion.title}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      promotion: { ...draft.promotion, title: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Nội dung chương trình">
                <textarea
                  rows={2}
                  maxLength={500}
                  value={draft.promotion.description}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      promotion: {
                        ...draft.promotion,
                        description: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Ảnh popup">
                <FilePicker
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Ảnh popup"
                  buttonLabel="Tải ảnh chương trình"
                  busy={uploading}
                  disabled={busy || uploading}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                  }}
                />
              </Field>
              <p className="muted small file-upload-hint">
                JPG, PNG, WebP · Tối đa 3 MB. Ảnh được chuyển sang WebP khi lưu.
              </p>
              {draft.promotion.imageUrl && (
                <div className="admin-popup-image">
                  <img src={draft.promotion.imageUrl} alt="Ảnh popup đã tải" />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      edit({
                        ...draft,
                        promotion: { ...draft.promotion, imageUrl: "" },
                      })
                    }
                  >
                    Bỏ ảnh
                  </button>
                </div>
              )}
              <div className="form-row">
                <Field label="Nội dung nút">
                  <input
                    required
                    maxLength={40}
                    value={draft.promotion.buttonText}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        promotion: {
                          ...draft.promotion,
                          buttonText: e.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Đường dẫn mở khi bấm">
                  <input
                    required
                    maxLength={255}
                    placeholder="/offers"
                    value={draft.promotion.href}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        promotion: { ...draft.promotion, href: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Bắt đầu (không bắt buộc)">
                  <input
                    type="datetime-local"
                    value={localTime(draft.promotion.startsAt)}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        promotion: {
                          ...draft.promotion,
                          startsAt: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="Kết thúc (không bắt buộc)">
                  <input
                    type="datetime-local"
                    value={localTime(draft.promotion.endsAt)}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        promotion: {
                          ...draft.promotion,
                          endsAt: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <Button
                secondary
                disabled={!draft.promotion.imageUrl || uploading}
                onClick={() => setPreview("promotion")}
              >
                <Eye size={16} /> Xem thử popup
              </Button>
            </section>
          </div>
        </fieldset>
        {(error || load.error) && <Notice error>{error || load.error}</Notice>}
        <div className="admin-popup-save">
          <p className="muted small">
            Lưu nội dung mới sẽ cho phép popup xuất hiện lại theo cấu hình trên.
          </p>
          <Button type="submit" disabled={busy || uploading || !dirty}>
            <Save size={16} />
            {busy ? "Đang lưu…" : "Lưu cài đặt popup"}
          </Button>
        </div>
      </form>
      {preview && (
        <HomePopupDialog
          kind={preview}
          settings={draft}
          preview
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

export function MealCutoffSettings({
  meals,
  onSaved,
}: {
  meals: any[];
  onSaved: () => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="panel form admin-meal-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await post("admin/meals", {
            meals: meals.map((m) => ({
              id: m.id,
              cutoff: form.get(`cutoff-${m.id}`),
              dayOffset: Number(form.get(`offset-${m.id}`)),
            })),
          });
          toast("Đã lưu giờ nhận các bữa.");
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="admin-settings-heading">
        <span>
          <Clock size={20} />
          <h2>Giờ hết nhận theo bữa</h2>
        </span>
        <small>Sau mốc này, bữa và các món tự ngừng nhận đơn.</small>
      </div>
      <div className="admin-meal-table">
        <div className="admin-meal-labels" aria-hidden="true">
          <span>Bữa</span>
          <span>Giờ cuối nhận</span>
          <span>Ngày hết nhận</span>
        </div>
        {meals.map((m) => (
          <div className="admin-meal-setting-row" key={m.id}>
            <strong>{m.name}</strong>
            <input
              name={`cutoff-${m.id}`}
              type="time"
              required
              defaultValue={m.cutoff_time}
              aria-label={`Giờ cuối nhận ${m.name}`}
              disabled={busy}
            />
            <select
              name={`offset-${m.id}`}
              defaultValue={m.day_offset}
              aria-label={`Ngày hết nhận ${m.name}`}
              disabled={busy}
            >
              <option value="0">Cùng ngày</option>
              <option value="1">Ngày kế tiếp</option>
            </select>
          </div>
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" disabled={busy}>
        <Save size={16} />
        {busy ? "Đang lưu…" : "Lưu giờ các bữa"}
      </Button>
    </form>
  );
}
