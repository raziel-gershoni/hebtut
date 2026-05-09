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
