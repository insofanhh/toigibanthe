import { rows } from "./db";
import { AppError } from "./http";
import { parseUTC } from "./domain";

export type ProductReviews = {
  reviews: {
    id: string;
    name: string;
    rating: number;
    body: string;
    createdAt: string;
  }[];
  total: number;
  rating: number;
  nextCursor: number | null;
};

export async function getProductReviews(
  productId: string,
  offset = 0,
): Promise<ProductReviews> {
  const product = await rows(
    'SELECT p.id FROM products p JOIN chefs c ON c.id=p.chef_id JOIN users u ON u.id=c.user_id WHERE p.id=? AND p.active=TRUE AND c.status="approved" AND u.active=TRUE',
    [productId],
  );
  if (!product.length) throw new AppError("Món hiện không khả dụng.", 404);
  // Reviews are submitted once per completed order and apply to its distinct dishes.
  const condition =
    'o.status="COMPLETED" AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=r.order_id AND oi.product_id=?)';
  const [summary] = await rows<{ total: number; rating: number }>(
    `SELECT COUNT(*) total,COALESCE(AVG(r.rating),0) rating FROM reviews r JOIN orders o ON o.id=r.order_id WHERE ${condition}`,
    [productId],
  );
  const reviews = await rows<{
    id: string;
    name: string;
    rating: number;
    body: string;
    created_at: string;
  }>(
    `SELECT r.id,u.name,r.rating,r.body,r.created_at FROM reviews r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id WHERE ${condition} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`,
    [productId, offset],
  );
  return {
    reviews: reviews.map(({ created_at, ...review }) => ({
      ...review,
      createdAt: parseUTC(created_at).toISOString(),
    })),
    total: Number(summary.total),
    rating: Number(summary.rating),
    nextCursor:
      offset + reviews.length < Number(summary.total)
        ? offset + reviews.length
        : null,
  };
}
