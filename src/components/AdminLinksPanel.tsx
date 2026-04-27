"use client";
import { useEffect, useState } from "react";

type LinkUser = { id: number; name: string | null; role: string };

export function AdminLinksPanel({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<LinkUser[]>([]);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } })
      .then((r) => r.json() as Promise<{ users: LinkUser[] }>)
      .then((d) => setUsers(d.users));
  }, [jwt]);

  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  async function link(action: "POST" | "DELETE") {
    if (!studentId || !teacherId) {
      setFeedback("Выбери студента и преподавателя.");
      return;
    }
    setFeedback(null);
    const r = await fetch("/api/admin/links", {
      method: action,
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, teacherId }),
    });
    if (!r.ok) {
      setFeedback(`Ошибка: ${await r.text()}`);
      return;
    }
    setFeedback(action === "POST" ? "Связаны." : "Связь удалена.");
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-2">Связи студент ↔ преподаватель</h2>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="border rounded px-2 py-1"
          onChange={(e) => setStudentId(e.target.value ? Number(e.target.value) : null)}
          value={studentId ?? ""}
        >
          <option value="">— студент —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
        <span>↔</span>
        <select
          className="border rounded px-2 py-1"
          onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : null)}
          value={teacherId ?? ""}
        >
          <option value="">— преподаватель —</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.id}
            </option>
          ))}
        </select>
        <button
          className="px-3 py-2 rounded bg-blue-600 text-white"
          onClick={() => void link("POST")}
        >
          Привязать
        </button>
        <button className="px-3 py-2 rounded bg-gray-200" onClick={() => void link("DELETE")}>
          Отвязать
        </button>
      </div>
      {feedback && <p className="text-sm mt-2 text-gray-600">{feedback}</p>}
    </section>
  );
}
