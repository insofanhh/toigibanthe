"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ORDER_LABELS, parseUTC } from "@/lib/domain";

type Event = { status: string; note: string; created_at: string };
const stages = [
  "PLACED",
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "DELIVERING",
  "DELIVERED",
  "COMPLETED",
];
const stageFor = (status: string) =>
  status === "PAYMENT_REPORTED" ? "PLACED" : status;
const label = (status: string) =>
  ORDER_LABELS[status] ||
  (status === "PAYMENT_REPORTED" ? "Khách báo đã chuyển khoản" : status);

export function OrderProgress({
  status,
  events,
}: {
  status: string;
  events: Event[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const extras = [
    ...new Set([...events.map((e) => stageFor(e.status)), status]),
  ].filter((s) => !stages.includes(s));
  const stopped = ["CANCELLED", "REJECTED", "EXPIRED"].includes(status);
  const lastRecorded = Math.max(
    0,
    ...events.map((e) => stages.indexOf(stageFor(e.status))),
  );
  const steps = [
    ...(stopped ? stages.slice(0, lastRecorded + 1) : stages),
    ...extras,
  ];
  const active = selected && steps.includes(selected) ? selected : null;
  const selectedEvents = active
    ? events.filter((e) => stageFor(e.status) === active)
    : [];
  const at = stages.indexOf(status);
  return (
    <section
      className="panel order-tracking"
      aria-label="Tiến trình và lịch sử đơn"
    >
      <div className="spread">
        <h2>Tiến trình đơn</h2>
        <span className="muted small">Chạm để xem chi tiết</span>
      </div>
      <div className="order-progress">
        {steps.map((s, i) => {
          const recorded = events.some((e) => stageFor(e.status) === s);
          const done = recorded || (at >= i && i < stages.length);
          return (
            <div key={s} className={done ? "done" : ""}>
              <button
                type="button"
                className={`progress-step ${active === s ? "selected" : ""}`}
                aria-label={`Xem lịch sử ${label(s)}`}
                aria-expanded={active === s}
                aria-controls="order-stage-detail"
                onClick={() => setSelected((current) => (current === s ? null : s))}
              >
                <span>{done ? <Check size={14} /> : i + 1}</span>
                <small>{label(s)}</small>
                <ChevronDown size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div
        id="order-stage-detail"
        className={`order-stage-detail ${active ? "is-open" : ""}`}
        aria-hidden={!active}
        aria-live="polite"
      >
        {active && (
          <>
            <strong>{label(active)}</strong>
            {selectedEvents.length ? (
              selectedEvents.map((ev, i) => (
                <div key={`${ev.created_at}-${i}`}>
                  {ev.status !== active && <strong>{label(ev.status)}</strong>}
                  <time dateTime={parseUTC(ev.created_at).toISOString()}>
                    {parseUTC(ev.created_at).toLocaleString("vi-VN")}
                  </time>
                  {ev.note && <p>{ev.note}</p>}
                </div>
              ))
            ) : (
              <p>Chưa có thời gian ghi nhận cho bước này.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
