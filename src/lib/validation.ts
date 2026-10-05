import { z } from "zod";
export const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const addressSchema = point.extend({
  label: z.string().trim().min(1).max(50),
  address: z.string().trim().min(10).max(500),
  recipient: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(10).max(20),
  isDefault: z.boolean(),
});
export const loginSchema = z.object({
  email: z.email().max(190),
  password: z.string().min(1).max(128),
});
export const signupSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(100),
  password: z.string().min(10, "Mật khẩu cần ít nhất 10 ký tự.").max(128),
  next: z.string().max(1000).optional(),
});
export const checkoutSchema = point.extend({
  items: z
    .array(
      z.object({
        menuId: z.string().min(1).max(36),
        quantity: z.number().int().min(1).max(30),
      }),
    )
    .min(1)
    .max(30)
    .refine(
      (items) => new Set(items.map((x) => x.menuId)).size === items.length,
      "Món bị lặp trong giỏ.",
    ),
  address: z.string().trim().min(10, "Nhập địa chỉ giao đầy đủ.").max(500),
  recipient: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .regex(/^(\+84|0)[0-9]{9,10}$/, "Số điện thoại chưa hợp lệ."),
  note: z.string().max(500).optional(),
  voucher: z.string().max(30).optional(),
  idempotencyKey: z.string().min(8).max(100),
  expectedTotal: z.number().int().min(0).optional(),
  analytics: z
    .object({ sessionId: z.uuid(), source: z.string().max(100).default("") })
    .optional(),
});
export const chefSchema = point.extend({
  name: z.string().trim().min(2).max(100),
  bio: z.string().trim().min(10).max(1000),
  address: z.string().trim().min(10).max(500),
  area: z.string().min(2).max(150),
  radiusKm: z.number().min(0.5).max(20),
});
export const kitchenSettingsSchema = point.extend({
  address: z.string().trim().min(10).max(500),
  area: z.string().trim().min(2).max(150),
  radiusKm: z.number().min(0.5).max(20),
  bio: z.string().max(1000),
});
export const productSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().min(5).max(1000),
  ingredients: z.string().max(500).default(""),
  price: z.number().int().min(1000).max(2000000),
  imageUrl: z.url().max(1000),
  prepMinutes: z.number().int().min(5).max(180).default(25),
  active: z.boolean().default(true),
});
export const bankSchema = z.object({
  bankBin: z.string().regex(/^\d{6}$/),
  bankName: z.string().min(2).max(100),
  accountNo: z
    .string()
    .regex(/^\d{6,19}$/, "Số tài khoản phải gồm 6–19 chữ số."),
  accountName: z
    .string()
    .trim()
    .min(5)
    .max(50)
    .transform((s) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/gi, "D")
        .toUpperCase(),
    )
    .refine(
      (s) => /^[A-Z0-9 ]+$/.test(s),
      "Tên tài khoản dùng chữ không dấu và số.",
    ),
});
