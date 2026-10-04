"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Notice, PageLoading } from "./app";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseUTC, money } from "@/lib/domain";
export type ReportRow = Record<string, any>;
export const count = (v: unknown) => Number(v || 0).toLocaleString("vi-VN");
export const stamp = (v?: string | null) =>
  v
    ? parseUTC(v).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
export function ReportBlock({
  title,
  caption,
  children,
  action,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="analytics-block">
      <div className="analytics-block-heading">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function ReportPending({
  error,
  retry,
}: {
  error?: string | null;
  retry: () => void;
}) {
  return error ? (
    <Notice error>
      {error}{" "}
      <button className="text-button" onClick={retry}>
        Thử lại
      </button>
    </Notice>
  ) : (
    <PageLoading label="Đang tải báo cáo…" />
  );
}
export function ReportTable({
  headers,
  children,
  className = "",
}: {
  headers: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="analytics-table-wrap">
      <table className={"analytics-table " + className}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function ReportPager({
  data,
  onPage,
}: {
  data: ReportRow;
  onPage: (n: number) => void;
}) {
  return (
    <div className="users-pagination">
      <Button
        secondary
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        <ChevronLeft size={16} />
        Trước
      </Button>
      <span>
        Trang {count(data.page)} / {count(data.pages)} · {count(data.total)} bản
        ghi
      </span>
      <Button
        secondary
        disabled={data.page >= data.pages}
        onClick={() => onPage(data.page + 1)}
      >
        Sau
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
export function ReportDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="chefs-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="analytics-block-heading">
        <h2>{title}</h2>
        <Button secondary disabled={busy} onClick={onClose}>
          Đóng
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function SalesChart({
  days,
  metric,
  unit = "phần",
}: {
  days: ReportRow[];
  metric: string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null),
    max = Math.max(
      1,
      ...days.flatMap((d) => [
        Number(d[metric]),
        Number(d["previous_" + metric]),
      ]),
    ),
    x = (i: number) =>
      45 + (days.length === 1 ? 0.5 : i / (days.length - 1)) * 710,
    y = (n: number) => 180 - (n / max) * 145,
    format = (n: number) =>
      metric === "gmv" ? money(n) : count(n) + " " + unit;
  return (
    <>
      <div className="analytics-chart-legend">
        <span>
          <i style={{ background: "#21715d" }} />
          Kỳ này
        </span>
        <span>
          <i style={{ background: "#b68c40" }} />
          Kỳ trước
        </span>
      </div>
      <div className="analytics-chart" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 800 225"
          role="img"
          aria-label={
            metric === "gmv"
              ? "Doanh số món theo ngày"
              : "Số " + unit + " theo ngày"
          }
        >
          {[0, 0.5, 1].map((n) => (
            <g key={n}>
              <line
                x1="45"
                x2="755"
                y1={y(n * max)}
                y2={y(n * max)}
                stroke="#e7ede9"
              />
              <text x="36" y={y(n * max) + 4} textAnchor="end">
                {metric === "gmv"
                  ? count(Math.round((n * max) / 1000)) + "k"
                  : count(Math.round(n * max))}
              </text>
            </g>
          ))}
          {[metric, "previous_" + metric].map((key, j) => (
            <g key={key}>
              <polyline
                points={days
                  .map((d, i) => `${x(i)},${y(Number(d[key]))}`)
                  .join(" ")}
                fill="none"
                stroke={j ? "#b68c40" : "#21715d"}
                strokeWidth="3"
              />
              {days.length === 1 && (
                <circle
                  cx={x(0)}
                  cy={y(Number(days[0][key]))}
                  r="4"
                  fill={j ? "#b68c40" : "#21715d"}
                />
              )}
            </g>
          ))}
          {days.map((d, i) => (
            <g
              key={d.day}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <title>
                {d.day}: {format(d[metric])}, kỳ trước{" "}
                {format(d["previous_" + metric])}
              </title>
              <rect
                x={x(i) - 8}
                y="22"
                width="16"
                height="172"
                fill="transparent"
              />
              {(i === 0 ||
                i === days.length - 1 ||
                i % Math.max(1, Math.ceil(days.length / 6)) === 0) && (
                <text x={x(i)} y="211" textAnchor="middle">
                  {d.day.slice(8) + "/" + d.day.slice(5, 7)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hover !== null && days[hover] && (
          <div className="analytics-chart-tooltip">
            {days[hover].day} · {format(days[hover][metric])} · Kỳ trước{" "}
            {format(days[hover]["previous_" + metric])}
          </div>
        )}
      </div>
      <details className="analytics-details">
        <summary>Xem số liệu biểu đồ</summary>
        <ReportTable headers={["Ngày", "Kỳ này", "Ngày kỳ trước", "Kỳ trước"]}>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{format(d[metric])}</td>
              <td>{d.previous_day}</td>
              <td>{format(d["previous_" + metric])}</td>
            </tr>
          ))}
        </ReportTable>
      </details>
    </>
  );
}
