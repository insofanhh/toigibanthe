"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import { loadGoongSDK } from "@/lib/goong-sdk";
import {
  currentPosition,
  goongArea,
  reverseLocation,
  type ResolvedLocation,
} from "@/lib/location-client";
import { request } from "./providers";

type Props = {
  value: ResolvedLocation | null;
  onChange: (value: ResolvedLocation | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
};
type Suggestion = { place_id: string; description: string };

export function KitchenLocationPicker({
  value,
  onChange,
  onBusyChange,
  disabled = false,
}: Props) {
  const [text, setText] = useState(value?.address || "");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapPoint, setMapPoint] = useState(value);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null),
    marker = useRef<any>(null);
  const sequence = useRef(0);
  const pickOnMap = useRef<(lat: number, lng: number) => void>(() => {});
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const key = process.env.NEXT_PUBLIC_GOONG_MAP_KEY;
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    setSuggestions([]);
    setSearched(false);
    if (query.trim().length < 3) {
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      request("location?mode=search&q=" + encodeURIComponent(query.trim()))
        .then((data) => {
          if (active) {
            setSuggestions(data.predictions || []);
            setSearched(true);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  function loading(next: boolean) {
    setBusy(next);
    onBusyChange(next);
  }
  function accept(point: ResolvedLocation) {
    onChange(point);
    setMapPoint(point);
    setText(point.address);
    setQuery("");
    setSuggestions([]);
    setError("");
  }
  function edit(next: string) {
    sequence.current++;
    loading(false);
    onChange(null);
    setText(next);
    setQuery(next);
    setError("");
  }
  async function selectSuggestion(s: Suggestion) {
    const id = ++sequence.current;
    loading(true);
    onChange(null);
    setQuery("");
    setError("");
    try {
      const data = await request(
        "location?mode=detail&id=" + encodeURIComponent(s.place_id),
      );
      const place = data.result || data.results?.[0];
      const lat = Number(place?.geometry?.location?.lat),
        lng = Number(place?.geometry?.location?.lng);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        throw new Error("Không tìm được vị trí bếp. Hãy chọn địa chỉ khác.");
      if (id === sequence.current)
        accept({
          address: place.formatted_address || s.description,
          lat,
          lng,
          area: goongArea(place) || undefined,
        });
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    } finally {
      if (id === sequence.current) loading(false);
    }
  }
  async function reversePoint(lat: number, lng: number) {
    const id = ++sequence.current;
    loading(true);
    onChange(null);
    setQuery("");
    setError("");
    setMapPoint({ address: "", lat, lng });
    try {
      const point = await reverseLocation(lat, lng);
      if (id === sequence.current) accept(point);
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    } finally {
      if (id === sequence.current) loading(false);
    }
  }
  pickOnMap.current = (lat, lng) => {
    if (!disabledRef.current) void reversePoint(lat, lng);
  };
  async function detect() {
    const id = ++sequence.current;
    loading(true);
    onChange(null);
    setQuery("");
    setError("");
    try {
      const { coords } = await currentPosition();
      if (id !== sequence.current) return;
      const point = await reverseLocation(coords.latitude, coords.longitude);
      if (id === sequence.current) accept(point);
    } catch (e) {
      if (id === sequence.current) setError((e as Error).message);
    } finally {
      if (id === sequence.current) loading(false);
    }
  }
  useEffect(() => {
    if (!key || !el.current) return;
    let active = true;
    let resize: ResizeObserver | null = null;
    void loadGoongSDK()
      .then((sdk) => {
        if (!active || !el.current) return;
        sdk.accessToken = key;
        const center = mapPoint
          ? [mapPoint.lng, mapPoint.lat]
          : [106.6809, 10.7817];
        const instance = new sdk.Map({
          container: el.current,
          style: "https://tiles.goong.io/assets/goong_map_web.json",
          center,
          zoom: mapPoint ? 16 : 11,
        });
        map.current = instance;
        const pin = new sdk.Marker({
          color: "#206b50",
          draggable: !disabledRef.current,
        });
        marker.current = pin;
        if (mapPoint) pin.setLngLat(center).addTo(instance);
        pin.on("dragend", () => {
          const point = pin.getLngLat();
          pickOnMap.current(point.lat, point.lng);
        });
        instance.on(
          "click",
          (event: { lngLat: { lat: number; lng: number } }) =>
            pickOnMap.current(event.lngLat.lat, event.lngLat.lng),
        );
        instance.on("load", () => {
          if (active) {
            setMapReady(true);
            instance.resize();
          }
        });
        instance.on("error", () => {
          if (active)
            setMapError(
              "Bản đồ chưa tải được. Bạn vẫn có thể tìm và chọn địa chỉ bếp.",
            );
        });
        resize = new ResizeObserver(() => instance.resize());
        resize.observe(el.current);
      })
      .catch((e) => {
        if (active) setMapError(e.message);
      });
    return () => {
      active = false;
      resize?.disconnect();
      marker.current?.remove();
      map.current?.remove();
      marker.current = null;
      map.current = null;
    };
    // Mount once; subsequent effects move the marker and update interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!mapReady || !mapPoint || !map.current || !marker.current) return;
    const center = [mapPoint.lng, mapPoint.lat];
    marker.current.setLngLat(center).addTo(map.current);
    map.current.flyTo({ center, zoom: 16, duration: 350 });
  }, [mapReady, mapPoint]);
  useEffect(() => {
    marker.current?.setDraggable(!disabled);
  }, [disabled, mapReady]);

  return (
    <div className="kitchen-location-picker">
      <div className="field">
        <span>Vị trí bếp</span>
        <span className="search-box kitchen-address-search">
          <Search size={18} />
          <input
            aria-label="Tìm địa chỉ bếp"
            placeholder="Tìm số nhà, tên đường, phường…"
            value={text}
            maxLength={500}
            autoComplete="off"
            disabled={disabled}
            onChange={(e) => edit(e.target.value)}
          />
          {text && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm vị trí bếp"
              disabled={disabled}
              onClick={() => edit("")}
            >
              <X size={17} />
            </button>
          )}
        </span>
      </div>
      <button
        type="button"
        className="location-detect"
        disabled={busy || disabled}
        onClick={() => void detect()}
      >
        <LocateFixed size={18} />
        Dùng vị trí hiện tại của bếp
      </button>
      {searching && (
        <p className="address-status" role="status">
          Đang tìm địa chỉ…
        </p>
      )}
      {busy && (
        <p className="address-status" role="status">
          Đang xác định vị trí bếp…
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="address-suggestions" aria-label="Địa chỉ bếp gợi ý">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.place_id}
              className="location-result"
              disabled={busy || disabled}
              onClick={() => void selectSuggestion(s)}
            >
              <MapPin size={18} />
              <span>{s.description}</span>
            </button>
          ))}
        </div>
      )}
      {searched && !suggestions.length && (
        <p className="address-status">
          Không tìm thấy địa chỉ. Thử thêm tên phường hoặc thành phố.
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {key ? (
        <>
          <div
            ref={el}
            className="kitchen-location-map"
            aria-label="Bản đồ chọn vị trí bếp"
          />
          <p className="muted small">
            Chạm bản đồ hoặc kéo ghim tới đúng vị trí bếp.
          </p>
        </>
      ) : (
        <p className="muted small">
          Bản đồ chưa khả dụng. Bạn có thể chọn địa chỉ từ kết quả tìm kiếm.
        </p>
      )}
      {mapError && (
        <div className="notice error" role="alert">
          {mapError}
        </div>
      )}
      {!value && !busy && (
        <p className="muted small">
          Chọn một kết quả tìm kiếm hoặc ghim vị trí để lưu địa chỉ bếp.
        </p>
      )}
    </div>
  );
}
