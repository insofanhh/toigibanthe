import { sqlDate } from "../src/lib/db";
import { cutoffAt, serviceDate, type MealId } from "../src/lib/domain";

export type SeedClock = {
  now(): string;
  date(): string;
  inDays(days: number): string;
  cutoff(time: string, offset: number): string;
};
export async function seedDemo(
  exec: (sql: string, values: unknown[], db?: undefined) => Promise<unknown>,
  password: string,
  clock: SeedClock = {
    now: () => sqlDate(),
    date: () => serviceDate(),
    inDays: (days) => sqlDate(new Date(Date.now() + days * 86400000)),
    cutoff: (time, offset) => sqlDate(cutoffAt(serviceDate(), time, offset)),
  },
) {
  const now = clock.now(),
    date = clock.date(),
    db = undefined;
  const users = [
    ["dev-user", "Linh Nguyễn", "user@toigibando.local", "user"],
    ["dev-admin", "Quản trị viên", "admin@toigibando.local", "admin"],
    ["dev-chef-1", "Minh Anh", "chef@toigibando.local", "chef"],
    ["dev-chef-2", "Hoàng Nam", "nam@toigibando.local", "chef"],
    ["dev-chef-3", "Thu Hà", "ha@toigibando.local", "chef"],
    ["dev-chef-4", "Khánh Linh", "linh@toigibando.local", "chef"],
  ];
  for (const [id, name, email, role] of users)
    await exec(
      "INSERT IGNORE INTO users (id,name,email,password_hash,phone,role,created_at) VALUES (?,?,?,?,?,?,?)",
      [id, name, email, password, "0900000000", role, now],
      db,
    );
  const meals: [MealId, string, string, number][] = [
    ["breakfast", "Bữa sáng", "11:00", 0],
    ["lunch", "Bữa trưa", "15:00", 0],
    ["dinner", "Bữa tối", "21:00", 0],
    ["late", "Quẩy đêm", "01:00", 1],
  ];
  for (let i = 0; i < meals.length; i++) {
    const [id, name, time, offset] = meals[i];
    await exec(
      "INSERT IGNORE INTO meal_settings VALUES (?,?,?,?,?)",
      [id, name, time, offset, i],
      db,
    );
  }
  const photo = (id: string) =>
    `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=80`;
  const chefs = [
    [
      "chef-1",
      "dev-chef-1",
      "Bếp Minh Anh",
      "Cơm nhà và món Việt, nấu mới mỗi bữa.",
      "45 Nguyễn Đình Chiểu, TP. Hồ Chí Minh",
      "Đa Kao",
      10.7862,
      106.6941,
      "photo-1580489944761-15a19d654956",
    ],
    [
      "chef-2",
      "dev-chef-2",
      "Bếp của Nam",
      "Các món bún, phở và món nóng hàng ngày.",
      "120 Võ Văn Tần, TP. Hồ Chí Minh",
      "Võ Thị Sáu",
      10.7757,
      106.6843,
      "photo-1500648767791-00dcc994a43e",
    ],
    [
      "chef-3",
      "dev-chef-3",
      "Bếp Thu Hà",
      "Món thanh nhẹ và phần ăn đủ dinh dưỡng.",
      "20 Trần Quốc Thảo, TP. Hồ Chí Minh",
      "Võ Thị Sáu",
      10.7802,
      106.6878,
      "photo-1438761681033-6461ffad8d80",
    ],
    [
      "chef-4",
      "dev-chef-4",
      "Bếp Khánh Linh",
      "Món Việt theo ngày, nhận giao trong khu vực.",
      "90 Lê Văn Sỹ, TP. Hồ Chí Minh",
      "Nhiêu Lộc",
      10.7918,
      106.6705,
      "photo-1534528741775-53994a69daeb",
    ],
  ];
  for (let i = 0; i < chefs.length; i++) {
    const [id, user, name, bio, address, area, lat, lng, img] = chefs[i];
    await exec(
      "INSERT IGNORE INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,avatar_url,rating,rating_count,completed_orders,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        user,
        name,
        bio,
        address,
        area,
        lat,
        lng,
        "approved",
        photo(String(img)),
        4.7 + (i % 2) * 0.1,
        58 + i * 17,
        120 + i * 34,
        now,
      ],
      db,
    );
  }
  const campaign = "campaign-week";
  await exec(
    "INSERT IGNORE INTO campaigns VALUES (?,?,?,?,?,?)",
    [
      campaign,
      "Ưu đãi thực đơn hôm nay",
      true,
      clock.inDays(-1),
      clock.inDays(7),
      now,
    ],
    db,
  );
  const foods: [string, string, number, number, string, MealId][] = [
    [
      "Cơm gà sốt gừng",
      "Cơm nóng, gà áp chảo, rau theo ngày.",
      45000,
      0,
      "photo-1547592180-85f173990554",
      "lunch",
    ],
    [
      "Bún bò Huế",
      "Bún bò, nước dùng hầm và rau ăn kèm.",
      55000,
      1,
      "photo-1555126634-323283e090fa",
      "lunch",
    ],
    [
      "Salad gà áp chảo",
      "Rau tươi, gà áp chảo và sốt mè.",
      49000,
      2,
      "photo-1512621776951-a57141f2eefd",
      "lunch",
    ],
    [
      "Cơm thịt kho trứng",
      "Thịt kho, trứng, cơm trắng và canh.",
      42000,
      3,
      "photo-1511690743698-d9d85f2fbf38",
      "lunch",
    ],
    [
      "Bún chả Hà Nội",
      "Chả nướng, bún và nước chấm pha riêng.",
      50000,
      0,
      "photo-1569718212165-3a8278d5f624",
      "lunch",
    ],
    [
      "Cơm cá hồi áp chảo",
      "Cá hồi, cơm và rau củ.",
      69000,
      2,
      "photo-1467003909585-2f8a72700288",
      "dinner",
    ],
    [
      "Mì xào rau củ",
      "Mì xào với rau củ và nấm.",
      39000,
      1,
      "photo-1569718212165-3a8278d5f624",
      "dinner",
    ],
    [
      "Cơm bò xào",
      "Thịt bò xào rau, cơm và canh.",
      55000,
      3,
      "photo-1547592180-85f173990554",
      "dinner",
    ],
    [
      "Gỏi cuốn tôm thịt",
      "Cuốn tươi, rau và sốt chấm.",
      35000,
      2,
      "photo-1512621776951-a57141f2eefd",
      "dinner",
    ],
    [
      "Cháo gà nấm",
      "Cháo nóng, gà xé và nấm.",
      32000,
      0,
      "photo-1511690743698-d9d85f2fbf38",
      "late",
    ],
    [
      "Bánh mì trứng",
      "Bánh mì giòn, trứng và rau.",
      25000,
      1,
      "photo-1525351484163-7529414344d8",
      "breakfast",
    ],
    [
      "Bánh cuốn nóng",
      "Bánh cuốn, chả và hành phi.",
      35000,
      3,
      "photo-1569718212165-3a8278d5f624",
      "breakfast",
    ],
    [
      "Cơm gà rau củ",
      "Gà nướng, rau củ và cơm.",
      47000,
      0,
      "photo-1547592180-85f173990554",
      "lunch",
    ],
    [
      "Bún rau nấm",
      "Bún, nấm và rau tươi.",
      38000,
      2,
      "photo-1512621776951-a57141f2eefd",
      "lunch",
    ],
    [
      "Cơm sườn nướng",
      "Sườn nướng, cơm và đồ chua.",
      49000,
      3,
      "photo-1511690743698-d9d85f2fbf38",
      "lunch",
    ],
    [
      "Phở bò",
      "Phở bò và nước dùng nóng.",
      52000,
      1,
      "photo-1555126634-323283e090fa",
      "late",
    ],
  ];
  for (let i = 0; i < chefs.length; i++)
    await exec(
      "INSERT IGNORE INTO kitchen_sessions VALUES (?,?,?,?,?)",
      [`session-${i}`, chefs[i][0], date, true, now],
      db,
    );
  for (let i = 0; i < foods.length; i++) {
    const [name, description, price, chef, image, meal] = foods[i];
    const product = `dish-${i + 1}`,
      m = meals.find((x) => x[0] === meal)!;
    await exec(
      "INSERT IGNORE INTO products (id,chef_id,name,description,ingredients,price,image_url,rating,rating_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        product,
        chefs[chef][0],
        name,
        description,
        "Liên hệ bếp nếu bạn có dị ứng thực phẩm.",
        price,
        photo(image),
        4.6 + (i % 4) * 0.1,
        24 + i * 5,
        now,
      ],
      db,
    );
    await exec(
      "INSERT IGNORE INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)",
      [
        `menu-${i + 1}`,
        `session-${chef}`,
        product,
        meal,
        clock.cutoff(m[2], m[3]),
        15 + (i % 10),
        i % 3 === 0 ? price - 10000 : null,
        i % 3 === 0 ? campaign : null,
        true,
      ],
      db,
    );
  }
  await exec(
    "INSERT IGNORE INTO banners VALUES (?,?,?,?,?,?,?)",
    [
      "banner-1",
      "Thực đơn hôm nay",
      "Xem món đang được các bếp nhận đặt trong khu vực.",
      null,
      "/nearby",
      true,
      0,
    ],
    db,
  );
  await exec(
    "INSERT IGNORE INTO platform_settings VALUES (?,?)",
    ["delivery", JSON.stringify({ baseFee: 15000, perKm: 0 })],
    db,
  );
  await exec(
    "INSERT IGNORE INTO platform_settings VALUES (?,?)",
    ["support", JSON.stringify({ email: "hotro@toigibando.vn", phone: "" })],
    db,
  );
  await exec(
    "INSERT IGNORE INTO vouchers VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      "voucher-1",
      "BEP10",
      "Giảm 10.000đ tại Bếp Minh Anh",
      "chef-1",
      10000,
      50000,
      100,
      0,
      clock.inDays(30),
      true,
    ],
    db,
  );
  await exec(
    "INSERT IGNORE INTO notifications VALUES (?,?,?,?,?,?,?,?)",
    [
      "demo-welcome",
      "dev-user",
      "news",
      "Thông tin tài khoản",
      "Bạn có thể lưu địa chỉ giao trong mục Tôi.",
      "/me",
      false,
      now,
    ],
    db,
  );
  return users.map((user) => user[2]);
}
