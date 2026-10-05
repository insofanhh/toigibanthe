"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Maximize, Star } from "lucide-react";
import type { ChefMapFeed, Location, MapChef } from "@/lib/domain";
import { loadGoongSDK } from "@/lib/goong-sdk";
import { useApp } from "./providers";
import { Link } from "./page-motion";
import { BackgroundRefreshNotice, Notice, PageTitle, useLoad } from "./app";

function distance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function Avatar({ chef }: { chef: MapChef }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [chef.avatar]);
  return (
    <span className="chef-map-avatar" aria-hidden="true">
      {chef.avatar && !failed ? (
        <img src={chef.avatar} alt="" onError={() => setFailed(true)} />
      ) : (
        chef.name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

type MarkerEntry = {
  marker: any;
  button: HTMLButtonElement;
  signature: string;
};

function ChefMap({
  location,
  chefs,
  selected,
  focusId,
  onSelect,
}: {
  location: Location;
  chefs: MapChef[];
  selected: string | null;
  focusId: string | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const sdk = useRef<any>(null);
  const markers = useRef(new Map<string, MarkerEntry>());
  const userMarker = useRef<any>(null);
  const latest = useRef({ location, chefs, selected, onSelect });
  latest.current = { location, chefs, selected, onSelect };
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const key = process.env.NEXT_PUBLIC_GOONG_MAP_KEY;

  function fitAll() {
    if (!map.current || !sdk.current) return;
    const { location: point, chefs: list } = latest.current;
    const bounds = new sdk.current.LngLatBounds(
      [point.lng, point.lat],
      [point.lng, point.lat],
    );
    for (const chef of list) bounds.extend([chef.lng, chef.lat]);
    map.current.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 0 });
  }

  useEffect(() => {
    if (!key) return;
    let active = true;
    let observer: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    loadGoongSDK()
      .then((goong) => {
        if (!active || !container.current) return;
        sdk.current = goong;
        goong.accessToken = key;
        const point = latest.current.location;
        const instance = new goong.Map({
          container: container.current,
          style: "https://tiles.goong.io/assets/goong_map_web.json",
          center: [point.lng, point.lat],
          zoom: 13,
        });
        map.current = instance;
        instance.addControl(
          new goong.NavigationControl({ showCompass: false }),
          "top-right",
        );
        timeout = setTimeout(() => {
          if (active)
            setError(
              "Bản đồ tải chậm. Bạn có thể chọn bếp trong danh sách bên dưới.",
            );
        }, 15000);
        instance.on("load", () => {
          if (!active) return;
          clearTimeout(timeout);
          setReady(true);
          setError("");
          instance.resize();
        });
        instance.on("error", () => {
          if (active)
            setError(
              "Không tải được một phần bản đồ. Bạn vẫn có thể xem danh sách bếp bên dưới.",
            );
        });
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(container.current);
      })
      .catch(() => {
        if (active)
          setError(
            "Không tải được bản đồ. Bạn vẫn có thể xem danh sách bếp bên dưới.",
          );
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      observer?.disconnect();
      for (const entry of markers.current.values()) entry.marker.remove();
      markers.current.clear();
      userMarker.current?.remove();
      userMarker.current = null;
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
  }, [key]);

  useEffect(() => {
    if (!ready || !map.current || !sdk.current) return;
    const goong = sdk.current;
    if (!userMarker.current) {
      const element = document.createElement("div");
      element.className = "chef-map-user";
      element.setAttribute("aria-label", "Vị trí giao đến của bạn");
      const label = document.createElement("span");
      label.textContent = "Giao đến";
      element.appendChild(label);
      userMarker.current = new goong.Marker({ element, anchor: "center" })
        .setLngLat([location.lng, location.lat])
        .addTo(map.current);
    }
    const ids = new Set(chefs.map((c) => c.id));
    for (const [id, entry] of markers.current) {
      if (!ids.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    for (const chef of chefs) {
      const signature = JSON.stringify([chef.name, chef.avatar]);
      let entry = markers.current.get(chef.id);
      if (entry && entry.signature !== signature) {
        entry.marker.remove();
        markers.current.delete(chef.id);
        entry = undefined;
      }
      if (!entry) {
        const element = document.createElement("div");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chef-map-pin";
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          latest.current.onSelect(chef.id);
          map.current?.flyTo({
            center: [chef.lng, chef.lat],
            zoom: Math.max(map.current.getZoom(), 14),
            duration: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? 0
              : 450,
          });
        });
        const avatar = document.createElement("span");
        avatar.className = "chef-map-pin-avatar";
        avatar.textContent = chef.name.trim().charAt(0).toUpperCase();
        if (chef.avatar) {
          const img = document.createElement("img");
          img.src = chef.avatar;
          img.alt = "";
          img.addEventListener("error", () => img.remove(), { once: true });
          avatar.appendChild(img);
        }
        const label = document.createElement("span");
        label.className = "chef-map-pin-label";
        label.textContent = chef.name;
        button.append(avatar, label);
        element.appendChild(button);
        entry = {
          marker: new goong.Marker({ element, anchor: "bottom" })
            .setLngLat([chef.lng, chef.lat])
            .addTo(map.current),
          button,
          signature,
        };
        markers.current.set(chef.id, entry);
      }
      entry.marker.setLngLat([chef.lng, chef.lat]);
      entry.button.classList.toggle("is-selected", chef.id === selected);
      entry.button.classList.toggle("is-nearest", chef.id === chefs[0]?.id);
      // The SDK owns the marker transform; only adjust its stacking order.
      if (entry.button.parentElement)
        entry.button.parentElement.style.zIndex =
          chef.id === selected ? "3" : chef.id === chefs[0]?.id ? "2" : "1";
      entry.button.setAttribute("aria-pressed", String(chef.id === selected));
      entry.button.setAttribute(
        "aria-label",
        `${chef.name}, ${distance(chef.distance)}${chef.id === chefs[0]?.id ? ", gần nhất" : ""}`,
      );
      entry.button.title = `${chef.name} · ${distance(chef.distance)}`;
    }
    // Fit once after the first response; background refreshes preserve the camera.
    if (!fitted.current) {
      fitAll();
      fitted.current = true;
    }
  }, [ready, chefs, selected, location]);

  useEffect(() => {
    const chef = latest.current.chefs.find((c) => c.id === focusId);
    if (!ready || !chef || !map.current) return;
    map.current.flyTo({
      center: [chef.lng, chef.lat],
      zoom: Math.max(map.current.getZoom(), 14),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 450,
    });
  }, [focusId, ready]);

  return (
    <div className="chef-map-panel">
      {!key ? (
        <Notice>
          Chưa cấu hình bản đồ. Bạn vẫn có thể xem các bếp đủ điều kiện giao
          hàng bên dưới.
        </Notice>
      ) : (
        <>
          <div
            ref={container}
            className="chef-map-canvas"
            role="region"
            aria-label="Bản đồ các bếp có thể giao đến bạn"
          />
          {!ready && !error && (
            <div className="chef-map-loading" role="status">
              Đang tải bản đồ…
            </div>
          )}
          {error && (
            <div className="chef-map-error" role="status">
              {error}
            </div>
          )}
          {ready && (
            <div className="chef-map-controls">
              <button
                type="button"
                onClick={() =>
                  map.current?.flyTo({
                    center: [location.lng, location.lat],
                    zoom: 15,
                    duration: 0,
                  })
                }
              >
                <LocateFixed size={16} /> Vị trí của tôi
              </button>
              <button type="button" onClick={fitAll}>
                <Maximize size={16} /> Xem tất cả
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ChefMapPage() {
  const { location, storageReady, authReady, setLocationOpen, revision } =
    useApp();
  const load = useLoad<ChefMapFeed>(
    location
      ? `catalog/chefs-map?lat=${location.lat}&lng=${location.lng}`
      : null,
    [revision],
  );
  const chefs = load.data?.chefs || [];
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const pointKey = location ? `${location.lat},${location.lng}` : "";
  useEffect(() => {
    setSelected(null);
    setLimit(20);
  }, [pointKey]);
  useEffect(() => {
    // Revalidate a cached map on return without replacing its visible content.
    if (load.data) load.reload();
  }, [pointKey]);
  const current = chefs.find((c) => c.id === selected) || chefs[0];
  function select(id: string) {
    setSelected(id);
    const index = chefs.findIndex((c) => c.id === id);
    if (index >= limit) setLimit(index + 1);
  }

  return (
    <div className="chef-map-page">
      <PageTitle title="Bếp gần bạn" back />
      {!storageReady || !authReady ? (
        <div className="loading">Đang tải vị trí giao hàng…</div>
      ) : !location ? (
        <div className="chef-map-empty">
          <MapPin size={32} />
          <h2>Chọn vị trí giao hàng</h2>
          <p>Cần địa chỉ của bạn để tìm bếp trong bán kính giao hàng.</p>
          <button className="button" onClick={() => setLocationOpen(true)}>
            Chọn địa chỉ
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="chef-map-address"
            onClick={() => setLocationOpen(true)}
          >
            <MapPin size={19} />
            <span>
              <small>Giao đến</small>
              <strong>
                {location.address || "Đã xác định vị trí giao hàng"}
              </strong>
            </span>
            <b>Đổi</b>
          </button>
          {!load.data ? (
            load.error ? (
              <Notice error>
                {load.error}{" "}
                <button className="text-button" onClick={load.reload}>
                  Thử lại
                </button>
              </Notice>
            ) : (
              <div className="loading">
                Đang tìm các bếp có thể giao đến bạn…
              </div>
            )
          ) : (
            <>
              <BackgroundRefreshNotice loads={[load]} />
              <ChefMap
                key={pointKey}
                location={location}
                chefs={chefs}
                selected={current?.id || null}
                focusId={selected}
                onSelect={select}
              />
              {current && (
                <div className="chef-map-selected">
                  <Avatar chef={current} />
                  <div>
                    <h2>{current.name}</h2>
                    <p>
                      {distance(current.distance)}
                      {current.id === chefs[0]?.id ? " · Gần nhất" : ""}
                    </p>
                    <small>{current.area}</small>
                  </div>
                  <Link href={`/chefs/${current.id}`} className="button">
                    Xem thực đơn
                  </Link>
                </div>
              )}
              <section
                className="chef-map-results"
                aria-label="Danh sách bếp gần bạn"
              >
                <h2>
                  Bếp có thể giao đến bạn <span>{chefs.length}</span>
                </h2>
                <p className="chef-map-hint">
                  Từ gần đến xa · Khoảng cách theo vị trí, không phải quãng
                  đường di chuyển.
                </p>
                {!chefs.length ? (
                  <div className="chef-map-empty">
                    <p>
                      Chưa có bếp đang mở và còn món trong bán kính giao đến địa
                      chỉ này.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setLocationOpen(true)}
                    >
                      Đổi địa chỉ giao hàng
                    </button>
                  </div>
                ) : (
                  chefs.slice(0, limit).map((chef, i) => (
                    <button
                      type="button"
                      key={chef.id}
                      className={`chef-map-row ${current?.id === chef.id ? "is-selected" : ""}`}
                      aria-pressed={current?.id === chef.id}
                      onClick={() => {
                        select(chef.id);
                      }}
                    >
                      <Avatar chef={chef} />
                      <span className="chef-map-row-info">
                        <strong>{chef.name}</strong>
                        <small>{chef.area}</small>
                        <span>
                          <Star size={13} />{" "}
                          {chef.ratingCount
                            ? Number(chef.rating).toFixed(1)
                            : "Chưa có đánh giá"}
                          {i === 0 && <em>Gần nhất</em>}
                        </span>
                      </span>
                      <b>{distance(chef.distance)}</b>
                    </button>
                  ))
                )}
                {limit < chefs.length && (
                  <button
                    className="button secondary chef-map-more"
                    onClick={() => setLimit((n) => n + 20)}
                  >
                    Xem thêm bếp
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
