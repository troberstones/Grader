import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { getSubmissionsForAssignment } from "@/actions/submissions";
import { ReviewV1Client } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewV1Page({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const [assignment, submissions] = await Promise.all([
    getAssignment(Number(assignmentId)),
    getSubmissionsForAssignment(Number(assignmentId)),
  ]);

  if (!assignment) notFound();

  return (
    <ReviewV1Client
      assignment={assignment}
      initialSubmissions={submissions}
    />
  );
}
