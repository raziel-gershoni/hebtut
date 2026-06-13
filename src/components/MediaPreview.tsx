"use client";

import { ru } from "@/lib/i18n";
import { formatBytes } from "@/lib/media";
import { reportClientMediaError } from "@/lib/diag";

export interface MediaLibraryListItem {
  id: number;
  kind: "photo" | "video" | "audio";
  uploaded_by_user_id: number;
  original_filename: string;
  storage_path: string;
  /** Server-minted presigned R2 GET URL (6h) — the client plays from this
   * directly (no Supabase public URL, no proxy). Supplied by /api/admin/media. */
  url: string;
  title: string | null;
  description: string | null;
  bytes: number;
  uploader_name: string | null;
  tags: { id: number; name: string; slug: string }[];
}

/**
 * Photo path: keep the JWT-protected `/preview` endpoint (302 to a presigned
 * R2 URL) — fine for `<img>`, which does a plain GET with no range requests.
 * NOT fine for `<audio>`/`<video>`: media elements use cross-origin range
 * requests after the redirect and the TG Mini App WebKit webview silently
 * fails to read any bytes. Media elements use `item.url` (the presigned R2 URL
 * the server hands back) directly instead.
 */
export function previewUrl(id: number, jwt: string): string {
  return `/api/admin/media/${id}/preview?token=${encodeURIComponent(jwt)}`;
}

interface Props {
  item: MediaLibraryListItem;
  jwt: string;
  selected?: boolean;
  onClick?: () => void;
  onKebab?: () => void;
}

const MAX_VISIBLE_TAGS = 4;

export function MediaPreview({ item, jwt, selected, onClick, onKebab }: Props) {
  const title = item.title?.trim() || stripExt(item.original_filename) || item.original_filename;
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS);
  const overflow = item.tags.length - visibleTags.length;

  return (
    <div
      className={`relative rounded-2xl bg-tg-bg-section p-2 transition-all ${
        selected ? "ring-2 ring-tg-button" : "ring-1 ring-tg-text-hint/15"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left"
        aria-pressed={selected}
        aria-label={ru.inbox.mediaPreview.selectAriaLabel(title)}
      >
        <div className="aspect-square w-full rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 flex items-center justify-center">
          {item.kind === "photo" ? (
            <img
              src={previewUrl(item.id, jwt)}
              alt={title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : item.kind === "video" ? (
            <div className="relative w-full h-full">
              <video
                // #t=0.1 nudges iOS Safari into actually rendering the
                // first frame as a poster — without it the tile is just
                // black until the user plays. Plays from the presigned R2 URL.
                src={`${item.url}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                disablePictureInPicture
                onError={(e) => {
                  const err = e.currentTarget.error;
                  const codes: Record<number, string> = {
                    1: "ABORTED",
                    2: "NETWORK",
                    3: "DECODE",
                    4: "SRC_NOT_SUPPORTED",
                  };
                  void reportClientMediaError(
                    "preview-load",
                    new Error(
                      `picker tile video load failed: ${
                        err
                          ? `${codes[err.code] ?? "UNKNOWN"} · ${err.message || ""}`
                          : "no error obj"
                      }`,
                    ),
                    {
                      library_id: item.id,
                      storage_path: item.storage_path,
                      mime: item.original_filename,
                      surface: "picker-tile",
                    },
                    jwt,
                  );
                }}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/15 pointer-events-none"
                aria-hidden
              >
                <PlayBadge />
              </div>
            </div>
          ) : (
            <AudioIcon />
          )}
        </div>
        <div className="mt-2 text-xs">
          <div className="font-semibold text-tg-text truncate" title={title}>
            {title}
          </div>
          <div className="text-tg-text-hint mt-0.5 tabular-nums">
            {formatBytes(item.bytes)}
            {item.uploader_name && (
              <span className="ml-1.5 truncate inline-block max-w-[8rem] align-bottom">
                · {item.uploader_name}
              </span>
            )}
          </div>
          {visibleTags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {visibleTags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center px-2 h-5 rounded-full bg-tg-bg-secondary text-tg-text-hint text-[10px] font-medium"
                >
                  {t.name}
                </span>
              ))}
              {overflow > 0 && (
                <span className="inline-flex items-center px-2 h-5 rounded-full bg-tg-bg-secondary text-tg-text-hint text-[10px] font-medium">
                  +{overflow}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      {onKebab && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onKebab();
          }}
          aria-label={ru.inbox.mediaPreview.menuAriaLabel}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center text-base active:scale-95"
        >
          ⋯
        </button>
      )}
    </div>
  );
}

function PlayBadge() {
  return (
    <div className="w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white shadow-lg">
      <svg
        width={16}
        height={16}
        viewBox="0 0 14 14"
        fill="currentColor"
        aria-hidden
      >
        <path d="M3 1.5L12 7L3 12.5z" />
      </svg>
    </div>
  );
}

function AudioIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-12 h-12 text-tg-text-hint"
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
