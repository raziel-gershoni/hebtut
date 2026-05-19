"use client";
import { useCallback, useEffect, useState } from "react";

interface Settings {
  quota_chat_notifications_enabled: boolean;
  billing_stars_enabled: boolean;
  display_anonymous_handles_enabled: boolean;
  media_uploads_teachers_enabled: boolean;
}

type ToggleKey = keyof Settings;

interface ToggleSpec {
  key: ToggleKey;
  title: string;
  on: string;
  off: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  {
    key: "quota_chat_notifications_enabled",
    title: "Уведомления о лимите в чате",
    on: "Бот пишет ученику об остатке и исчерпании лимита.",
    off: "Бот молчит про лимит. Ученик видит остаток в мини-приложении.",
  },
  {
    key: "billing_stars_enabled",
    title: "Telegram Stars (оплата)",
    // The "off" copy is the new safe default — manual billing only.
    on: "Кнопка «Оплатить» открывает Telegram Stars. Перед включением убедись, что готов принимать оплату через Stars.",
    off: "Оплата только вручную через админа. Кнопки «Оплатить» закрыты, инвойсы Stars не создаются.",
  },
  {
    key: "display_anonymous_handles_enabled",
    title: "Анонимные имена (псевдонимы)",
    // OFF (default) = real names; ON = animal handles. So "on" describes
    // the unusual choice and "off" describes the default behaviour.
    on: "Везде показываем псевдонимы вида «Гордый Орёл» 🦅 и эмодзи-аватары вместо имён и фото.",
    off: "В чатах и инбоксе показываем настоящее имя (как ученик указал в онбординге) и фото из Telegram.",
  },
  {
    key: "media_uploads_teachers_enabled",
    title: "Загрузка медиа учителями",
    on: "Учителя могут загружать файлы в общую медиа-библиотеку. Удалить или изменить файл может только загрузивший или админ.",
    off: "Загружать в библиотеку могут только админы. Учителя всё равно отправляют учащимся файлы из библиотеки.",
  },
];

export function AdminSettingsPanel({ jwt }: { jwt: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busyKey, setBusyKey] = useState<ToggleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/settings", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as { settings: Settings };
    setSettings(d.settings);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (key: ToggleKey) => {
      if (!settings || busyKey) return;
      const next = !settings[key];
      setBusyKey(key);
      setError(null);
      setSettings({ ...settings, [key]: next }); // optimistic
      const r = await fetch("/api/admin/settings", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, value: next }),
      });
      if (!r.ok) {
        setSettings({ ...settings, [key]: !next }); // revert
        setError("Не удалось сохранить — попробуй ещё раз");
      }
      setBusyKey(null);
    },
    [settings, busyKey, jwt],
  );

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Настройки</h2>
      {TOGGLES.map((spec) => (
        <ToggleRow
          key={spec.key}
          spec={spec}
          enabled={settings?.[spec.key] ?? null}
          busy={busyKey === spec.key}
          disabled={busyKey !== null && busyKey !== spec.key}
          onToggle={() => void toggle(spec.key)}
        />
      ))}
      {error && <div className="text-xs text-tg-text-destructive">{error}</div>}
    </section>
  );
}

function ToggleRow({
  spec,
  enabled,
  busy,
  disabled,
  onToggle,
}: {
  spec: ToggleSpec;
  enabled: boolean | null;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{spec.title}</div>
        <div className="text-xs text-tg-text-hint mt-0.5">
          {enabled === null ? "Загрузка…" : enabled ? spec.on : spec.off}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={enabled === null || busy || disabled}
        aria-pressed={enabled === true}
        className={`shrink-0 inline-flex items-center justify-center min-w-[3.75rem] h-7 px-3 rounded-full text-xs font-semibold tabular-nums tracking-tight transition-all duration-150 active:scale-95 ring-1 ${
          enabled === true
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30"
            : "bg-tg-bg-secondary text-tg-text-hint ring-tg-text-hint/30"
        } disabled:opacity-50`}
      >
        {enabled === null ? "…" : enabled ? "ВКЛ" : "ВЫКЛ"}
      </button>
    </div>
  );
}
