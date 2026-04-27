import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: "var(--tg-bg)",
          "bg-secondary": "var(--tg-bg-secondary)",
          "bg-section": "var(--tg-bg-section)",
          "bg-header": "var(--tg-bg-header)",
          text: "var(--tg-text)",
          "text-hint": "var(--tg-text-hint)",
          "text-subtitle": "var(--tg-text-subtitle)",
          "text-link": "var(--tg-text-link)",
          "text-accent": "var(--tg-text-accent)",
          "text-destructive": "var(--tg-text-destructive)",
          "text-section-header": "var(--tg-text-section-header)",
          button: "var(--tg-button)",
          "button-text": "var(--tg-button-text)",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 240ms cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
