import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rows, exec, type DB } from "./db";
import {
  defaultHomePopupSettings,
  safePopupHref,
  type HomePopupSettings,
} from "./home-popup-domain";

const text = (max: number) => z.string().trim().max(max);
const image = text(1500).refine(
  (x) => !x || /^https:\/\/[^\s]+$/i.test(x),
  "Ảnh phải là URL HTTPS.",
);
export const homePopupSchema = z
  .object({
    frequency: z.enum(["session", "daily", "weekly"]),
    priority: z.enum(["install", "promotion"]),
    delaySeconds: z.number().int().min(0).max(30),
    install: z.object({
      enabled: z.boolean(),
      title: text(100).min(1),
      description: text(300),
      showVideo: z.boolean(),
    }),
    promotion: z.object({
      enabled: z.boolean(),
      title: text(100),
      description: text(500),
      imageUrl: image,
      buttonText: text(40).min(1),
      href: text(255).refine(
        safePopupHref,
        "Chọn đường dẫn trong ứng dụng, ví dụ /offers.",
      ),
      startsAt: z.iso.datetime().nullable(),
      endsAt: z.iso.datetime().nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    const p = value.promotion;
    if (p.enabled && !p.title)
      ctx.addIssue({
        code: "custom",
        path: ["promotion", "title"],
        message: "Nhập tên chương trình trước khi bật popup.",
      });
    if (p.enabled && !p.imageUrl)
      ctx.addIssue({
        code: "custom",
        path: ["promotion", "imageUrl"],
        message: "Tải ảnh chương trình trước khi bật popup.",
      });
    if (
      p.startsAt &&
      p.endsAt &&
      Date.parse(p.endsAt) <= Date.parse(p.startsAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["promotion", "endsAt"],
        message: "Thời gian kết thúc phải sau thời gian bắt đầu.",
      });
  });
export async function getHomePopupSettings(
  db?: DB,
): Promise<HomePopupSettings> {
  const record = (
    await rows<{ value: unknown }>(
      "SELECT value FROM platform_settings WHERE id='home-popups'",
      [],
      db,
    )
  )[0];
  if (!record) return structuredClone(defaultHomePopupSettings);
  try {
    const value =
      typeof record.value === "string"
        ? JSON.parse(record.value)
        : record.value;
    const parsed = homePopupSchema.parse(value);
    const version =
      value &&
      typeof value === "object" &&
      "version" in value &&
      typeof value.version === "string"
        ? value.version
        : "initial";
    return { ...parsed, version };
  } catch {
    return structuredClone(defaultHomePopupSettings);
  }
}
export async function saveHomePopupSettings(input: unknown, db: DB) {
  const settings = { ...homePopupSchema.parse(input), version: randomUUID() };
  await exec(
    "INSERT INTO platform_settings (id,value) VALUES ('home-popups',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
    [JSON.stringify(settings)],
    db,
  );
  return settings;
}
