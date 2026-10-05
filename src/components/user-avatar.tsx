"use client";
import { useState } from "react";

export function UserAvatar({
  name,
  src,
  className = "",
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`user-avatar ${className}`}>
      {src && failed !== src ? (
        <img
          src={src}
          alt={`Ảnh đại diện của ${name}`}
          onError={() => setFailed(src)}
        />
      ) : (
        <span aria-label={`Ảnh đại diện của ${name}`}>
          {name.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}
