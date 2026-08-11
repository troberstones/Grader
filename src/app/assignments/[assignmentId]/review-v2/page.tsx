import { notFound } from "next/navigation";
import { getAssignment } from "@/actions/assignments";
import { ReviewV2Client } from "./review-v2-client";

export const dynamic = "force-dynamic";

export default async function ReviewV2Page({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const assignment = await getAssignment(Number(assignmentId));
  if (!assignment) notFound();

  // Instructor-only for now (DESIGN.md §12.2). `author_id` is carried on every
  // stroke regardless, so peer critique later needs no migration — just
  // identity, visibility rules and moderation on top.
  const author = {
    id: "instructor",
    name: "Instructor",
    color: 0xff9069ff,
  };

  return (
    // dvh, not vh. On iPadOS Safari `vh` is the viewport with the browser
    // chrome hidden, so with the tab bar showing this box was about 50pt taller
    // than the screen and the transport bar sat below the bottom edge, where
    // nothing could scroll it back into view.
    <div style={{ height: "calc(100dvh - 3.5rem)", minHeight: 480 }}>
      <ReviewV2Client
        assignmentId={assignment.id}
        assignmentName={assignment.name}
        author={author}
      />
    </div>
  );
}
