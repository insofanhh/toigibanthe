// Generates original illustrated Safari/Chrome install guides. Requires ffmpeg on PATH.
// Usage: node scripts/generate-install-guides.mjs
import sharp from "sharp";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { once } from "node:events";

const width = 480,
  height = 640,
  fps = 12,
  seconds = 12;
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const text = (x, y, value, size = 16, color = "#25362d", weight = 400) =>
  `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(value)}</text>`;
const rect = (x, y, w, h, fill, rx = 0, stroke = "none") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
function appIcon(x, y, size = 48) {
  return `${rect(x, y, size, size, "#206b50", size * 0.22)}<g transform="translate(${x + size * 0.2} ${y + size * 0.18}) scale(${size / 50})" stroke="#fff" stroke-width="2" fill="none"><path d="M6 18C-2 17-2 6 7 6c1-8 15-8 17 0 9-1 11 10 3 12v10H6Z"/><path d="M6 23h21"/></g>`;
}
function frame(platform, time) {
  const ios = platform === "ios",
    stage = Math.min(3, Math.floor(time / 3));
  const progress = (time % 3) / 3;
  const labels = ios
    ? [
        "Mở website bằng Safari",
        "Chia sẻ → Thêm vào Màn hình chính",
        "Xác nhận bằng nút Thêm",
        "Mở app từ màn hình chính",
      ]
    : [
        "Mở website bằng Chrome",
        "Menu → Cài đặt ứng dụng",
        "Xác nhận bằng nút Cài đặt",
        "Mở app từ màn hình chính",
      ];
  const tap = (x, y) =>
    `<circle cx="${x}" cy="${y}" r="${13 + progress * 8}" fill="#eab85855" stroke="#dba237" stroke-width="2"/>`;
  let scene = `${rect(0, 0, width, height, "#edf5ef", 20)}${text(28, 35, ios ? "iPhone / iPad · Safari" : "Android · Chrome", 19, "#206b50", 500)}${rect(91, 56, 298, 514, "#25362d", 34)}${rect(99, 65, 282, 494, "#fafbf8", 27)}${text(115, 88, "9:41", 12)}${rect(204, 71, 77, 12, "#25362d", 6)}${text(344, 88, "▰", 12)}${rect(111, 103, 258, 34, "#edf5ef", 10)}${text(123, 126, "Tôi gì, bạn đó!", 13, "#206b50")}`;
  if (!ios)
    scene += `${text(347, 127, "⋮", 23)}${stage === 0 ? tap(352, 120) : ""}`;
  scene += `${appIcon(114, 157, 38)}${text(164, 181, "Bếp gần bạn", 18, "#25362d", 500)}${text(114, 222, "Món đang nhận đặt", 15)}${rect(114, 238, 118, 91, "#d3e5d8", 12)}${rect(245, 238, 118, 91, "#e8dbc8", 12)}${text(124, 282, "Bữa trưa", 13, "#206b50")}${text(254, 282, "Bữa tối", 13, "#725837")}${rect(114, 345, 249, 52, "#fff", 10, "#e7eae3")}${text(126, 367, "Giao đến", 11, "#788279")}${text(126, 386, "Địa chỉ của bạn", 13)}${rect(111, 464, 258, 38, "#fff", 7)}${text(122, 489, "Home     Đơn     Thích     Tôi", 12, "#788279")}`;
  if (ios)
    scene += `${rect(111, 511, 258, 31, "#e9edeb", 8)}<g stroke="#206b50" fill="none" stroke-width="2"><path d="M239 532h-11v-14h5m6 14h11v-14h-5M239 525v-16m-5 5 5-5 5 5"/></g>${stage === 0 ? tap(239, 525) : ""}`;
  if (stage === 1) {
    scene += `${rect(100, 143, 280, 401, "#0004", 24)}${rect(105, 320, 270, 224, "#fff", 20)}${text(122, 350, ios ? "Chia sẻ" : "Menu Chrome", 17, "#25362d", 500)}${rect(117, 368, 246, 39, "#f4f6f4", 8)}${text(126, 393, ios ? "Sao chép liên kết" : "Tab mới", 14)}${rect(117, 416, 246, 58, "#edf5ef", 8, "#206b50")}${text(127, 441, ios ? "+ Thêm vào Màn hình chính" : "+ Cài đặt ứng dụng", 13, "#206b50", 500)}${text(127, 459, ios ? "Thêm website thành app" : "Có thể ghi: Thêm vào màn hình chính", 10, "#788279")}${text(126, 511, ios ? "Sửa tác vụ…" : "Cài đặt", 13, "#788279")}${tap(270, 442)}`;
  }
  if (stage === 2) {
    scene += `${rect(100, 143, 280, 401, "#0005", 24)}${rect(119, 227, 242, 241, "#fff", 20)}${text(135, 258, ios ? "Thêm vào Màn hình chính" : "Cài đặt ứng dụng", 15, "#25362d", 500)}${appIcon(216, 279, 48)}${text(167, 354, "Tôi gì, bạn đó!", 17, "#25362d", 500)}${text(152, 380, "Mở nhanh từ màn hình chính", 12, "#788279")}${rect(143, 407, 193, 41, "#206b50", 9)}${text(214, 433, ios ? "Thêm" : "Cài đặt", 16, "#fff", 500)}${tap(286, 429)}`;
  }
  if (stage === 3) {
    scene += `${rect(100, 100, 280, 444, "#e3ede5", 24)}`;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++)
        scene += rect(
          116 + col * 65,
          142 + row * 76,
          45,
          45,
          ["#b9d5c0", "#d9cbb6", "#b9cddd", "#d7c1c5"][(row + col) % 4],
          12,
        );
    scene += `${rect(156, 376, 168, 109, "#edf5ef", 16, "#206b50")}${appIcon(216, 388, 48)}${text(170, 460, "Tôi gì, bạn đó!", 16, "#206b50", 500)}${tap(247, 414)}${text(154, 519, "Ứng dụng trên màn hình chính", 12, "#788279")}`;
  }
  scene +=
    rect(114, 550, 251, 3, "#e7eae3", 2) +
    rect(114, 550, 251 * (time / seconds), 3, "#206b50", 2);
  scene +=
    text(27, 602, `${stage + 1}/4  ${labels[stage]}`, 17, "#206b50", 500) +
    text(
      27,
      626,
      "Video minh họa · Menu có thể khác theo phiên bản",
      12,
      "#788279",
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${scene}</svg>`;
}
for (const platform of ["ios", "android"]) {
  const output = new URL(
    `../public/install-guide-${platform}.mp4`,
    import.meta.url,
  );
  const ffmpeg = spawn(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-framerate",
      String(fps),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "25",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output.pathname.replace(/^\/(?=[A-Za-z]:)/, ""),
    ],
    { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
  );
  let errors = "";
  ffmpeg.stderr.on("data", (data) => (errors += data));
  const done = new Promise((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(errors || `ffmpeg exit ${code}`)),
    );
  });
  // Handle failed processes promptly, while frames are being rendered.
  done.catch(() => {});
  for (let i = 0; i < fps * seconds; i++) {
    const png = await sharp(Buffer.from(frame(platform, i / fps)))
      .png()
      .toBuffer();
    if (i === 0)
      await writeFile(
        new URL(`../public/install-guide-${platform}.webp`, import.meta.url),
        await sharp(png).webp({ quality: 85 }).toBuffer(),
      );
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
  }
  ffmpeg.stdin.end();
  await done;
  console.log(`Generated ${platform} guide`);
}
