// Ambient declarations for the Telegram Mini App SDK (telegram-web-app.js).
// We keep this in one place so multiple hooks can extend it without TS
// complaining about subsequent-declaration shape mismatches.

export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready: () => void;
        expand: () => void;
        close?: () => void;
        // Stars / TG Payments invoice opener. Returns a status string
        // ('paid' | 'cancelled' | 'failed' | 'pending') via the optional
        // callback — we don't depend on the result; the bot webhook is the
        // source of truth for billing state.
        openInvoice?: (url: string, callback?: (status: string) => void) => void;
        // Force-opens a t.me link in the Telegram app instead of routing
        // through the browser. Critical for testing deep links from inside
        // the admin Mini App webview — without this, tapping a URL there
        // dispatches to Safari which shows the t.me web page.
        openTelegramLink?: (url: string) => void;
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
      };
    };
  }
}
