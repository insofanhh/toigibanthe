// Keep phone photos out of the API request until they have been resized locally.
export const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const AVATAR_UPLOAD_MAX_BYTES = 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateAvatarSource(file: Pick<File, "type" | "size">) {
  if (!TYPES.includes(file.type))
    throw new Error("Chọn ảnh JPG, PNG hoặc WebP để làm ảnh đại diện.");
  if (!file.size) throw new Error("Ảnh đã chọn trống. Hãy chọn ảnh khác.");
  if (file.size > AVATAR_SOURCE_MAX_BYTES)
    throw new Error("Ảnh gốc vượt quá 20 MB. Hãy chọn ảnh nhỏ hơn.");
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = image.onerror = null;
      image.src = "";
      reject(new Error("Đọc ảnh quá lâu. Hãy chọn ảnh khác hoặc thử lại."));
    }, 30000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error("Không đọc được ảnh. Hãy chọn ảnh JPG, PNG hoặc WebP khác."),
      );
    };
    image.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || !blob.size)
          reject(
            new Error(
              "Không thể xử lý ảnh trên thiết bị này. Hãy thử ảnh khác.",
            ),
          );
        else resolve(blob);
      },
      type,
      0.85,
    );
  });
}

export async function prepareAvatarUpload(file: File): Promise<File> {
  validateAvatarSource(file);
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    // Browser image decoding applies EXIF orientation, including iPhone photos.
    const image = await decodeImage(url);
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > 64_000_000)
      throw new Error(
        "Ảnh có kích thước quá lớn hoặc không hợp lệ. Hãy chọn ảnh khác.",
      );
    const crop = Math.min(width, height);
    canvas.width = canvas.height = Math.min(512, crop);
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "Thiết bị chưa hỗ trợ xử lý ảnh. Hãy thử trình duyệt khác.",
      );
    context.drawImage(
      image,
      (width - crop) / 2,
      (height - crop) / 2,
      crop,
      crop,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let blob = await encode(canvas, "image/webp");
    if (blob.type !== "image/webp") {
      // Older Safari can return PNG when WebP encoding is unavailable.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
      blob = await encode(canvas, "image/jpeg");
    }
    if (
      !["image/webp", "image/jpeg"].includes(blob.type) ||
      blob.size > AVATAR_UPLOAD_MAX_BYTES
    )
      throw new Error("Chưa giảm được dung lượng ảnh. Hãy chọn ảnh nhỏ hơn.");
    return new File(
      [blob],
      blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg",
      { type: blob.type },
    );
  } finally {
    URL.revokeObjectURL(url);
    // Release the canvas backing buffer promptly on memory constrained phones.
    canvas.width = canvas.height = 0;
  }
}
