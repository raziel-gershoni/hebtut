"use client";
import { useEffect, useState, useCallback } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type AdminUser = {
  id: number;
  tg_user_id: number;
  name: string | null;
  role: "pending" | "student" | "teacher" | "admin";
  status: string;
  created_at: string;
  role_changed_at: string | null;
};

const ROLES: AdminUser["role"][] = ["pending", "student", "teacher", "admin"];

export function AdminUsersTable({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pending, setPending] = useState<{ id: number; role: AdminUser["role"] } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${jwt}` } });
    const d = (await r.json()) as { users: AdminUser[] };
    setUsers(d.users);
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(id: number, role: AdminUser["role"]) {
    await fetch(`/api/admin/users/${id}/role`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
  }

  function isDestructive(current: AdminUser["role"], next: AdminUser["role"]): boolean {
    if (current === "admin" && next !== "admin") return true;
    if (current === "teacher" && (next === "pending" || next === "student")) return true;
    if (current === "student" && (next === "pending" || next === "teacher")) return true;
    return false;
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Пользователи</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-2 pr-2">Имя</th>
              <th className="py-2 pr-2">TG id</th>
              <th className="py-2 pr-2">Роль</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="py-2 pr-2">{u.name ?? "—"}</td>
                <td className="py-2 pr-2">{u.tg_user_id}</td>
                <td className="py-2 pr-2">{u.role}</td>
                <td className="py-2">
                  <select
                    className="border rounded px-2 py-1"
                    value={u.role}
                    onChange={(e) => {
                      const next = e.target.value as AdminUser["role"];
                      if (isDestructive(u.role, next)) setPending({ id: u.id, role: next });
                      else void changeRole(u.id, next);
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!pending}
        title="Подтвердить смену роли"
        body="Это действие может разорвать существующие связи студент↔преподаватель. Продолжить?"
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (pending) await changeRole(pending.id, pending.role);
          setPending(null);
        }}
      />
    </section>
  );
}
