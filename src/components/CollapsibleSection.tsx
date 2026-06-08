"use client";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";

/**
 * Wraps an admin section in a native <details> so each block can be folded
 * away. The body strips the inner component's own outer chrome (its
 * `<section>` background, padding, margins) and hides its first `<h2>` so
 * the title isn't duplicated — the wrapper's `<summary>` provides it.
 *
 * Open/closed state persists per `id` in localStorage so the admin doesn't
 * have to re-collapse the same sections every visit. SSR-safe: initial
 * render uses `defaultOpen` (no localStorage on the server), then a
 * mount-time effect applies the saved value.
 */
export function CollapsibleSection({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const storageKey = `admin-section:${id}`;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "1") setOpen(true);
    else if (saved === "0") setOpen(false);
  }, [storageKey]);

  function handleToggle(e: SyntheticEvent<HTMLDetailsElement>) {
    const next = e.currentTarget.open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // localStorage may be unavailable (private mode, embedded webview).
      // The in-memory state still works for the session.
    }
  }

  return (
    <details
      open={open}
      onToggle={handleToggle}
      className="group mb-3 rounded-2xl bg-tg-bg-section"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 select-none">
        <span className="text-lg font-semibold tracking-tight">{title}</span>
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-tg-bg-secondary text-tg-text"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-200 group-open:rotate-180"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="px-4 pb-4 [&>section]:!mb-0 [&>section]:!mt-0 [&>section]:!rounded-none [&>section]:!bg-transparent [&>section]:!p-0 [&_h2]:hidden">
        {children}
      </div>
    </details>
  );
}
