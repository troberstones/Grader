import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { requireAdmin } from "@/lib/auth/session";
import { listAccounts } from "@/actions/auth";
import { UserAdmin } from "./user-admin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // `listAccounts` re-checks this itself. Both are deliberate: the page guard
  // gives a redirect instead of an error, and the action guard is the one that
  // actually protects the data, because an action is callable directly.
  const admin = await requireAdmin();
  const accounts = await listAccounts();

  return (
    <PageContainer>
      <Header
        title="Accounts"
        description="Invite people, set what they can do, and disable accounts that should no longer work."
      />
      <UserAdmin accounts={accounts} currentUserId={admin.id} />
    </PageContainer>
  );
}
