"use client";
import { useState } from "react";

export interface AvatarProps {
  /** Accessibility label / initials fallback when no image and no emoji are provided. */
  name: string;
  /** TG profile photo URL (admin/self). When set, takes priority over emoji. */
  imageUrl?: string;
  /** Anonymous-mode glyph (single emoji). Rendered centered when imageUrl is missing. */
  emoji?: string;
  /** Tailwind background utility for the anonymous-mode emoji circle. */
  bgClass?: string;
  /** Square px size — defaults to 36 (admin row). 48 for the inbox chat list. */
  size?: 32 | 36 | 48 | 56;
  /** Adds a thin accent ring around admins so they're scannable. */
  isAdmin?: boolean;
}

const SIZE_CLASS: Record<NonNullable<AvatarProps["size"]>, string> = {
  32: "w-8 h-8 text-xs",
  36: "w-9 h-9 text-xs",
  48: "w-12 h-12 text-base",
  56: "w-14 h-14 text-lg",
};

const EMOJI_SIZE: Record<NonNullable<AvatarProps["size"]>, string> = {
  32: "text-base",
  36: "text-lg",
  48: "text-2xl",
  56: "text-3xl",
};

export function Avatar({ name, imageUrl, emoji, bgClass, size = 36, isAdmin }: AvatarProps) {
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
  const showEmoji = !showImage && emoji;
  const containerBg = showEmoji && bgClass ? bgClass : "bg-tg-bg-secondary";

  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden text-tg-text flex items-center justify-center font-semibold tracking-tight ${containerBg} ${sizeCls} ${ring}`}
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
      ) : showEmoji ? (
        <span className={`leading-none ${EMOJI_SIZE[size]}`}>{emoji}</span>
      ) : (
        <span>{initials || "?"}</span>
      )}
    </div>
  );
}
