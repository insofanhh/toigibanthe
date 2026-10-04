"use client";
import { AnimatedValue } from "./animated-value";

import { useState } from "react";
import { Star } from "lucide-react";
import type { ChefReviewsResult } from "@/lib/chef-reviews";
import { useLoad, Notice } from "./app";
import { useApp } from "./providers";

export function ChefReviews({ chefId }: { chefId: string }) {
  const [sort, setSort] = useState("highest");
  const [cursor, setCursor] = useState(0);
  const [previous, setPrevious] = useState<ChefReviewsResult["reviews"]>([]);
  const { revision } = useApp();
  const { data, error, loading, reload } = useLoad<ChefReviewsResult>(
    `chefs/${encodeURIComponent(chefId)}/reviews?sort=${sort}&cursor=${cursor}`,
    [revision],
  );
  const reviews = [
    ...new Map(
      [...previous, ...(data?.reviews || [])].map((r) => [r.id, r]),
    ).values(),
  ];
  return (
    <section className="chef-reviews">
      <div className="chef-reviews-heading">
        <h2>
          Đánh giá
          {data && (
            <>
              {" "}
              (<AnimatedValue>{data.total}</AnimatedValue>)
            </>
          )}
        </h2>
        <label>
          Sắp xếp
          <select
            aria-label="Sắp xếp đánh giá"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setCursor(0);
              setPrevious([]);
            }}
          >
            <option value="highest">Sao cao đến thấp</option>
            <option value="lowest">Sao thấp đến cao</option>
            <option value="recent">Mới nhất</option>
          </select>
        </label>
      </div>
      {reviews.map((r) => (
        <article className="panel chef-review" key={r.id}>
          <div className="spread">
            <strong>{r.name}</strong>
            <span className="review-stars">
              <Star size={14} fill="currentColor" />{" "}
              <AnimatedValue>{r.rating}</AnimatedValue>/5
            </span>
          </div>
          <time dateTime={r.createdAt}>
            {new Date(r.createdAt).toLocaleString("vi-VN")}
          </time>
          <p className="chef-review-dishes">
            <span>Món đã đặt:</span>{" "}
            {r.dishes.map((d) => d.name).join(" · ") ||
              "Không còn thông tin món"}
          </p>
          <p className="chef-review-body">
            {r.body || "Khách đã gửi đánh giá sao."}
          </p>
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
        <p className="muted">Bếp chưa có đánh giá.</p>
      )}
      {data?.nextCursor !== null && data?.nextCursor !== undefined && (
        <button
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
    </section>
  );
}
