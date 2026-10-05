import { rows, sqlDate } from "./db";
import {
  cutoffAt,
  serviceDate,
  type Dish,
  type Feed,
  type Location,
  type MealId,
  type ChefMapFeed,
} from "./domain";

export async function nearbyMapChefs(location: Location): Promise<ChefMapFeed> {
  const date = serviceDate();
  const prev = new Date(`${date}T12:00:00+07:00`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const chefs = await rows<{
    id: string;
    name: string;
    bio: string;
    area: string;
    avatar: string;
    rating: number;
    ratingCount: number;
    completedOrders: number;
    lat: number;
    lng: number;
    radiusKm: number;
    distance: number;
  }>(
    `SELECT c.id,c.name,c.bio,c.area,c.avatar_url avatar,c.rating,c.rating_count ratingCount,
      c.completed_orders completedOrders,c.lat,c.lng,c.radius_km radiusKm,
      6371*ACOS(LEAST(1,GREATEST(-1,COS(RADIANS(?))*COS(RADIANS(c.lat))*COS(RADIANS(c.lng)-RADIANS(?))+SIN(RADIANS(?))*SIN(RADIANS(c.lat))))) distance
      FROM chefs c JOIN users u ON u.id=c.user_id
      WHERE c.status='approved' AND u.active=TRUE
      AND EXISTS (
        SELECT 1 FROM kitchen_sessions k JOIN daily_menu m ON m.session_id=k.id
        JOIN products p ON p.id=m.product_id JOIN meal_settings ms ON ms.id=m.meal_id
        WHERE k.chef_id=c.id AND p.chef_id=c.id AND p.active=TRUE AND k.is_open=TRUE
        AND m.enabled=TRUE AND m.stock>0 AND m.cutoff_at>?
        AND (k.service_date=? OR (k.service_date=? AND ms.day_offset=1))
      )
      HAVING distance<=radiusKm ORDER BY distance,c.id`,
    [
      location.lat,
      location.lng,
      location.lat,
      sqlDate(),
      date,
      serviceDate(prev),
    ],
  );
  return {
    chefs: chefs.map((c) => ({
      ...c,
      lat: Number(c.lat),
      lng: Number(c.lng),
      radiusKm: Number(c.radiusKm),
      distance: Number(c.distance),
    })),
    serverNow: new Date().toISOString(),
  };
}
type CatalogRow = {
  id: string;
  menu_id: string;
  chef_id: string;
  chef_name: string;
  chef_avatar: string;
  name: string;
  description: string;
  ingredients: string;
  image_url: string;
  price: number;
  sale_price: number | null;
  campaign_active: number;
  rating: number;
  rating_count: number;
  distance: number;
  meal_id: MealId;
  stock: number;
  cutoff_at: string;
  prep_minutes: number;
  liked: number;
  bio: string;
  area: string;
  chef_rating: number;
  chef_rating_count: number;
  completed_orders: number;
};
export async function feed(
  location: Location,
  options: {
    userId?: string;
    meal?: string;
    search?: string;
    offset?: number;
    limit?: number;
    sale?: boolean;
    favorite?: boolean;
    productId?: string;
    chefId?: string;
  } = {},
): Promise<Feed> {
  const now = sqlDate(),
    date = serviceDate();
  const prev = new Date(`${date}T12:00:00+07:00`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const yesterday = serviceDate(prev);
  const conditions = [
    'c.status="approved"',
    "u.active=TRUE",
    "p.active=TRUE",
    "k.is_open=TRUE",
    "m.enabled=TRUE",
    "m.stock>0",
    "m.cutoff_at>?",
    "(k.service_date=? OR (k.service_date=? AND ms.day_offset=1))",
  ];
  const values: unknown[] = [
    location.lat,
    location.lat,
    location.lng,
    options.userId || "",
    now,
    date,
    yesterday,
  ];
  if (options.meal) {
    conditions.push("m.meal_id=?");
    values.push(options.meal);
  }
  if (options.productId) {
    conditions.push("p.id=?");
    values.push(options.productId);
  }
  if (options.chefId) {
    conditions.push("c.id=?");
    values.push(options.chefId);
  }
  if (options.search) {
    conditions.push("(p.name LIKE ? OR c.name LIKE ?)");
    values.push(`%${options.search}%`, `%${options.search}%`);
  }
  if (options.favorite) conditions.push("f.user_id IS NOT NULL");
  if (options.sale)
    conditions.push(
      "ca.active=TRUE AND ca.starts_at<=UTC_TIMESTAMP(3) AND ca.ends_at>UTC_TIMESTAMP(3) AND m.sale_price>0 AND m.sale_price<p.price",
    );
  const offset = options.offset || 0,
    limit = Math.min(options.limit || 60, 100);
  const data = await rows<CatalogRow>(
    `SELECT p.*,m.id menu_id,m.meal_id,m.stock,m.cutoff_at,m.sale_price,c.id chef_id,c.name chef_name,c.avatar_url chef_avatar,c.bio,c.area,c.radius_km,c.rating chef_rating,c.rating_count chef_rating_count,c.completed_orders,
 6371*ACOS(LEAST(1,GREATEST(-1,COS(RADIANS(?))*COS(RADIANS(c.lat))*COS(RADIANS(c.lng)-RADIANS(?))+SIN(RADIANS(?))*SIN(RADIANS(c.lat))))) distance,
 (ca.active=TRUE AND ca.starts_at<=UTC_TIMESTAMP(3) AND ca.ends_at>UTC_TIMESTAMP(3)) campaign_active, (f.user_id IS NOT NULL) liked
 FROM daily_menu m JOIN products p ON p.id=m.product_id JOIN kitchen_sessions k ON k.id=m.session_id JOIN chefs c ON c.id=p.chef_id JOIN users u ON u.id=c.user_id JOIN meal_settings ms ON ms.id=m.meal_id
 LEFT JOIN campaigns ca ON ca.id=m.campaign_id LEFT JOIN favorites f ON f.product_id=p.id AND f.user_id=?
 WHERE ${conditions.join(" AND ")} HAVING distance<=radius_km ORDER BY distance ASC,p.id ASC,m.id ASC LIMIT ? OFFSET ?`,
    // SQL distance uses lat,lng,lat.
    [
      location.lat,
      location.lng,
      location.lat,
      ...values.slice(3),
      limit + 1,
      offset,
    ],
  );
  const hasMore = data.length > limit,
    selected = data.slice(0, limit);
  const dishes = selected.map((r) => ({
    id: r.id,
    menuId: r.menu_id,
    chefId: r.chef_id,
    chefName: r.chef_name,
    chefAvatar: r.chef_avatar,
    name: r.name,
    description: r.description,
    ingredients: r.ingredients || "",
    image: r.image_url,
    originalPrice: r.price,
    price:
      r.campaign_active && r.sale_price && r.sale_price < r.price
        ? r.sale_price
        : r.price,
    rating: r.rating,
    ratingCount: r.rating_count,
    distance: r.distance,
    meal: r.meal_id,
    stock: r.stock,
    cutoffAt: r.cutoff_at.replace(" ", "T") + "Z",
    prepMinutes: r.prep_minutes,
    liked: Boolean(r.liked),
  })) as Dish[];
  const chefs = [
    ...new Map(
      selected.map((r) => [
        r.chef_id,
        {
          id: r.chef_id,
          name: r.chef_name,
          bio: r.bio,
          area: r.area,
          avatar: r.chef_avatar,
          rating: r.chef_rating,
          ratingCount: r.chef_rating_count,
          completedOrders: r.completed_orders,
          distance: r.distance,
        },
      ]),
    ).values(),
  ];
  const meals = await rows<{
    id: MealId;
    name: string;
    cutoff_time: string;
    day_offset: number;
  }>("SELECT * FROM meal_settings ORDER BY sort_order");
  const campaign =
    (
      await rows<{ id: string; name: string }>(
        "SELECT id,name FROM campaigns WHERE active=TRUE AND starts_at<=? AND ends_at>? LIMIT 1",
        [now, now],
      )
    )[0] || null;
  return {
    dishes,
    chefs,
    meals: meals.map((m) => ({
      id: m.id,
      name: m.name,
      cutoff: m.cutoff_time,
      cutoffAt: cutoffAt(date, m.cutoff_time, m.day_offset).toISOString(),
      disabled:
        cutoffAt(date, m.cutoff_time, m.day_offset).getTime() <= Date.now(),
    })),
    campaign,
    banners: await rows(
      "SELECT id,title,body,image_url,href FROM banners WHERE active=TRUE ORDER BY sort_order",
    ),
    serverNow: new Date().toISOString(),
    hasMore,
    cursor: hasMore ? offset + limit : null,
  };
}
