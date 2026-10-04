"use client";
import { AnimatedValue } from "./animated-value";
import { useRef, useState } from "react";
import { Phone, LoaderCircle } from "lucide-react";
import { post, request, useApp } from "./providers";
import {
  money,
  parseUTC,
  PAYMENT_REQUEST_KINDS,
  PAYMENT_REQUEST_STATUSES,
} from "@/lib/domain";

export type PaymentRequest = {
  id: string;
  kind: string;
  amount: number;
  note: string;
  status: string;
  created_at: string;
  contact_phone: string;
  resolution_note?: string;
  evidence_asset_id?: string;
  evidence_name?: string;
  resolution_type?: string;
  submitted_at?: string;
  review_note?: string;
  reviewed_at?: string;
};

export function PaymentRequestEvidence({ value }: { value: PaymentRequest }) {
  if (!value.evidence_asset_id) return null;
  return (
    <div className="payment-request-evidence">
      <p className="small">
        {value.resolution_type === "REFUNDED"
          ? "Bếp đã hoàn tiền"
          : "Bếp đã giải quyết"}
      </p>
      <p className="payment-request-note">{value.resolution_note}</p>
      <a
        className="text-button"
        href={`/api/files/${value.evidence_asset_id}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Xem bằng chứng: {value.evidence_name || "Tệp đính kèm"}
      </a>
      {value.submitted_at && (
        <p className="muted small">
          Gửi hệ thống:{" "}
          {parseUTC(value.submitted_at).toLocaleString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
          })}
        </p>
      )}
    </div>
  );
}

export function CustomerPaymentRequestForm({
  orderId,
  onChange,
}: {
  orderId: string;
  onChange: () => void;
}) {
  const { user, toast } = useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false);
  const locked = useRef(false);
  if (submitted)
    return (
      <div className="notice">Đã gửi yêu cầu. Vui lòng chờ bếp xử lý.</div>
    );
  return (
    <>
      <button className="text-button" onClick={() => setOpen(!open)}>
        Yêu cầu đối soát / hoàn tiền
      </button>
      {open && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (locked.current) return;
            const f = new FormData(e.currentTarget);
            locked.current = true;
            setBusy(true);
            try {
              await post(`orders/${orderId}/exception`, {
                kind: f.get("kind"),
                amount: Number(f.get("amount")),
                note: f.get("note"),
                phone: f.get("phone"),
              });
              setSubmitted(true);
              toast("Đã gửi yêu cầu cho bếp.");
              onChange();
            } catch (e) {
              toast((e as Error).message);
              onChange();
            } finally {
              locked.current = false;
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Loại yêu cầu</span>
            <select name="kind">
              {Object.entries(PAYMENT_REQUEST_KINDS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Số tiền</span>
            <input
              name="amount"
              type="number"
              min={0}
              max={100000000}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại liên hệ</span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={user?.phone || ""}
              placeholder="Nhập số điện thoại để bếp liên hệ"
              minLength={10}
              maxLength={20}
              required
            />
          </label>
          <label className="field">
            <span>Nội dung yêu cầu</span>
            <textarea
              name="note"
              placeholder="Thông tin giao dịch và đề nghị xử lý"
              minLength={5}
              maxLength={1000}
              required
            />
          </label>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Đang gửi…" : "Gửi yêu cầu"}
          </button>
        </form>
      )}
    </>
  );
}

function ResolutionForm({
  orderId,
  value,
  onChange,
}: {
  orderId: string;
  value: PaymentRequest;
  onChange: () => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false),
    [asset, setAsset] = useState<{ id: string; url: string } | null>(null);
  const locked = useRef(false);
  return (
    <form
      className="form payment-resolution-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (locked.current) return;
        const f = new FormData(e.currentTarget),
          file = f.get("evidence") as File;
        locked.current = true;
        setBusy(true);
        try {
          let proof = asset;
          if (!proof) {
            if (!file?.size) throw new Error("Chọn bằng chứng giải quyết.");
            if (file.size > 3 * 1024 * 1024)
              throw new Error("Bằng chứng tối đa 3 MB.");
            const upload = new FormData();
            upload.set("kind", "document");
            upload.set("file", file);
            proof = await request("upload", { method: "POST", body: upload });
            setAsset(proof);
          }
          await post(`orders/${orderId}/exception-resolution`, {
            requestId: value.id,
            note: f.get("note"),
            resolution: f.get("resolution"),
            evidenceAssetId: proof!.id,
          });
          toast("Đã gửi bằng chứng. Chờ hệ thống duyệt.");
          onChange();
        } catch (e) {
          toast((e as Error).message);
          onChange();
        } finally {
          locked.current = false;
          setBusy(false);
        }
      }}
    >
      <h3>Bằng chứng giải quyết</h3>
      <label className="field">
        <span>Kết quả xử lý</span>
        <select
          name="resolution"
          defaultValue={value.kind === "REFUND" ? "REFUNDED" : "RESOLVED"}
          disabled={busy}
        >
          <option value="RESOLVED">Đã giải quyết đối soát</option>
          <option value="REFUNDED">Đã hoàn tiền cho khách</option>
        </select>
      </label>
      <label className="field">
        <span>Nội dung giải quyết</span>
        <textarea
          name="note"
          minLength={5}
          maxLength={2000}
          placeholder="Thông tin trao đổi với khách và cách bếp đã giải quyết"
          required
          disabled={busy}
        />
      </label>
      <label className="field">
        <span>Bằng chứng (ảnh hoặc PDF, tối đa 3 MB)</span>
        <input
          type="file"
          name="evidence"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required={!asset}
          disabled={busy}
          onChange={() => setAsset(null)}
        />
      </label>
      {asset && (
        <a
          className="text-button"
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Xem tệp đã tải lên
        </a>
      )}
      <button className="button" type="submit" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle size={16} className="spin" /> Đang gửi…
          </>
        ) : (
          "Gửi bằng chứng cho hệ thống"
        )}
      </button>
    </form>
  );
}

export function PaymentRequestList({
  orderId,
  values,
  isChef,
  canResolve,
  onChange,
}: {
  orderId: string;
  values: PaymentRequest[];
  isChef: boolean;
  canResolve: boolean;
  onChange: () => void;
}) {
  return (
    <div className="panel payment-requests">
      <h2>
        {isChef
          ? "Yêu cầu đối soát / hoàn tiền của khách"
          : "Yêu cầu đối soát / hoàn tiền"}
      </h2>
      {!values.length ? (
        <p className="muted small">
          Khách chưa gửi yêu cầu đối soát / hoàn tiền cho đơn này.
        </p>
      ) : (
        values.map((value) => (
          <article className="payment-request" key={value.id}>
            <div className="payment-request-heading">
              <h3>{PAYMENT_REQUEST_KINDS[value.kind] || "Yêu cầu đối soát"}</h3>
              <span className="status" data-status={value.status}>
                {PAYMENT_REQUEST_STATUSES[value.status] || value.status}
              </span>
            </div>
            {!isChef && (
              <p className="muted small">
                {value.status === "OPEN"
                  ? "Đã gửi yêu cầu. Vui lòng chờ bếp xử lý."
                  : value.status === "REVIEW"
                    ? "Bếp đã gửi bằng chứng. Vui lòng chờ hệ thống duyệt."
                    : "Hệ thống đã duyệt giải quyết yêu cầu của bạn."}
              </p>
            )}
            <p className="small">
              Số tiền: <AnimatedValue>{money(value.amount)}</AnimatedValue>
            </p>
            <p className="payment-request-note">{value.note}</p>
            <p className="small">
              Số điện thoại liên hệ: {value.contact_phone || "Chưa có"}
            </p>
            {isChef && value.contact_phone && (
              <a
                className="text-button payment-request-call"
                href={`tel:${value.contact_phone.replace(/[^+0-9]/g, "")}`}
              >
                <Phone size={16} /> Gọi khách
              </a>
            )}
            <time
              className="muted small"
              dateTime={parseUTC(value.created_at).toISOString()}
            >
              {parseUTC(value.created_at).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </time>
            <PaymentRequestEvidence value={value} />
            {value.review_note && (
              <div className="notice">Hệ thống: {value.review_note}</div>
            )}
            {canResolve && value.status === "OPEN" && (
              <ResolutionForm
                orderId={orderId}
                value={value}
                onChange={onChange}
              />
            )}
          </article>
        ))
      )}
    </div>
  );
}

export function AdminPaymentRequestReview({
  value,
  onChange,
}: {
  value: PaymentRequest;
  onChange: () => void;
}) {
  const { toast } = useApp(),
    [busy, setBusy] = useState(false);
  const locked = useRef(false);
  return (
    <form
      className="form payment-resolution-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (locked.current) return;
        const f = new FormData(
          e.currentTarget,
          (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement,
        );
        locked.current = true;
        setBusy(true);
        try {
          await post(`admin/exceptions/${value.id}`, {
            action: f.get("decision"),
            note: f.get("note"),
          });
          toast(
            f.get("decision") === "APPROVE"
              ? "Đã duyệt giải quyết."
              : "Đã yêu cầu bếp bổ sung bằng chứng.",
          );
          onChange();
        } catch (e) {
          toast((e as Error).message);
        } finally {
          locked.current = false;
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Nhận xét của hệ thống</span>
        <textarea
          name="note"
          minLength={5}
          maxLength={500}
          placeholder="Kết quả kiểm tra bằng chứng hoặc nội dung cần bếp bổ sung"
          required
          disabled={busy}
        />
      </label>
      <div className="form-row">
        <button
          className="button"
          type="submit"
          name="decision"
          value="APPROVE"
          disabled={busy}
        >
          Duyệt giải quyết
        </button>
        <button
          className="button secondary"
          type="submit"
          name="decision"
          value="REJECT"
          disabled={busy}
        >
          Yêu cầu bổ sung
        </button>
      </div>
    </form>
  );
}
