import { randomUUID } from "node:crypto";
import { rows, exec, transaction, sqlDate, type DB } from "./db";
import { type Actor, cutoffAt, serviceDate } from "./domain";
import { AppError } from "./http";
import { notify } from "./notifications";
import { chefSchema, productSchema, bankSchema } from "./validation";
import { listAdminPaymentExceptions } from "./payment-requests";
export async function ownedChef(user: Actor, db?: DB) {
  const c = (
    await rows<Record<string, unknown>>(
      "SELECT * FROM chefs WHERE user_id=?",
      [user.id],
      db,
    )
  )[0];
  if (!c) throw new AppError("Bạn chưa đăng ký bếp.", 404);
  return c;
}
export async function adminChefDetail(id: string) {
  const chef = (
    await rows<any>(
      "SELECT c.*,u.name owner_name,u.email,u.phone FROM chefs c JOIN users u ON u.id=c.user_id WHERE c.id=?",
      [id],
    )
  )[0];
  if (!chef) throw new AppError("Không tìm thấy bếp.", 404);
  const [assets, products, orders, stats] = await Promise.all([
    rows(
      'SELECT id,original_name,content_type,created_at FROM assets WHERE user_id=? AND kind="document" ORDER BY created_at DESC',
      [chef.user_id],
    ),
    rows("SELECT * FROM products WHERE chef_id=? ORDER BY created_at DESC", [
      id,
    ]),
    rows(
      "SELECT o.*,c.name chef_name FROM orders o JOIN chefs c ON c.id=o.chef_id WHERE o.chef_id=? ORDER BY o.created_at DESC LIMIT 50",
      [id],
    ),
    rows(
      'SELECT COUNT(*) orders_count,COALESCE(SUM(CASE WHEN status="COMPLETED" THEN total ELSE 0 END),0) revenue FROM orders WHERE chef_id=?',
      [id],
    ),
  ]);
  return { chef, assets, products, orders, stats: stats[0] };
}
export async function chefOverview(user: Actor) {
  const c = await ownedChef(user);
  const products = await rows(
    "SELECT * FROM products WHERE chef_id=? ORDER BY created_at DESC",
    [c.id],
  );
  const date = serviceDate();
  const sessions = await rows(
    "SELECT * FROM kitchen_sessions WHERE chef_id=? AND service_date=?",
    [c.id, date],
  );
  const menu = await rows(
    "SELECT m.*,p.name,p.price FROM daily_menu m JOIN kitchen_sessions k ON k.id=m.session_id JOIN products p ON p.id=m.product_id WHERE k.chef_id=? AND k.service_date=?",
    [c.id, date],
  );
  const stats = (
    await rows(
      'SELECT COUNT(*) orders_count,COALESCE(SUM(CASE WHEN status="COMPLETED" THEN total ELSE 0 END),0) revenue,SUM(CASE WHEN status IN ("PLACED","PAID","ACCEPTED","PREPARING","DELIVERING") THEN 1 ELSE 0 END) active_orders FROM orders WHERE chef_id=?',
      [c.id],
    )
  )[0];
  return {
    chef: c,
    products,
    session: sessions[0] || null,
    menu,
    stats,
    meals: (
      await rows<{ id: string; cutoff_time: string; day_offset: number }>(
        "SELECT * FROM meal_settings ORDER BY sort_order",
      )
    ).map((m) => ({
      ...m,
      cutoffAt: cutoffAt(date, m.cutoff_time, m.day_offset).toISOString(),
      disabled:
        cutoffAt(date, m.cutoff_time, m.day_offset).getTime() <= Date.now(),
    })),
    campaign:
      (
        await rows(
          "SELECT id,name FROM campaigns WHERE active=TRUE AND starts_at<=? AND ends_at>?",
          [sqlDate(), sqlDate()],
        )
      )[0] || null,
    assets: await rows(
      'SELECT id,kind,original_name,created_at FROM assets WHERE user_id=? AND kind="document"',
      [user.id],
    ),
  };
}
export async function applyChef(user: Actor, input: unknown) {
  const data = chefSchema.parse(input);
  return transaction(async (db) => {
    const old = (
      await rows<Record<string, unknown>>(
        "SELECT * FROM chefs WHERE user_id=? FOR UPDATE",
        [user.id],
        db,
      )
    )[0];
    if (old && !["rejected", "needs_changes"].includes(String(old.status)))
      throw new AppError("Bạn đã có hồ sơ bếp.");
    const id = old?.id || randomUUID();
    if (old)
      await exec(
        'UPDATE chefs SET name=?,bio=?,address=?,area=?,lat=?,lng=?,radius_km=?,status="pending",rejection_reason=NULL WHERE id=?',
        [
          data.name,
          data.bio,
          data.address,
          data.area,
          data.lat,
          data.lng,
          data.radiusKm,
          id,
        ],
        db,
      );
    else
      await exec(
        "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,radius_km,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          user.id,
          data.name,
          data.bio,
          data.address,
          data.area,
          data.lat,
          data.lng,
          data.radiusKm,
          sqlDate(),
        ],
        db,
      );
    for (const admin of await rows<{ id: string }>(
      'SELECT id FROM users WHERE role="admin" AND active=TRUE',
      [],
      db,
    ))
      await notify(
        db,
        admin.id,
        "system",
        "Yêu cầu mở bếp",
        `${data.name} đang chờ duyệt.`,
        "/admin?tab=chefs",
      );
    return { id };
  });
}
export async function saveProduct(user: Actor, input: unknown, id?: string) {
  const data = productSchema.parse(input),
    c = await ownedChef(user);
  if (c.status !== "approved") throw new AppError("Bếp chưa được duyệt.", 403);
  const host = new URL(data.imageUrl).hostname;
  if (!(
    host === "images.unsplash.com" ||
    host.endsWith(".public.blob.vercel-storage.com")
  ))
    throw new AppError("Hãy chọn ảnh đã tải lên Vercel Blob.");
  if (id) {
    const result = await exec(
      "UPDATE products SET name=?,description=?,ingredients=?,price=?,image_url=?,prep_minutes=?,active=? WHERE id=? AND chef_id=?",
      [
        data.name,
        data.description,
        data.ingredients,
        data.price,
        data.imageUrl,
        data.prepMinutes,
        data.active,
        id,
        c.id,
      ],
    );
    if (!result.affectedRows) throw new AppError("Không tìm thấy món.", 404);
  } else {
    id = randomUUID();
    await exec(
      "INSERT INTO products (id,chef_id,name,description,ingredients,price,image_url,prep_minutes,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        c.id,
        data.name,
        data.description,
        data.ingredients,
        data.price,
        data.imageUrl,
        data.prepMinutes,
        data.active,
        sqlDate(),
      ],
    );
  }
  return { id };
}
export async function saveBank(user: Actor, input: unknown) {
  const data = bankSchema.parse(input),
    c = await ownedChef(user);
  await transaction(async (db) => {
    await exec(
      "UPDATE chefs SET bank_bin=?,bank_name=?,account_no=?,account_name=? WHERE id=?",
      [data.bankBin, data.bankName, data.accountNo, data.accountName, c.id],
      db,
    );
    await exec(
      "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        user.id,
        "bank.updated",
        c.id,
        JSON.stringify({
          bankBin: data.bankBin,
          maskedAccount: data.accountNo.slice(-4),
        }),
        sqlDate(),
      ],
      db,
    );
  });
  return { ok: true };
}
export async function setKitchen(user: Actor, isOpen: boolean) {
  const c = await ownedChef(user);
  if (c.status !== "approved") throw new AppError("Bếp chưa được duyệt.", 403);
  if (isOpen && (!c.account_no || !c.bank_bin || !c.account_name))
    throw new AppError("Hãy cấu hình tài khoản ngân hàng trước khi mở bếp.");
  await exec(
    "INSERT INTO kitchen_sessions VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE is_open=VALUES(is_open)",
    [randomUUID(), c.id, serviceDate(), isOpen, sqlDate()],
  );
  return { ok: true };
}
export async function saveMenu(
  user: Actor,
  input: {
    productId: string;
    mealId: string;
    stock: number;
    salePrice: number | null;
    enabled: boolean;
  },
) {
  const c = await ownedChef(user);
  if (c.status !== "approved") throw new AppError("Bếp chưa được duyệt.", 403);
  return transaction(async (db) => {
    const p = (
      await rows<{ price: number }>(
        "SELECT price FROM products WHERE id=? AND chef_id=? AND active=TRUE",
        [input.productId, c.id],
        db,
      )
    )[0];
    if (!p) throw new AppError("Món không hợp lệ.");
    const m = (
      await rows<{ cutoff_time: string; day_offset: number }>(
        "SELECT * FROM meal_settings WHERE id=?",
        [input.mealId],
        db,
      )
    )[0];
    if (!m) throw new AppError("Bữa không hợp lệ.");
    const deadline = cutoffAt(serviceDate(), m.cutoff_time, m.day_offset);
    if (deadline.getTime() <= Date.now())
      throw new AppError("Bữa đã hết giờ nhận.");
    if (input.salePrice && input.salePrice >= p.price)
      throw new AppError("Giá sale phải nhỏ hơn giá gốc.");
    const campaign = (
      await rows<{ id: string }>(
        "SELECT id FROM campaigns WHERE active=TRUE AND starts_at<=? AND ends_at>? LIMIT 1",
        [sqlDate(), sqlDate()],
        db,
      )
    )[0];
    if (input.salePrice && !campaign)
      throw new AppError("Hiện chưa có sự kiện sale.");
    await exec(
      "INSERT INTO kitchen_sessions VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE chef_id=VALUES(chef_id)",
      [randomUUID(), c.id, serviceDate(), false, sqlDate()],
      db,
    );
    const k = (
      await rows<{ id: string }>(
        "SELECT id FROM kitchen_sessions WHERE chef_id=? AND service_date=?",
        [c.id, serviceDate()],
        db,
      )
    )[0];
    await exec(
      "INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock=VALUES(stock),sale_price=VALUES(sale_price),campaign_id=VALUES(campaign_id),enabled=VALUES(enabled),cutoff_at=VALUES(cutoff_at)",
      [
        randomUUID(),
        k.id,
        input.productId,
        input.mealId,
        sqlDate(deadline),
        input.stock,
        input.salePrice,
        input.salePrice ? campaign?.id : null,
        input.enabled,
      ],
      db,
    );
    return { ok: true };
  });
}
export async function audit(
  db: DB,
  user: Actor,
  action: string,
  entity: string | null,
  detail: unknown = {},
) {
  await exec(
    "INSERT INTO audit_logs VALUES (?,?,?,?,?,?)",
    [randomUUID(), user.id, action, entity, JSON.stringify(detail), sqlDate()],
    db,
  );
}
export async function adminOverview() {
  return {
    stats: (
      await rows(
        'SELECT COUNT(*) total_orders,COALESCE(SUM(CASE WHEN status="COMPLETED" THEN total ELSE 0 END),0) revenue,SUM(CASE WHEN status="PLACED" THEN 1 ELSE 0 END) pending_orders FROM orders',
      )
    )[0],
    users: await rows(
      "SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY created_at DESC LIMIT 100",
    ),
    chefs: await rows(
      "SELECT c.*,u.name owner_name,u.email FROM chefs c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC",
    ),
    products: await rows(
      "SELECT p.*,c.name chef_name FROM products p JOIN chefs c ON c.id=p.chef_id ORDER BY p.created_at DESC LIMIT 100",
    ),
    meals: await rows("SELECT * FROM meal_settings ORDER BY sort_order"),
    campaigns: await rows("SELECT * FROM campaigns ORDER BY created_at DESC"),
    banners: await rows("SELECT * FROM banners ORDER BY sort_order"),
    vouchers: await rows(
      "SELECT v.*,c.name chef_name FROM vouchers v JOIN chefs c ON c.id=v.chef_id",
    ),
    exceptions: await listAdminPaymentExceptions(),
    delivery: (
      await rows('SELECT value FROM platform_settings WHERE id="delivery"')
    )[0]?.value,
  };
}
