"use client";

import { useEffect, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import type { ProductReviews } from "@/lib/product-reviews";
import { useLoad, Notice } from "./app";
import { useApp } from "./providers";

export function DishReviews({
  productId,
  name,
  rating,
  count,
}: {
  productId: string;
  name: string;
  rating: number;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [previous, setPrevious] = useState<ProductReviews["reviews"]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const { revision } = useApp();
  const { data, error, loading, reload } = useLoad<ProductReviews>(
    open
      ? `products/${encodeURIComponent(productId)}/reviews?cursor=${cursor}`
      : null,
    [revision],
  );
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const reviews = [
    ...new Map(
      [...previous, ...(data?.reviews || [])].map((r) => [r.id, r]),
    ).values(),
  ];
  return (
    <>
      <button
        type="button"
        className="dish-rating-button"
        aria-haspopup="dialog"
        onClick={() => {
          setCursor(0);
          setPrevious([]);
          setOpen(true);
        }}
      >
        <Star size={14} fill="currentColor" /> {rating.toFixed(1)} ({count} đánh
        giá)
      </button>
      <dialog
        ref={dialog}
        className="reviews-dialog"
        aria-labelledby="dish-reviews-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              setOpen(false);
          }
        }}
      >
        <div className="sheet-header">
          <h2 id="dish-reviews-title">Đánh giá món ăn</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Đóng đánh giá"
            onClick={() => setOpen(false)}
          >
            <X size={21} />
          </button>
        </div>
        <p className="reviews-dish-name">{name}</p>
        <p className="muted small">
          Đánh giá từ các đơn đã hoàn thành có món này.
        </p>
        {data && (
          <div className="reviews-summary">
            <Star size={18} fill="currentColor" />
            <strong>{data.total ? data.rating.toFixed(1) : "—"}</strong>
            <span>{data.total} đánh giá</span>
          </div>
        )}
        {reviews.map((r) => (
          <article className="dish-review" key={r.id}>
            <div className="spread">
              <strong>{r.name}</strong>
              <span
                className="review-stars"
                aria-label={`${r.rating} trên 5 sao`}
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    size={13}
                    fill={i < r.rating ? "currentColor" : "none"}
                  />
                ))}
              </span>
            </div>
            <time dateTime={r.createdAt}>
              {new Date(r.createdAt).toLocaleDateString("vi-VN")}
            </time>
            <p>{r.body || "Khách đã gửi đánh giá sao."}</p>
          </article>
        ))}
        {loading && (
          <p className="muted small" role="status">
            Đang tải đánh giá…
          </p>
        )}
        {error && (
          <Notice error>
            {error} <button onClick={reload}>Thử lại</button>
          </Notice>
        )}
        {data && !data.total && !loading && (
          <p className="reviews-empty">Chưa có đánh giá cho món này.</p>
        )}
        {data?.nextCursor !== null && data?.nextCursor !== undefined && (
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              setPrevious(reviews);
              setCursor(data.nextCursor!);
            }}
          >
            Xem thêm đánh giá
          </button>
        )}
      </dialog>
    </>
  );
}
