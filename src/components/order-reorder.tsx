"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useApp, request } from "./providers";
import { useLoad, Notice } from "./app";
import type { ReorderOption, ReorderResult } from "@/lib/reorder";

/** History checks are lazy so opening 100 past orders does not fetch 100 menus. */
export function HistoryReorder({ orderId }: { orderId: string }) {
  const { location, user, loadCache, toast, setLocationOpen } = useApp();
  const router = useRouter();
  const [options, setOptions] = useState<ReorderOption[] | null>(null);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const path = location
    ? `orders/${orderId}/reorder?lat=${location.lat}&lng=${location.lng}`
    : null;
  useEffect(() => {
    setOptions(null);
    setChecking(false);
    return () => controller.current?.abort();
  }, [path]);
  async function check(productId?: string) {
    if (!path) {
      toast("Chọn địa chỉ giao để kiểm tra điều kiện đặt lại.");
      setLocationOpen(true);
      return;
    }
    if (checking) return;
    const operation = new AbortController();
    controller.current = operation;
    setChecking(true);
    try {
      const fresh = await request<ReorderResult>(path, {
        signal: operation.signal,
      });
      if (operation.signal.aborted) return;
      const choices = [
        ...new Map(fresh.options.map((o) => [o.productId, o])).values(),
      ];
      setOptions(choices);
      const choice = productId
        ? choices.find((o) => o.productId === productId)
        : choices.length === 1
          ? choices[0]
          : undefined;
      if (!choice) {
        if (!choices.length) toast("Đơn không có món để đặt lại.");
        return;
      }
      if (!choice.eligible || !choice.href) {
        toast(choice.reason || "Món hiện không đủ điều kiện đặt lại.");
        return;
      }
      if (user && location)
        loadCache.invalidate(
          `${user.id}:${user.role}:catalog?lat=${location.lat}&lng=${location.lng}&product=${encodeURIComponent(choice.productId)}`,
        );
      router.push(choice.href, { transitionTypes: ["page-forward"] });
    } catch (error) {
      if (!operation.signal.aborted) toast((error as Error).message);
    } finally {
      if (!operation.signal.aborted) setChecking(false);
    }
  }
  const blocked = options?.length === 1 && !options[0].eligible;
  return (
    <div className="history-reorder">
      <button
        type="button"
        className={`button secondary history-reorder-button ${blocked ? "unavailable" : ""}`}
        aria-disabled={Boolean(blocked)}
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <RotateCcw size={15} />
        )}{" "}
        {checking ? "Đang kiểm tra…" : "Đặt lại"}
      </button>
      {blocked && <p className="muted small">{options[0].reason}</p>}
      {options && options.length > 1 && (
        <div className="history-reorder-choices" aria-label="Chọn món đặt lại">
          <p className="muted small">Chọn món muốn đặt lại</p>
          {options.map((o) => (
            <div key={o.productId}>
              <span>
                {o.name}
                {!o.eligible && <small>{o.reason}</small>}
              </span>
              <button
                type="button"
                className={`button secondary history-reorder-button ${!o.eligible ? "unavailable" : ""}`}
                aria-label={`Đặt lại ${o.name}`}
                aria-disabled={!o.eligible}
                disabled={checking}
                onClick={() => void check(o.productId)}
              >
                Đặt lại
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrderReorder({
  orderId,
  items,
}: {
  orderId: string;
  items: { id: string; product_id: string; name: string }[];
}) {
  const { location, user, loadCache, revision, toast, setLocationOpen } =
    useApp();
  const router = useRouter();
  const path = location
    ? `orders/${orderId}/reorder?lat=${location.lat}&lng=${location.lng}`
    : null;
  const { data, error, loading, reload, setData } = useLoad<ReorderResult>(
    path,
    [revision],
  );
  const [checking, setChecking] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setChecking(null);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const interval = setInterval(reload, 30000);
    const focus = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      controller.current?.abort();
      clearInterval(clock);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [path, reload]);

  async function reorder(productId: string) {
    if (!path) {
      toast("Chọn địa chỉ giao để kiểm tra điều kiện đặt lại.");
      setLocationOpen(true);
      return;
    }
    if (checking || (loading && !data)) return;
    const operation = new AbortController();
    controller.current?.abort();
    controller.current = operation;
    setChecking(productId);
    try {
      const fresh = await request<ReorderResult>(path, {
        signal: operation.signal,
      });
      if (operation.signal.aborted) return;
      setData(fresh);
      const option = fresh.options.find((o) => o.productId === productId);
      if (!option?.eligible || !option.href) {
        toast(option?.reason || "Món hiện không đủ điều kiện đặt lại.");
        return;
      }
      // Reload the dish page's current stock and price instead of an older cached menu.
      if (user && location)
        loadCache.invalidate(
          `${user.id}:${user.role}:catalog?lat=${location.lat}&lng=${location.lng}&product=${encodeURIComponent(productId)}`,
        );
      router.push(option.href, { transitionTypes: ["page-forward"] });
    } catch (error) {
      if (!operation.signal.aborted) toast((error as Error).message);
    } finally {
      if (!operation.signal.aborted) setChecking(null);
    }
  }

  return (
    <section className="order-reorder" aria-label="Đặt lại món">
      {error && (
        <Notice error>
          {error} <button onClick={reload}>Thử lại</button>
        </Notice>
      )}
      {items.map((item) => {
        const option = data?.options.find(
          (o) => o.productId === item.product_id,
        );
        const expired =
          option?.cutoffAt && new Date(option.cutoffAt).getTime() <= now;
        const eligible = Boolean(option?.eligible && !expired && location);
        const reason = !location
          ? "Chọn địa chỉ giao để kiểm tra điều kiện đặt lại."
          : expired
            ? "Đã hết giờ nhận món."
            : option?.reason ||
              (!data && !error ? "Đang kiểm tra điều kiện đặt lại…" : "");
        const descriptionId = `reorder-reason-${item.id}`;
        return (
          <div className="order-reorder-item" key={item.id}>
            {items.length > 1 && <strong>{item.name}</strong>}
            {/* Unavailable buttons remain clickable to explain the validation reason. */}
            <button
              type="button"
              className={`button reorder-button ${!eligible ? "unavailable" : ""}`}
              aria-label={`Đặt lại ${item.name}`}
              aria-disabled={!eligible}
              aria-describedby={reason ? descriptionId : undefined}
              disabled={checking !== null || (loading && !data && !!location)}
              onClick={() => void reorder(item.product_id)}
            >
              {checking === item.product_id ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <RotateCcw size={17} />
              )}
              {checking === item.product_id ? "Đang kiểm tra…" : "Đặt lại"}
            </button>
            {reason && (
              <p className="muted small" id={descriptionId}>
                {reason}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
