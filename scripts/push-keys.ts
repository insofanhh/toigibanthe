import webpush from "web-push";
import { mkdir, writeFile, access } from "node:fs/promises";
const dir = new URL("../.local/push-keys/", import.meta.url);
await mkdir(dir, { recursive: true });
try {
  await access(new URL("VAPID_PRIVATE_KEY.txt", dir));
  console.log(
    "Đã có bộ khóa tại .local/push-keys. Giữ nguyên khóa đang dùng; không tạo lại.",
  );
} catch {
  const keys = webpush.generateVAPIDKeys();
  for (const [name, value] of Object.entries({
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "https://toigibanthe.vercel.app",
  }))
    await writeFile(new URL(name + ".txt", dir), value, { flag: "wx" });
  console.log(
    "Đã tạo 3 tệp khóa trong .local/push-keys (không đưa lên Git). Dùng cùng bộ khóa cho web và realtime.",
  );
}
