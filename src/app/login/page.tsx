import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentUser, needsBootstrap } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth-routes";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // With no accounts at all there is nothing to sign in to, and the first run
  // creates an administrator instead.
  if (await needsBootstrap()) redirect("/setup");

  const { next } = await searchParams;
  const destination = safeNext(next);

  if (await getCurrentUser()) redirect(destination);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Grading, rubrics and reviews for your courses."
      footer="Accounts are created by invitation. If you do not have one, ask your department administrator."
    >
      <LoginForm next={destination} />
    </AuthShell>
  );
}
