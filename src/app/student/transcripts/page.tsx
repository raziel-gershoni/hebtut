"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ru } from "@/lib/i18n";

interface Prefs {
  transcripts_enabled: boolean;
  translation_enabled: boolean;
  global_transcripts_enabled: boolean;
  global_translation_enabled: boolean;
}

export default function StudentTranscriptsPage() {
  return (
    <AppShell title={ru.student.transcriptsPage.pageTitle} back="/">
      {({ jwt, role }) => {
        if (role !== "student") {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.student.transcriptsPage.studentsOnly}
            </div>
          );
        }
        return <Body jwt={jwt} />;
      }}
    </AppShell>
  );
}

function Body({ jwt }: { jwt: string }) {
  const [data, setData] = useState<Prefs | null>(null);
  const [transcripts, setTranscripts] = useState(true);
  const [translation, setTranslation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/student/transcripts", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return;
    const d = (await r.json()) as Prefs;
    setData(d);
    setTranscripts(d.transcripts_enabled);
    setTranslation(d.translation_enabled);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/student/transcripts", {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcripts_enabled: transcripts,
        translation_enabled: translation,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(ru.student.transcriptsPage.saveError);
      return;
    }
    await load();
  }

  if (!data) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-32 rounded-2xl bg-tg-bg-secondary" />
      </div>
    );
  }

  const dirty =
    transcripts !== data.transcripts_enabled ||
    translation !== data.translation_enabled;

  // Persisted preference is kept editable, but disabled visually when the
  // matching global toggle is off — saving still works, the choice just
  // doesn't fire deliveries until the admin turns the global back on.
  const transcriptsLockedByGlobal = !data.global_transcripts_enabled;
  const translationLockedByGlobal = !data.global_translation_enabled;
  const translationDisabled = !transcripts || translationLockedByGlobal;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-tg-bg-section p-5 space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={transcripts}
            onChange={(e) => setTranscripts(e.target.checked)}
            disabled={transcriptsLockedByGlobal}
            className="mt-0.5 w-5 h-5 accent-tg-button disabled:opacity-40"
          />
          <div className={`min-w-0 flex-1 ${transcriptsLockedByGlobal ? "opacity-60" : ""}`}>
            <div className="text-sm font-medium">
              {ru.student.transcriptsPage.transcriptsTitle}
            </div>
            <div className="text-xs text-tg-text-hint mt-0.5">
              {ru.student.transcriptsPage.transcriptsBody}
            </div>
            {transcriptsLockedByGlobal && (
              <div className="text-[11px] text-tg-text-hint mt-1 italic">
                {ru.student.transcriptsPage.globallyDisabledNotice}
              </div>
            )}
          </div>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={translation}
            onChange={(e) => setTranslation(e.target.checked)}
            disabled={translationDisabled}
            className="mt-0.5 w-5 h-5 accent-tg-button disabled:opacity-40"
          />
          <div className={`min-w-0 flex-1 ${translationDisabled ? "opacity-60" : ""}`}>
            <div className="text-sm font-medium">
              {ru.student.transcriptsPage.translationTitle}
            </div>
            <div className="text-xs text-tg-text-hint mt-0.5">
              {ru.student.transcriptsPage.translationBody}
            </div>
            {translationLockedByGlobal && (
              <div className="text-[11px] text-tg-text-hint mt-1 italic">
                {ru.student.transcriptsPage.globallyDisabledNotice}
              </div>
            )}
          </div>
        </label>
      </section>

      {error && (
        <div className="rounded-2xl bg-tg-bg-section p-3 text-xs text-tg-text-destructive">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() => void save()}
        className="w-full h-10 rounded-2xl bg-tg-button text-tg-button-text text-sm font-semibold transition-transform active:scale-[0.99] disabled:opacity-50"
      >
        {busy
          ? ru.student.transcriptsPage.savingButton
          : ru.student.transcriptsPage.saveButton}
      </button>
    </div>
  );
}
