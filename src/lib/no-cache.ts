// Headers that force the browser, Telegram's webview cache, and any
// upstream proxies to never serve a stale copy of an API response.
export const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;
