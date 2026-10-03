"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bookmark,
  BriefcaseBusiness,
  Check,
  House,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  X,
  ArrowLeft,
  LoaderCircle,
} from "lucide-react";
import type { Location } from "@/lib/domain";
import {
  currentPosition,
  isUnresolvedLocation,
  reverseLocation,
} from "@/lib/location-client";
import { post, request, useApp } from "./providers";
import { Link } from "./page-motion";

type SavedAddress = Location & {
  id: string;
  label: string;
  recipient: string;
  phone: string;
  is_default: number;
};
type Suggestion = { place_id: string; description: string };
const normalize = (text: string) =>
  text
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
const asLocation = (a: Location): Location => ({
  address: a.address,
  lat: Number(a.lat),
  lng: Number(a.lng),
});

export function AddressPicker({ onClose }: { onClose?: () => void }) {
  const { user, location, setLocation, revision, refresh, toast } = useApp();
  const [text, setText] = useState(location?.address || "");
  const [selected, setSelected] = useState<Location | null>(
    location && !isUnresolvedLocation(location.address) ? location : null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(!!user);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"gps" | "detail" | "save" | null>(null);
  const [editor, setEditor] = useState<SavedAddress | "new" | null>(null);
  const [label, setLabel] = useState("Nhà");
  const [recipient, setRecipient] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [isDefault, setIsDefault] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const operation = useRef(0);
  const dirty = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dirty.current) return;
    setText(location?.address || "");
    setSelected(
      location && !isUnresolvedLocation(location.address) ? location : null,
    );
  }, [location]);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!user) {
      setAddresses([]);
      setLoading(false);
      setEditor(null);
      return;
    }
    let active = true;
    setLoading(true);
    request<{ addresses: SavedAddress[] }>("addresses")
      .then((data) => {
        if (active) {
          setAddresses(data.addresses);
          setListError("");
        }
      })
      .catch((e) => {
        if (active) setListError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, revision]);
  useEffect(() => {
    setSuggestions([]);
    setSearched(false);
    if (searchQuery.trim().length < 3) {
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      request(
        "location?mode=search&q=" + encodeURIComponent(searchQuery.trim()),
      )
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
  }, [searchQuery]);

  function updateText(value: string) {
    dirty.current = true;
    operation.current++;
    setBusy(null);
    setText(value);
    setSelected(null);
    setManualLat("");
    setManualLng("");
    setSearchQuery(value);
    setError("");
  }
  function choosePoint(value: Location) {
    dirty.current = true;
    setSelected(
      value.address &&
        Number.isFinite(Number(value.lat)) &&
        Number.isFinite(Number(value.lng)) &&
        !isUnresolvedLocation(value.address)
        ? asLocation(value)
        : null,
    );
    setText(value.address);
    setSearchQuery("");
    setSuggestions([]);
    setManualLat("");
    setManualLng("");
    setError("");
  }
  function chooseSaved(value: SavedAddress) {
    operation.current++;
    setBusy(null);
    setLocation(asLocation(value));
    choosePoint(value);
    toast("Đã chọn địa chỉ giao.");
    onClose?.();
  }
  async function detect() {
    dirty.current = true;
    const id = ++operation.current;
    setBusy("gps");
    setError("");
    setSearchQuery("");
    try {
      const { coords } = await currentPosition();
      if (id !== operation.current) return;
      const value = await reverseLocation(coords.latitude, coords.longitude);
      if (id !== operation.current) return;
      choosePoint(value);
    } catch (e) {
      if (id === operation.current) setError((e as Error).message);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function chooseSuggestion(suggestion: Suggestion) {
    const id = ++operation.current;
    setBusy("detail");
    setError("");
    setSearchQuery("");
    try {
      const data = await request(
        "location?mode=detail&id=" + encodeURIComponent(suggestion.place_id),
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
        throw new Error("Chưa tìm được tọa độ địa chỉ. Hãy chọn kết quả khác.");
      if (id === operation.current)
        choosePoint({
          address: place.formatted_address || suggestion.description,
          lat,
          lng,
        });
    } catch (e) {
      if (id === operation.current) setError((e as Error).message);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  function startEditor(value: SavedAddress | "new") {
    dirty.current = true;
    operation.current++;
    setBusy(null);
    setError("");
    setEditor(value);
    setLabel(value === "new" ? "Nhà" : value.label);
    setRecipient(value === "new" ? user?.name || "" : value.recipient);
    setPhone(value === "new" ? user?.phone || "" : value.phone);
    setIsDefault(value === "new" ? addresses.length === 0 : !!value.is_default);
    if (value === "new") updateText("");
    else choosePoint(value);
    input.current?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const lat = Number(manualLat),
      lng = Number(manualLng);
    const point =
      manualLat &&
      manualLng &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
        ? { address: text.trim(), lat, lng }
        : selected;
    if (
      !point ||
      text.trim().length < 10 ||
      isUnresolvedLocation(text.trim())
    ) {
      setError(
        "Hãy tìm và chọn địa chỉ trong danh sách gợi ý để xác định đúng vị trí giao.",
      );
      return;
    }
    if (!editor) {
      setLocation(point);
      toast("Đã cập nhật địa chỉ giao.");
      onClose?.();
      return;
    }
    const id = ++operation.current;
    setBusy("save");
    setError("");
    try {
      await post(
        editor === "new" ? "addresses" : `addresses/${editor.id}`,
        {
          ...point,
          label,
          recipient,
          phone,
          isDefault,
        },
        editor === "new" ? "POST" : "PATCH",
      );
      if (id !== operation.current) return;
      setEditor(null);
      choosePoint(point);
      setLocation(point);
      refresh();
      toast("Đã lưu địa chỉ.");
    } catch (e) {
      if (id === operation.current) setError((e as Error).message);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  async function removeAddress() {
    if (!editor || editor === "new" || busy) return;
    const id = ++operation.current;
    setBusy("save");
    setError("");
    try {
      await request(`addresses/${editor.id}`, { method: "DELETE" });
      if (id !== operation.current) return;
      setEditor(null);
      refresh();
      toast("Đã xóa địa chỉ đã lưu.");
    } catch (e) {
      if (id === operation.current) setError((e as Error).message);
    } finally {
      if (id === operation.current) setBusy(null);
    }
  }
  const filtered = addresses.filter(
    (a) =>
      !searchQuery ||
      normalize(`${a.label} ${a.address} ${a.recipient}`).includes(
        normalize(searchQuery),
      ),
  );
  const primary = filtered.find((a) => a.is_default);
  const others = filtered.filter((a) => a.id !== primary?.id);
  const hasNewSelection =
    selected &&
    (selected.address !== location?.address ||
      selected.lat !== location?.lat ||
      selected.lng !== location?.lng);
  function addressCard(a: SavedAddress) {
    const Icon = normalize(a.label).includes("nha")
      ? House
      : normalize(a.label).includes("cong ty")
        ? BriefcaseBusiness
        : Bookmark;
    const current =
      location?.address === a.address &&
      Number(location.lat) === Number(a.lat) &&
      Number(location.lng) === Number(a.lng);
    return (
      <div
        key={a.id}
        className={`delivery-address-card${current ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="delivery-address-select"
          onClick={() => chooseSaved(a)}
        >
          <Icon size={21} />
          <span>
            <strong>
              {a.label}
              {!!a.is_default && (
                <small className="address-default">Mặc định</small>
              )}
            </strong>
            <span>{a.address}</span>
            <small>
              {a.recipient} · {a.phone}
            </small>
          </span>
          {current && <Check size={17} aria-label="Đang chọn" />}
        </button>
        <button
          type="button"
          className="text-button address-edit"
          onClick={() => startEditor(a)}
        >
          Sửa
        </button>
      </div>
    );
  }
  return (
    <div className={`address-picker${onClose ? "" : " address-picker-page"}`}>
      <div className="sheet-header">
        {editor && (
          <button
            type="button"
            className="icon-button"
            aria-label="Quay lại danh sách"
            disabled={busy === "save"}
            onClick={() => {
              operation.current++;
              setBusy(null);
              setEditor(null);
              choosePoint(location || { address: "", lat: NaN, lng: NaN });
            }}
          >
            <ArrowLeft size={21} />
          </button>
        )}
        <h2>
          {editor
            ? editor === "new"
              ? "Thêm địa chỉ mới"
              : "Sửa địa chỉ"
            : "Địa chỉ giao hàng"}
        </h2>
        {onClose && (
          <button
            type="button"
            className="icon-button"
            aria-label="Đóng"
            disabled={busy === "save"}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        )}
      </div>
      <form onSubmit={submit} className="address-picker-form">
        <div className="search-box address-search">
          <Search size={18} />
          <input
            ref={input}
            aria-label="Tìm địa chỉ giao"
            placeholder="Tìm địa chỉ giao"
            value={text}
            maxLength={500}
            autoComplete="off"
            disabled={busy === "save"}
            onChange={(e) => updateText(e.target.value)}
          />
          {text && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              disabled={busy === "save"}
              onClick={() => {
                updateText("");
                input.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          )}
        </div>
        <button
          type="button"
          className="location-detect"
          onClick={() => void detect()}
          disabled={!!busy}
        >
          <LocateFixed size={19} />
          {busy === "gps" ? "Đang xác định vị trí…" : "Dùng vị trí hiện tại"}
        </button>
        {busy === "detail" && (
          <p className="address-status" role="status">
            <LoaderCircle size={16} />
            Đang lấy địa chỉ…
          </p>
        )}
        {searching && (
          <p className="address-status" role="status">
            Đang tìm địa chỉ…
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="address-suggestions" aria-label="Địa chỉ gợi ý">
            {suggestions.map((s) => (
              <button
                key={s.place_id}
                type="button"
                className="location-result"
                onClick={() => void chooseSuggestion(s)}
                disabled={!!busy}
              >
                <MapPin size={18} />
                <span>{s.description}</span>
              </button>
            ))}
          </div>
        )}
        {searched && !suggestions.length && (
          <p className="address-status">
            Không tìm thấy địa chỉ. Thử thêm tên đường, phường hoặc thành phố.
          </p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {editor && (
          <div className="form address-editor">
            <label className="field">
              <span>Tên địa chỉ</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Nhà, công ty…"
                required
                maxLength={50}
                disabled={busy === "save"}
              />
            </label>
            <label className="field">
              <span>Người nhận</span>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                required
                minLength={2}
                maxLength={100}
                disabled={busy === "save"}
              />
            </label>
            <label className="field">
              <span>Điện thoại</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                autoComplete="tel"
                required
                minLength={10}
                maxLength={20}
                disabled={busy === "save"}
              />
            </label>
            <label className="address-default-option">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={busy === "save"}
              />
              Đặt làm địa chỉ mặc định
            </label>
          </div>
        )}

        {!editor && (
          <div className="delivery-address-list">
            {loading ? (
              <p className="address-status" role="status">
                Đang tải địa chỉ đã lưu…
              </p>
            ) : (
              <>
                {listError && (
                  <div className="notice error" role="alert">
                    {listError}
                    <button
                      type="button"
                      className="text-button"
                      onClick={refresh}
                    >
                      Thử lại
                    </button>
                  </div>
                )}
                {primary && addressCard(primary)}
                {others.length > 0 && (
                  <>
                    <h3>Địa chỉ đã lưu</h3>
                    {others.map(addressCard)}
                  </>
                )}
                {user && !listError && !addresses.length && (
                  <p className="address-status">Chưa có địa chỉ đã lưu.</p>
                )}
                {user &&
                  addresses.length > 0 &&
                  searchQuery &&
                  !filtered.length && (
                    <p className="address-status">
                      Không có địa chỉ đã lưu phù hợp.
                    </p>
                  )}
              </>
            )}
          </div>
        )}
        <details className="address-manual">
          <summary>Nhập tọa độ thủ công</summary>
          <div className="form-row">
            <label className="field">
              <span>Vĩ độ</span>
              <input
                inputMode="decimal"
                aria-label="Vĩ độ"
                value={manualLat}
                disabled={busy === "save"}
                onChange={(e) => {
                  setManualLat(e.target.value);
                  setSelected(null);
                }}
              />
            </label>
            <label className="field">
              <span>Kinh độ</span>
              <input
                inputMode="decimal"
                aria-label="Kinh độ"
                value={manualLng}
                disabled={busy === "save"}
                onChange={(e) => {
                  setManualLng(e.target.value);
                  setSelected(null);
                }}
              />
            </label>
          </div>
        </details>
        <div className="address-picker-footer">
          {editor && editor !== "new" && (
            <button
              type="button"
              className="text-button"
              disabled={!!busy}
              onClick={() => void removeAddress()}
            >
              Xóa địa chỉ đã lưu
            </button>
          )}
          {(editor || hasNewSelection || (manualLat && manualLng)) && (
            <button
              className="button"
              type="submit"
              disabled={!!busy || (!selected && !(manualLat && manualLng))}
            >
              {busy === "save"
                ? "Đang lưu…"
                : editor
                  ? "Lưu địa chỉ"
                  : "Giao đến địa chỉ này"}
            </button>
          )}
          {!editor &&
            (user ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => startEditor("new")}
                disabled={!!busy}
              >
                <Plus size={18} />
                Thêm địa chỉ mới
              </button>
            ) : (
              <Link href="/login" className="text-button" onClick={onClose}>
                Đăng nhập để lưu địa chỉ
              </Link>
            ))}
        </div>
      </form>
    </div>
  );
}
