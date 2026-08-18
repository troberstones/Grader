import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth/session";
import { AccountSettingsForm } from "./account-settings-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <PageContainer>
      <Header title="Account settings" description="Update your name, email, and password." />
      <AccountSettingsForm user={{ name: user.name, email: user.email, globalRole: user.globalRole }} />
    </PageContainer>
  );
}
