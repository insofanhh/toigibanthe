import { rows } from "./db";
import { AppError } from "./http";
import { parseUTC } from "./domain";

export type ChefReviewsResult = {
  reviews: {
    id: string;
    name: string;
    rating: number;
    body: string;
    createdAt: string;
    dishes: { id: string; name: string }[];
  }[];
  total: number;
  nextCursor: number | null;
};

export async function getChefReviews(
  chefId: string,
  sort: "highest" | "lowest" | "recent",
  offset: number,
): Promise<ChefReviewsResult> {
  const chef = await rows(
    'SELECT c.id FROM chefs c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.status="approved" AND u.active=TRUE',
    [chefId],
  );
  if (!chef.length) throw new AppError("Bếp chưa hoạt động.", 404);
  const condition =
    'r.chef_id=? AND o.status="COMPLETED" AND o.user_id=r.user_id';
  const [summary] = await rows<{ total: number }>(
    `SELECT COUNT(*) total FROM reviews r JOIN orders o ON o.id=r.order_id WHERE ${condition}`,
    [chefId],
  );
  const orderBy =
    sort === "highest"
      ? "r.rating DESC,"
      : sort === "lowest"
        ? "r.rating ASC,"
        : "";
  const reviews = await rows<{
    id: string;
    order_id: string;
    name: string;
    rating: number;
    body: string;
    created_at: string;
  }>(
    `SELECT r.id,r.order_id,u.name,r.rating,r.body,r.created_at FROM reviews r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id WHERE ${condition} ORDER BY ${orderBy} r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`,
    [chefId, offset],
  );
  const items = reviews.length
    ? await rows<{ order_id: string; product_id: string; name: string }>(
        `SELECT DISTINCT order_id,product_id,name FROM order_items WHERE order_id IN (${reviews.map(() => "?").join(",")}) ORDER BY name,product_id`,
        reviews.map((r) => r.order_id),
      )
    : [];
  return {
    reviews: reviews.map(({ order_id, created_at, ...review }) => ({
      ...review,
      createdAt: parseUTC(created_at).toISOString(),
      dishes: items
        .filter((i) => i.order_id === order_id)
        .map((i) => ({ id: i.product_id, name: i.name })),
    })),
    total: Number(summary.total),
    nextCursor:
      offset + reviews.length < Number(summary.total)
        ? offset + reviews.length
        : null,
  };
}
