"use client";
import { useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { type AdminUser } from "./AdminUsersTable";
import { ru } from "@/lib/i18n";

const PAGE_SIZE = 50;

/**
 * One side of the bulk-pairing UI: search + checklist + windowed rendering.
 *
 * Search: case-insensitive substring across name / display_handle /
 * tg_username / tg_user_id. Updates the visible filter immediately; doesn't
 * reset the visibleCount unless the filter actually changes the result set
 * shape, so a long checked-list stays scrolled where it was.
 *
 * Window: render the first `PAGE_SIZE` filtered rows; "показать ещё"
 * extends by another `PAGE_SIZE`. This keeps the DOM small at scale
 * without pulling in a virtualization library — for our user counts the
 * "render up to N, then on demand" pattern is sufficient and degrades to
 * full-list-rendered for small N.
 */
export function SearchableUserChecklist({
  jwt,
  users,
  selected,
  onToggle,
  label,
  emptyText,
}: {
  jwt: string;
  users: AdminUser[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  label: string;
  emptyText: string;
}) {
  const [filter, setFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.display_handle ?? "").toLowerCase().includes(q) ||
        (u.tg_username ?? "").toLowerCase().includes(q) ||
        String(u.tg_user_id).includes(q),
    );
  }, [users, filter]);

  const shown = filtered.slice(0, visibleCount);
  const hiddenCount = Math.max(0, filtered.length - shown.length);

  return (
    <div className="rounded-2xl bg-tg-bg-section p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
        <span className="text-[11px] text-tg-text-hint tabular-nums">
          {selected.size} / {users.length}
        </span>
      </div>
      <input
        type="search"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          // New filter resets the window so the user always sees the top of
          // the freshly-filtered list — avoids "I typed 'and' but I need to
          // tap 'show more' to see the matching person?" confusion.
          setVisibleCount(PAGE_SIZE);
        }}
        placeholder={ru.admin.userChecklist.searchPlaceholder}
        className="w-full mb-2 h-9 px-3 rounded-lg bg-tg-bg-secondary text-sm text-tg-text placeholder:text-tg-text-hint outline-none focus:ring-2 focus:ring-tg-button/40"
      />
      {filtered.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-tg-text-hint">{emptyText}</div>
      ) : (
        <ul className="space-y-0.5 max-h-80 overflow-y-auto">
          {shown.map((u) => {
            const isChecked = selected.has(u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onToggle(u.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                    isChecked ? "bg-emerald-500/10" : "hover:bg-tg-bg-secondary/60"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border ${
                      isChecked
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-tg-text-hint/40"
                    }`}
                  >
                    {isChecked && (
                      <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                        <path
                          d="M2 6 L5 9 L10 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <Avatar
                    size={32}
                    name={u.name ?? String(u.tg_user_id)}
                    imageUrl={
                      u.has_avatar
                        ? `/api/avatar/${u.id}?token=${encodeURIComponent(jwt)}`
                        : undefined
                    }
                  />
                  <span className="min-w-0 flex-1 text-sm leading-tight">
                    <span className="truncate block">{u.name ?? ru.admin.userChecklist.fallbackName(u.id)}</span>
                    {u.display_handle && (
                      <span className="text-[11px] text-tg-text-hint truncate block">
                        {u.display_emoji} {u.display_handle}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="mt-2 w-full text-xs text-tg-text-link tracking-wider"
        >
          {ru.admin.userChecklist.showMore(hiddenCount)}
        </button>
      )}
    </div>
  );
}
