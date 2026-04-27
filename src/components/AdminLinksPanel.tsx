"use client";
import { useEffect, useState } from "react";

type LinkUser = { id: number; name: string | null; role: string };

export function AdminLinksPanel({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<LinkUser[]>([]);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json() as Promise<{ users: LinkUser[] }>)
      .then((d) => setUsers(d.users));
  }, [jwt]);

  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  async function link(action: "POST" | "DELETE") {
    if (!studentId || !teacherId) {
      setFeedback({ tone: "err", text: "Выбери студента и преподавателя." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const r = await fetch("/api/admin/links", {
        method: action,
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, teacherId }),
      });
      if (!r.ok) {
        setFeedback({ tone: "err", text: `Ошибка: ${await r.text()}` });
        return;
      }
      setFeedback({
        tone: "ok",
        text: action === "POST" ? "Связаны." : "Связь удалена.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-lg font-semibold tracking-tight">Связи студент ↔ преподаватель</h2>
        <p className="text-sm text-tg-text-hint mt-1">
          Сначала назначь роли в списке выше, потом свяжи здесь.
        </p>
      </header>

      <div className="rounded-2xl bg-tg-bg-section p-4 space-y-3">
        <PickerRow
          label="Студент"
          options={students}
          value={studentId}
          onChange={setStudentId}
        />
        <PickerRow
          label="Преподаватель"
          options={teachers}
          value={teacherId}
          onChange={setTeacherId}
        />

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy || !studentId || !teacherId}
            onClick={() => void link("POST")}
            className="flex-1 min-h-10 h-10 rounded-full bg-tg-button text-tg-button-text text-sm font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50"
          >
            Привязать
          </button>
          <button
            type="button"
            disabled={busy || !studentId || !teacherId}
            onClick={() => void link("DELETE")}
            className="flex-1 min-h-10 h-10 rounded-full bg-tg-bg-secondary text-tg-text text-sm font-medium tracking-tight transition-transform active:scale-95 disabled:opacity-50"
          >
            Отвязать
          </button>
        </div>

        {feedback && (
          <p
            className={
              feedback.tone === "ok"
                ? "text-sm text-emerald-600 dark:text-emerald-400"
                : "text-sm text-tg-text-destructive"
            }
          >
            {feedback.text}
          </p>
        )}
      </div>
    </section>
  );
}

function PickerRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: LinkUser[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-tg-text-hint mb-1">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full h-10 px-3 rounded-xl bg-tg-bg-secondary text-tg-text outline-none focus:ring-2 focus:ring-tg-button/40"
      >
        <option value="">— не выбрано —</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name ?? `ID ${u.id}`}
          </option>
        ))}
      </select>
    </label>
  );
}
