"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "./Avatar";
import { Spinner } from "./Spinner";
import { ru } from "@/lib/i18n";
import { apportionMinutes } from "@/server/tutor-work";
import { format, startOfWeek, startOfMonth } from "date-fns";

interface DayBucket {
  date: string;
  recording_s: number;
  playback_s: number;
  active_s: number;
  total_s: number;
}

interface TutorRollup {
  tutor_id: number;
  tutor_name: string;
  tutor_has_avatar: boolean;
  days: DayBucket[];
  totals: { recording_s: number; playback_s: number; active_s: number; total_s: number };
}

interface ApiResponse {
  range: { from: string; to: string; days: number };
  tutors: TutorRollup[];
}

type Preset = "today" | "week" | "month" | "custom";

function fmtDuration(s: number): string {
  if (s <= 0) return "0м";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}м`;
}

// Same h/m formatting as fmtDuration, but for an already-whole-minute value.
// Used for the active/playback/recording breakdown, whose minute counts come
// from apportionMinutes so they re-sum exactly to fmtDuration(total_s).
function fmtMinutes(m: number): string {
  if (m <= 0) return "0м";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}м`;
  if (mm === 0) return `${h}ч`;
  return `${h}ч ${mm}м`;
}

export function AdminTutorWorkPanel({ jwt }: { jwt: string }) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    if (preset === "today") {
      setFrom(today);
      setTo(today);
    } else if (preset === "week") {
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      setFrom(format(weekStart, "yyyy-MM-dd"));
      setTo(today);
    } else if (preset === "month") {
      setFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setTo(today);
    }
  }, [preset, today]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/tutor-work?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${jwt}` },
        },
      );
      if (!r.ok) {
        setError(ru.admin.tutorWork.loadError);
        setData(null);
        return;
      }
      setData((await r.json()) as ApiResponse);
    } catch {
      setError(ru.admin.tutorWork.loadError);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [from, to, jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {ru.admin.tutorWork.sectionTitle}
        </h2>
      </header>

      <div className="inline-flex rounded-full bg-tg-bg-secondary p-0.5 text-xs font-medium mb-3">
        {(["today", "week", "month", "custom"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            className={`px-3 h-8 rounded-full transition-colors ${
              preset === p ? "bg-tg-bg-section text-tg-text shadow-sm" : "text-tg-text-hint"
            }`}
          >
            {p === "today"
              ? ru.admin.tutorWork.rangeTodayBtn
              : p === "week"
                ? ru.admin.tutorWork.rangeWeekBtn
                : p === "month"
                  ? ru.admin.tutorWork.rangeMonthBtn
                  : "…"}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2 mb-3 text-xs text-tg-text-hint">
          <span>{ru.admin.tutorWork.customRangeFrom}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
          <span>{ru.admin.tutorWork.customRangeTo}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-2 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
          />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2 text-xs text-center font-medium mb-3">
          {error}
        </div>
      )}

      {busy && !data && (
        <div className="text-center py-6">
          <Spinner />
        </div>
      )}

      {data && data.tutors.length === 0 && (
        <div className="rounded-2xl bg-tg-bg-section p-6 text-center text-sm text-tg-text-hint">
          {ru.admin.tutorWork.noActivity}
        </div>
      )}

      {data && data.tutors.length > 0 && (
        <ul className="space-y-2">
          {data.tutors.map((t) => {
            const todayBucket = t.days.find((d) => d.date === today);
            const todayTotal = todayBucket?.total_s ?? 0;
            // Apportion whole minutes so the breakdown re-sums to the period
            // total shown on the name line (otherwise independent flooring can
            // make «актив 0м · прослушка 0м · запись 5м» undershoot «Всего: 7м»).
            const [activeMin = 0, playbackMin = 0, recordingMin = 0] = apportionMinutes([
              t.totals.active_s,
              t.totals.playback_s,
              t.totals.recording_s,
            ]);
            return (
              <li
                key={t.tutor_id}
                className="rounded-2xl bg-tg-bg-section p-3 flex items-center gap-3"
              >
                <Avatar
                  size={48}
                  name={t.tutor_name}
                  imageUrl={
                    t.tutor_has_avatar
                      ? `/api/avatar/${t.tutor_id}?token=${encodeURIComponent(jwt)}`
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium tracking-tight truncate">
                      {t.tutor_name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-tg-text-hint">
                      {ru.admin.tutorWork.periodTotalLabel}{" "}
                      <span className="text-tg-text font-medium">
                        {fmtDuration(t.totals.total_s)}
                      </span>
                    </span>
                  </div>
                  <div className="text-[11px] text-tg-text-hint tabular-nums mt-0.5">
                    ⏱ {ru.admin.tutorWork.bucketActiveLabel} {fmtMinutes(activeMin)}
                    {" · "}▶ {ru.admin.tutorWork.bucketPlaybackLabel}{" "}
                    {fmtMinutes(playbackMin)}
                    {" · "}🎙 {ru.admin.tutorWork.bucketRecordingLabel}{" "}
                    {fmtMinutes(recordingMin)}
                  </div>
                  <div className="text-[11px] text-tg-text-hint mt-0.5">
                    {ru.admin.tutorWork.todayTotalLabel}{" "}
                    <span className="text-tg-text tabular-nums">
                      {fmtDuration(todayTotal)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
