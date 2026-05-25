"use client";
import { useCallback, useEffect, useState } from "react";
import { ru } from "@/lib/i18n";

interface Settings {
  quota_chat_notifications_enabled: boolean;
  billing_stars_enabled: boolean;
  display_anonymous_handles_enabled: boolean;
  media_uploads_teachers_enabled: boolean;
  transcripts_enabled: boolean;
}

type ToggleKey = keyof Settings;

interface ToggleSpec {
  key: ToggleKey;
  title: string;
  on: string;
  off: string;
}

const TOGGLES: readonly ToggleSpec[] = [
  { key: "quota_chat_notifications_enabled", ...ru.admin.settings.toggles.quotaChatNotifications },
  { key: "billing_stars_enabled", ...ru.admin.settings.toggles.billingStars },
  { key: "display_anonymous_handles_enabled", ...ru.admin.settings.toggles.displayAnonymousHandles },
  { key: "media_uploads_teachers_enabled", ...ru.admin.settings.toggles.mediaUploadsTeachers },
  { key: "transcripts_enabled", ...ru.admin.settings.toggles.transcripts },
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
        setError(ru.admin.settings.saveError);
      }
      setBusyKey(null);
    },
    [settings, busyKey, jwt],
  );

  return (
    <section className="mb-4 rounded-2xl bg-tg-bg-section p-4 space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">{ru.admin.settings.sectionTitle}</h2>
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
          {enabled === null ? ru.admin.settings.rowLoading : enabled ? spec.on : spec.off}
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
        {enabled === null ? ru.admin.settings.buttonLoading : enabled ? ru.admin.settings.buttonOn : ru.admin.settings.buttonOff}
      </button>
    </div>
  );
}
