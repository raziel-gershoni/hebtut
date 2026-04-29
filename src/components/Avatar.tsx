"use client";
import { useState } from "react";

export interface AvatarProps {
  name: string;
  /** TG profile photo URL — typically `/api/avatar/<userId>`. Falls back
   *  to initials when missing OR when the image fails to load. */
  imageUrl?: string;
  /** Square px size — defaults to 36 (admin row). 48 for the inbox chat list. */
  size?: 32 | 36 | 48 | 56;
  /** Adds a thin accent ring around admins so they're scannable. */
  isAdmin?: boolean;
}

const SIZE_CLASS: Record<NonNullable<AvatarProps["size"]>, string> = {
  32: "w-8 h-8 text-xs",
  36: "w-9 h-9 text-xs",
  48: "w-12 h-12 text-sm",
  56: "w-14 h-14 text-sm",
};

export function Avatar({ name, imageUrl, size = 36, isAdmin }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const sizeCls = SIZE_CLASS[size];
  const ring = isAdmin ? "ring-1 ring-tg-text-accent/60" : "";

  const showImage = imageUrl && !failed;

  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden bg-tg-bg-secondary text-tg-text flex items-center justify-center font-semibold tracking-tight ${sizeCls} ${ring}`}
      aria-hidden
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </div>
  );
}
