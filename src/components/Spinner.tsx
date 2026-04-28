"use client";

interface SpinnerProps {
  /** Square px size — defaults to 16 */
  size?: number;
  className?: string;
}

/**
 * Tiny inline spinner used inside async buttons / dialog controls.
 * Inherits the parent's `currentColor`, so a destructive button shows a
 * white spinner and a muted button shows a muted spinner without props.
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={`animate-spin ${className ?? ""}`}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 1-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
