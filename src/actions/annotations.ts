"use server";

import { db } from "@/db";
import { annotations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireCapability } from "@/lib/auth/require";

export type AnnotationFrame = {
  frameNumber: number | null;
  annotationData: string;
};

export async function getAnnotations(submissionId: number): Promise<AnnotationFrame[]> {
  await requireCapability("course.view");
  const rows = await db
    .select({ frameNumber: annotations.frameNumber, annotationData: annotations.annotationData })
    .from(annotations)
    .where(eq(annotations.submissionId, submissionId));
  return rows;
}

export async function saveAnnotations(
  submissionId: number,
  frames: AnnotationFrame[]
) {
  await requireCapability("grade.write");
  // Replace all annotations for this submission
  await db.delete(annotations).where(eq(annotations.submissionId, submissionId));

  for (const frame of frames) {
    await db.insert(annotations).values({
      submissionId,
      frameNumber: frame.frameNumber,
      annotationData: frame.annotationData,
    });
  }

  return { success: true };
}

export async function clearAnnotations(submissionId: number) {
  await requireCapability("grade.write");
  await db.delete(annotations).where(eq(annotations.submissionId, submissionId));
  return { success: true };
}
