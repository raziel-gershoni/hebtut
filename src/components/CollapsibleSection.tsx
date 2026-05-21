"use client";
import type { ReactNode } from "react";

/**
 * Wraps an admin section in a native <details> so each block can be folded
 * away. The body strips the inner component's own outer chrome (its
 * `<section>` background, padding, margins) and hides its first `<h2>` so
 * the title isn't duplicated — the wrapper's `<summary>` provides it.
 */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group mb-3 overflow-hidden rounded-2xl bg-tg-bg-section"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 select-none">
        <span className="text-lg font-semibold tracking-tight">{title}</span>
        <span
          aria-hidden
          className="text-tg-text-hint transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4 [&>section]:!mb-0 [&>section]:!mt-0 [&>section]:!rounded-none [&>section]:!bg-transparent [&>section]:!p-0 [&_h2]:hidden">
        {children}
      </div>
    </details>
  );
}
