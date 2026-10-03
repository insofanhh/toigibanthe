import type { Location } from "./domain";
export type ResolvedLocation = Location & { area?: string };
export function goongArea(place: {
  compound?: { commune?: string; province?: string };
}) {
  return [place.compound?.commune, place.compound?.province]
    .filter(Boolean)
    .join(", ");
}

export const isUnresolvedLocation = (address: string) =>
  address === "Vị trí hiện tại" || address.startsWith("Tọa độ:");

export async function reverseLocation(
  lat: number,
  lng: number,
): Promise<ResolvedLocation> {
  const response = await fetch(`/api/location?lat=${lat}&lng=${lng}`, {
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Không tìm được địa chỉ từ vị trí này.");
  const place = data.results?.find((r: { formatted_address?: string }) =>
    r.formatted_address?.trim(),
  );
  const address = place?.formatted_address;
  if (!address)
    throw new Error("Không tìm được địa chỉ. Hãy tìm và chọn địa chỉ giao.");
  return { address, lat, lng, area: goongArea(place) || undefined };
}

export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error("Trình duyệt chưa hỗ trợ định vị. Hãy tìm địa chỉ giao."),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      () =>
        reject(
          new Error(
            "Không lấy được GPS. Hãy cho phép truy cập vị trí hoặc tìm địa chỉ giao.",
          ),
        ),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      },
    );
  });
}
