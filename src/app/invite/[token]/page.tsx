import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/roles";
import { inspectInvite } from "@/actions/auth";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inspectInvite(token);

  if (!invite) {
    return (
      <AuthShell
        title="This invitation is not valid"
        subtitle="It may have expired, or already been used, or been replaced by a newer one."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Invitations last seven days and can only be used once. Ask whoever invited you to send a new
          link.
        </p>
        <Link href="/login" className="mt-5 inline-block text-sm text-primary hover:underline">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set your password"
      subtitle={`You have been invited to Art Grader as ${invite.email}.`}
      footer={`${ROLE_LABELS[invite.globalRole]} — ${ROLE_DESCRIPTIONS[invite.globalRole]}`}
    >
      <AcceptForm token={token} name={invite.name} />
    </AuthShell>
  );
}
