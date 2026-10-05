"use client";

import { useId, useState, type ComponentProps } from "react";
import { Upload, LoaderCircle } from "lucide-react";

type FilePickerProps = Omit<ComponentProps<"input">, "type"> & {
  buttonLabel?: string;
  busy?: boolean;
};

export function FilePicker({
  buttonLabel = "Chọn tệp",
  busy = false,
  disabled,
  onChange,
  className = "",
  ...props
}: FilePickerProps) {
  const [name, setName] = useState("");
  const nameId = useId();
  return (
    <span
      className="file-picker"
      data-disabled={disabled || busy}
      aria-busy={busy}
    >
      <input
        {...props}
        type="file"
        className={`file-picker-input ${className}`}
        disabled={disabled || busy}
        aria-describedby={[props["aria-describedby"], nameId]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) => {
          setName(
            Array.from(event.currentTarget.files || [])
              .map((file) => file.name)
              .join(", "),
          );
          onChange?.(event);
        }}
      />
      <span className="file-picker-button" aria-hidden="true">
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Upload size={16} />
        )}
        {busy ? "Đang xử lý…" : buttonLabel}
      </span>
      <span
        className="file-picker-name"
        id={nameId}
        title={name || undefined}
        aria-live="polite"
      >
        {name || "Chưa chọn tệp"}
      </span>
    </span>
  );
}
