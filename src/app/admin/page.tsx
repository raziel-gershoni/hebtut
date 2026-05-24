"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AdminUsersTable, type AdminUser } from "@/components/AdminUsersTable";
import {
  AdminConnectionsPanel,
  type Connection,
} from "@/components/AdminConnectionsPanel";
import { TeacherInvites } from "@/components/TeacherInvites";
import { BannedUsersPanel } from "@/components/BannedUsersPanel";
import { AdminSettingsPanel } from "@/components/AdminSettingsPanel";
import { AdminTagsManager } from "@/components/AdminTagsManager";
import { AdminOnboardingVideos } from "@/components/AdminOnboardingVideos";
import { AdminVersionFooter } from "@/components/AdminVersionFooter";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { ru } from "@/lib/i18n";

export default function AdminPage() {
  return (
    <AppShell title={ru.admin.pages.pageTitle} back="/">
      {({ jwt, isAdmin }) => {
        if (!isAdmin) {
          return (
            <div className="rounded-2xl bg-tg-bg-section p-6 text-sm text-tg-text-hint">
              {ru.admin.pages.adminsOnly}
            </div>
          );
        }
        return <AdminBody jwt={jwt} />;
      }}
    </AppShell>
  );
}

/**
 * Owns the shared `users` and `links` lists so the pending inbox, role
 * table, and connections panel all stay in sync without page reloads.
 */
function AdminBody({ jwt }: { jwt: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [links, setLinks] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const headers = { Authorization: `Bearer ${jwt}` };
    const [uRes, lRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store", headers }),
      fetch("/api/admin/links", { cache: "no-store", headers }),
    ]);
    if (uRes.ok) {
      const u = (await uRes.json()) as { users: AdminUser[] };
      setUsers(u.users);
    }
    if (lRes.ok) {
      const l = (await lRes.json()) as { links: Connection[] };
      setLinks(l.links);
    }
    setLoaded(true);
  }, [jwt]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Catch out-of-band changes (other devices, /start from a fresh TG user)
  // when the Mini App returns to foreground.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/admin/feedback"
          className="inline-flex items-center gap-1 text-sm font-semibold text-tg-text-link"
        >
          {ru.admin.pages.navFeedback}
        </Link>
        <Link
          href="/admin/audit"
          className="inline-flex items-center gap-1 text-sm font-semibold text-tg-text-link"
        >
          {ru.admin.pages.navAudit}
        </Link>
      </div>
      <CollapsibleSection id="users" title={ru.admin.pages.sections.users} defaultOpen>
        <AdminUsersTable jwt={jwt} users={users} loaded={loaded} refetch={refetch} />
      </CollapsibleSection>
      <CollapsibleSection id="connections" title={ru.admin.pages.sections.connections}>
        <AdminConnectionsPanel jwt={jwt} users={users} links={links} refetch={refetch} />
      </CollapsibleSection>
      <CollapsibleSection id="settings" title={ru.admin.pages.sections.settings}>
        <AdminSettingsPanel jwt={jwt} />
      </CollapsibleSection>
      <CollapsibleSection id="onboarding-videos" title={ru.admin.pages.sections.onboardingVideos}>
        <AdminOnboardingVideos jwt={jwt} />
      </CollapsibleSection>
      <CollapsibleSection id="tags" title={ru.admin.pages.sections.tags}>
        <AdminTagsManager jwt={jwt} />
      </CollapsibleSection>
      <CollapsibleSection id="invites" title={ru.admin.pages.sections.invites}>
        <TeacherInvites jwt={jwt} />
      </CollapsibleSection>
      <CollapsibleSection id="banned" title={ru.admin.pages.sections.banned}>
        <BannedUsersPanel jwt={jwt} />
      </CollapsibleSection>
      <AdminVersionFooter />
    </>
  );
}
