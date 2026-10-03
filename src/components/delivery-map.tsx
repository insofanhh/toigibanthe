"use client";
import { useEffect, useRef, useState } from "react";
import { haversine } from "@/lib/domain";
function decodePolyline(encoded: string) {
  const points: [number, number][] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    let shift = 0,
      result = 0,
      byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}
function halfway(points: [number, number][]) {
  const distances = points
    .slice(1)
    .map((p, i) =>
      haversine(
        { lat: points[i][1], lng: points[i][0] },
        { lat: p[1], lng: p[0] },
      ),
    );
  const target = distances.reduce((a, b) => a + b, 0) / 2;
  let consumed = 0;
  for (let i = 0; i < distances.length; i++) {
    if (consumed + distances[i] >= target) {
      const t = distances[i] ? (target - consumed) / distances[i] : 0;
      return [
        points[i][0] + t * (points[i + 1][0] - points[i][0]),
        points[i][1] + t * (points[i + 1][1] - points[i][1]),
      ] as [number, number];
    }
    consumed += distances[i];
  }
  return points[0];
}
export function DeliveryMap({ order }: { order: any }) {
  const el = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  const key = process.env.NEXT_PUBLIC_GOONG_MAP_KEY;
  useEffect(() => {
    if (!key || !el.current) return;
    let stopped = false,
      map: any;
    const init = () => {
      if (stopped || !el.current) return;
      const sdk = (window as any).goongjs;
      if (!sdk) {
        setError("Không tải được bản đồ.");
        return;
      }
      try {
        sdk.accessToken = key;
        map = new sdk.Map({
          container: el.current,
          style: "https://tiles.goong.io/assets/goong_map_web.json",
          center: [order.lng, order.lat],
          zoom: 13,
        });
        const start: [number, number] = [
            Number(order.chef_lng),
            Number(order.chef_lat),
          ],
          end: [number, number] = [Number(order.lng), Number(order.lat)],
          line = order.route_polyline
            ? decodePolyline(order.route_polyline)
            : [];
        map.on("load", () => {
          if (line.length) {
            map.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                geometry: { type: "LineString", coordinates: line },
              },
            });
            map.addLayer({
              id: "route",
              type: "line",
              source: "route",
              paint: { "line-color": "#206b50", "line-width": 4 },
            });
          }
          new sdk.Marker({ color: "#206b50" }).setLngLat(start).addTo(map);
          new sdk.Marker({ color: "#df8453" }).setLngLat(end).addTo(map);
          if (["DELIVERING", "DELIVERED", "COMPLETED"].includes(order.status)) {
            const marker = document.createElement("div");
            marker.className = "truck-marker";
            marker.innerHTML =
              '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M15 6h2l3 8M5 17l5-9 5 9H5M10 8h4M8 5h3"/></svg>';
            new sdk.Marker({ element: marker })
              .setLngLat(
                order.status === "DELIVERING" && line.length
                  ? halfway(line)
                  : end,
              )
              .addTo(map);
          }
          const bounds = new sdk.LngLatBounds(start, end);
          for (const p of line) bounds.extend(p);
          map.fitBounds(bounds, { padding: 45, maxZoom: 15 });
        });
        map.on("error", () =>
          setError("Không tải được bản đồ. Kiểm tra cấu hình Goong."),
        );
      } catch {
        setError("Bản đồ chưa khả dụng.");
      }
    };
    if ((window as any).goongjs) init();
    else {
      if (!document.querySelector("[data-goong-css]")) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href =
          "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.css";
        css.dataset.goongCss = "true";
        document.head.appendChild(css);
      }
      let script =
        document.querySelector<HTMLScriptElement>("script[data-goong]");
      if (!script) {
        script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.js";
        script.dataset.goong = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", init, { once: true });
      script.addEventListener(
        "error",
        () => setError("Không tải được bản đồ."),
        { once: true },
      );
    }
    return () => {
      stopped = true;
      map?.remove();
    };
  }, [key, order.id, order.status]);
  return (
    <div>
      {key ? (
        <div ref={el} className="delivery-map" />
      ) : (
        <div className="notice">
          Bản đồ cần Goong Map key. Khoảng cách hiện được hiển thị trong thông
          tin đơn.
        </div>
      )}
      {error && <p className="muted small">{error}</p>}
      {order.status === "DELIVERING" && (
        <p className="muted small">
          Biểu tượng giao ở giữa tuyến chỉ minh họa trạng thái, chưa phải GPS
          người giao.
        </p>
      )}
    </div>
  );
}
