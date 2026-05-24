"use client";
import { useCallback, useEffect, useState } from "react";
import { ru } from "@/lib/i18n";

interface BanRow {
  tg_user_id: number;
  name_snapshot: string | null;
  banned_at: string;
  banned_by_name: string | null;
}

export function BannedUsersPanel({ jwt }: { jwt: string }) {
  const [rows, setRows] = useState<BanRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const r = await fetch("/api/admin/banned", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { banned: BanRow[] };
      setRows(d.banned);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function unban(tgUserId: number) {
    await fetch(`/api/admin/banned/${tgUserId}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    await refetch();
  }

  if (loaded && rows.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold tracking-tight mb-3">{ru.admin.bannedUsers.sectionTitle}</h2>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.tg_user_id}
            className="rounded-xl bg-tg-bg-section px-3 py-2 flex items-center gap-3"
          >
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-sm font-medium truncate">
                {r.name_snapshot ?? ru.admin.bannedUsers.unknownNamePrefix(r.tg_user_id)}
              </div>
              <div className="text-[11px] text-tg-text-hint tabular-nums truncate">
                {r.tg_user_id} · {new Date(r.banned_at).toLocaleString("ru-RU")}
                {r.banned_by_name ? ` · ${r.banned_by_name}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void unban(r.tg_user_id)}
              className="shrink-0 text-xs text-tg-text-link transition-opacity active:opacity-60"
            >
              {ru.admin.bannedUsers.unbanButton}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
