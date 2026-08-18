import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { requireAdmin } from "@/lib/auth/session";
import { listAuditLog } from "@/actions/audit";
import { AuditLogView } from "./audit-log";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  // listAuditLog() re-checks this itself — same reasoning as /admin/users:
  // the page guard gives a redirect, the action guard is what actually
  // protects the data, since an action is independently RPC-reachable.
  await requireAdmin();
  const rows = await listAuditLog();

  return (
    <PageContainer>
      <Header
        title="Audit log"
        description="Who changed what — grades, roles, invitations, and deletions."
      />
      <AuditLogView initialRows={rows} />
    </PageContainer>
  );
}
