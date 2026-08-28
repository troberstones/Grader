import { AuthShell } from "@/components/auth/auth-shell";
import { inspectUploadLink } from "@/actions/upload-links";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await inspectUploadLink(token);

  if (!link) {
    return (
      <AuthShell title="This upload link is not valid" subtitle="It may have expired or been revoked by your instructor.">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ask your instructor for a new link if you still need to submit.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={link.assignmentName}
      subtitle={
        link.studentName
          ? `Upload your submission for ${link.assignmentName} as ${link.studentName}.`
          : `Upload your submission for ${link.assignmentName}.`
      }
    >
      <UploadForm token={token} studentName={link.studentName} roster={link.roster} submissionType={link.submissionType} />
    </AuthShell>
  );
}
