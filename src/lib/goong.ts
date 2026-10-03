import { AppError } from "./http";
export async function goong(path: string, params: Record<string, string>) {
  if (!process.env.GOONG_API_KEY)
    throw new AppError(
      "Bản đồ chưa được cấu hình. Bạn có thể nhập địa chỉ và tọa độ thủ công.",
      503,
    );
  const url = new URL(`https://rsapi.goong.io/v2/${path}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  url.searchParams.set("api_key", process.env.GOONG_API_KEY);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      "Không lấy được thông tin bản đồ. Vui lòng thử lại.",
      502,
    );
  return response.json();
}
export async function direction(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
) {
  const result = await goong("direction", {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${dest.lat},${dest.lng}`,
    vehicle: "bike",
  });
  const route = result.routes?.[0],
    leg = route?.legs?.[0];
  if (!leg)
    throw new AppError("Chưa tìm được đường giao tới địa chỉ này.", 400);
  return {
    distanceKm: leg.distance.value / 1000,
    durationSeconds: leg.duration.value,
    polyline: route.overview_polyline?.points || "",
  };
}
