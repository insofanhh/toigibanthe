"use client";
import { useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { post, useApp } from "./providers";
import { Button, Field, Notice, useLoad } from "./app";
import { money } from "@/lib/domain";

const results: Record<string, string> = {
  PAID: "Đã thanh toán",
  PARTIAL: "Chuyển thiếu",
  OVERPAID: "Cần đối soát",
  LATE: "Tiền vào sau khi đơn kết thúc",
  EXTRA_PAYMENT: "Chuyển thêm sau thanh toán",
  UNMATCHED: "Không tìm thấy mã đơn",
  ACCOUNT_MISMATCH: "Không khớp tài khoản",
  INVALID_DATE: "Không khớp thời gian",
  RECEIVED: "Đã tiếp nhận",
};
export function SePaySettings() {
  const { toast, revision } = useApp(),
    { data, error, reload, loading } = useLoad("chef/sepay", [revision]);
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [qr, setQR] = useState(""),
    [qrError, setQRError] = useState("");
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Đã sao chép.");
    } catch {
      toast("Không thể sao chép. Hãy chọn và sao chép nội dung trực tiếp.");
    }
  }
  async function generate() {
    setBusy(true);
    try {
      const r = await post("chef/sepay/key", {});
      setKey(r.apiKey);
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    setBusy(true);
    setQRError("");
    try {
      const r = await post("chef/sepay/qr", {});
      setQR(r.qr);
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const enabled = new FormData(e.currentTarget).get("enabled") === "on";
    setBusy(true);
    try {
      await post("chef/sepay", {
        enabled,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      setKey("");
      setMessage("");
      reload();
      toast("Đã lưu cấu hình SePay.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form narrow sepay-settings">
      <h2>Thanh toán tự động · SePay</h2>
      {error && <Notice error>{error}</Notice>}
      {data?.bankConnection && (
        <div className="form">
          <h3>Kiểm tra nhận webhook</h3>
          <p className="bank-note">
            {data.bankConnection.bankSaved
              ? `Tài khoản trên QR: ${data.bankConnection.bankName} · ••••${data.bankConnection.receiverLast4}`
              : "Lưu tài khoản ngân hàng của bếp trước khi cấu hình SePay."}
          </p>
          {data.bankConnection.bankSaved && (
            <Notice>
              {data.bankConnection.matchingWebhookAt ? (
                <>
                  Webhook gần nhất khớp tài khoản QR:{" "}
                  {new Date(
                    data.bankConnection.matchingWebhookAt.replace(" ", "T") +
                      "Z",
                  ).toLocaleString("vi-VN")}
                  .
                </>
              ) : (
                <>
                  App chưa nhận webhook khớp tài khoản trên QR. Bật cấu hình tại
                  đây chưa xác nhận ngân hàng đã đồng bộ với SePay.
                </>
              )}
              {data.bankConnection.latestWebhook &&
                !data.bankConnection.latestWebhook.matchesCurrentAccount && (
                  <p>
                    Webhook gần nhất báo tiền vào{" "}
                    {data.bankConnection.latestWebhook.bankName} · ••••
                    {data.bankConnection.latestWebhook.receiverLast4}, khác số
                    tài khoản trên QR. Đối chiếu tài khoản đã liên kết và được
                    chọn trong webhook SePay; nếu dùng số tài khoản đẹp/alias,
                    kiểm tra số ngân hàng báo về.
                  </p>
                )}
            </Notice>
          )}
          <p className="bank-note">
            Nếu khách đã chuyển nhưng SePay chưa có giao dịch, kiểm tra đồng bộ
            ngân hàng trong SePay trước. Nếu SePay đã có giao dịch, kiểm tra
            lịch sử gửi webhook. SePay gửi thông báo tiền vào tới app; QR không
            tạo giao dịch trong SePay.
          </p>
          <Button
            secondary
            type="button"
            onClick={reload}
            disabled={busy || loading}
          >
            {loading ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
          </Button>
        </div>
      )}
      {data && (
        <form
          className="form"
          onSubmit={save}
          key={String(data.enabled) + String(data.configured)}
        >
          <label className="sepay-toggle">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={data.enabled}
            />{" "}
            Tự xác nhận tiền qua SePay
          </label>
          <Field label="URL nhận webhook">
            <div className="sepay-copy">
              <input readOnly value={data.webhookUrl} />
              <button
                type="button"
                className="icon-button"
                aria-label="Sao chép URL webhook"
                onClick={() => void copy(data.webhookUrl)}
              >
                <Copy size={17} />
              </button>
            </div>
          </Field>
          <Field
            label={
              data.configured
                ? "API Key mới (để trống để giữ key đã lưu)"
                : "API Key webhook"
            }
          >
            <div className="sepay-copy">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="new-password"
                minLength={32}
                maxLength={128}
                placeholder="Tạo key hoặc nhập key của bạn"
              />
              <button
                type="button"
                className="icon-button"
                disabled={!key}
                aria-label="Sao chép API Key"
                onClick={() => void copy(key)}
              >
                <Copy size={17} />
              </button>
            </div>
          </Field>
          <Button
            secondary
            type="button"
            onClick={() => void generate()}
            disabled={busy}
          >
            Tạo API Key để sao chép
          </Button>
          <p className="bank-note">
            Sao chép key trước khi lưu. Hệ thống chỉ lưu mã băm, không hiển thị
            lại key. Khi đổi key, cập nhật cùng key trong webhook SePay. Xử lý
            xong các đơn chờ trước khi tắt SePay vì webhook sẽ ngừng nhận.
          </p>
          <ol className="sepay-steps">
            <li>
              Liên kết tài khoản ngân hàng đã lưu ở trên với tài khoản SePay của
              bạn.
            </li>
            <li>
              Trong SePay → Webhooks, thêm webhook cho sự kiện{" "}
              <strong>Có tiền vào</strong>, chọn đúng tài khoản và dán URL ở
              trên.
            </li>
            <li>
              Chọn xác thực <strong>API Key</strong>, dán key đã sao chép. Key
              này dùng để xác thực webhook, không phải API Access Token của
              SePay.
            </li>
            <li>
              Lưu webhook bên SePay, sau đó bật thanh toán tự động và lưu tại
              đây. Nếu dùng bộ lọc mã thanh toán, đặt tiền tố{" "}
              <strong>TGBD</strong>, hậu tố 10 ký tự chữ/số.
            </li>
          </ol>
          {message && <Notice error>{message}</Notice>}
          <Button type="submit" disabled={busy}>
            Lưu cấu hình SePay
          </Button>
        </form>
      )}
      <Button
        secondary
        type="button"
        onClick={() => void sample()}
        disabled={busy}
      >
        Render mã QR mẫu
      </Button>
      {qr && (
        <div className="payment-qr">
          <img
            src={qr}
            alt="QR SePay mẫu 1.000 đồng"
            onError={() =>
              setQRError(
                "Chưa tải được ảnh QR. Hãy thử lại hoặc mở liên kết QR.",
              )
            }
          />
          <p className="muted">
            Mã mẫu 1.000đ · TGBDTEST. Không gắn với đơn hàng.
          </p>
          <button
            className="text-button"
            type="button"
            onClick={() => void copy(qr)}
          >
            Sao chép link QR mẫu
          </button>
          {qrError && <Notice error>{qrError}</Notice>}
        </div>
      )}
      {data && (
        <>
          <p className="bank-note">
            {data.lastReceivedAt
              ? `Webhook gần nhất: ${new Date(data.lastReceivedAt.replace(" ", "T") + "Z").toLocaleString("vi-VN")}`
              : "Chưa nhận webhook. Dùng Gửi thử trong SePay để kiểm tra kết nối."}
          </p>
          {!!data.transactions?.length && (
            <div className="sepay-transactions">
              <h3>Giao dịch gần đây</h3>
              {data.transactions.map((t: any) => (
                <div key={t.transaction_id}>
                  <span>
                    #{t.transaction_id} · {money(Number(t.amount))}
                  </span>
                  <small>{results[t.result] || t.result}</small>
                  {t.receiver_last4 && (
                    <small>
                      Tài khoản nhận: {t.bank_name} · ••••{t.receiver_last4}
                    </small>
                  )}
                  <small>Nội dung: {t.content || "(trống)"}</small>
                  {t.payment_code && <small>Mã SePay: {t.payment_code}</small>}
                  {t.description && t.description !== t.content && (
                    <small>Mô tả: {t.description}</small>
                  )}
                  {t.order_code && (
                    <small>
                      Đơn #{t.order_code} · Tổng {money(Number(t.order_total))}
                    </small>
                  )}
                  {t.result === "UNMATCHED" && (
                    <small>
                      {t.failure_reason === "ACCOUNT_NOT_CONFIGURED"
                        ? "Tài khoản nhận khác tài khoản bếp đang cài. Kiểm tra tài khoản được chọn trong webhook SePay và mã đơn trong nội dung chuyển khoản."
                        : t.failure_reason === "ORDER_NOT_FOUND"
                          ? "Mã thanh toán không thuộc đơn của bếp này. Kiểm tra URL webhook."
                          : "Chưa nhận diện được một mã TGBD duy nhất. Kiểm tra nội dung chuyển khoản và dữ liệu SePay gửi; tiền vào chưa đồng nghĩa đơn đã thanh toán."}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
