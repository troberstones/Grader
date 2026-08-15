import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { needsBootstrap } from "@/lib/auth/session";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

/**
 * First run.
 *
 * The alternative — shipping a default administrator password — is worse than
 * having no authentication at all, because it looks like authentication. So the
 * first person to reach the application creates the first account, and this
 * page stops existing the moment one exists.
 */
export default async function SetupPage() {
  if (!(await needsBootstrap())) redirect("/login");

  return (
    <AuthShell
      title="Create the first administrator"
      subtitle="No accounts exist yet. This one can invite everybody else."
      footer="Administrators manage accounts and roles. You can create a separate instructor account for your own teaching afterwards if you would rather keep the two apart."
    >
      <SetupForm />
    </AuthShell>
  );
}
