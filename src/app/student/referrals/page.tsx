"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

interface ReferralsData {
  token: string;
  url: string;
  attributed_count: number;
  paid_count: number;
}

export default function ReferralsPage() {
  return (
    <AppShell title="Рефералы" back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              Только для учеников.
            </div>
          );
        }
        return <Body jwt={jwt} />;
      }}
    </AppShell>
  );
}

function Body({ jwt }: { jwt: string }) {
  const [data, setData] = useState<ReferralsData | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/referrals", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    setData((await r.json()) as ReferralsData);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select and prompt — covers older WebViews without clipboard API.
      window.prompt("Скопируй ссылку вручную:", data.url);
    }
  }

  function shareLink() {
    if (!data) return;
    if (typeof navigator.share === "function") {
      void navigator.share({
        title: "Попробуй HebTut",
        text: "Я тренируюсь говорить с тренером — попробуй и ты.",
        url: data.url,
      });
    } else {
      void copyLink();
    }
  }

  if (!data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-tg-bg-secondary" />
        <div className="h-12 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">
          Приглашай друзей
        </p>
        <p className="mt-2 text-sm text-tg-text-subtitle">
          Когда друг оплатит подписку, обоим прибавим{" "}
          <span className="font-medium text-tg-text">+30 дней</span>. Можно
          набрать до{" "}
          <span className="font-medium text-tg-text">+90 дней бонуса</span>.
        </p>

        <div className="mt-4 rounded-2xl bg-tg-bg-secondary p-3">
          <div className="text-[11px] uppercase tracking-wider text-tg-text-hint">
            Твоя ссылка
          </div>
          <div className="mt-1 break-all text-sm font-mono">{data.url}</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="h-10 rounded-2xl bg-tg-bg-secondary text-sm font-semibold transition-transform active:scale-[0.99]"
          >
            {copied ? "Скопировано ✓" : "Скопировать"}
          </button>
          <button
            type="button"
            onClick={shareLink}
            className="h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99]"
          >
            Поделиться
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-tg-bg-section p-5">
        <p className="text-xs uppercase tracking-widest text-tg-text-hint">Статистика</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <Stat label="Пришли по ссылке" value={data.attributed_count} />
          <Stat label="Оплатили" value={data.paid_count} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-tg-bg-secondary p-4">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-tg-text-hint">{label}</div>
    </div>
  );
}
