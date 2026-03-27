"use server";

import { db } from "@/db";
import { annotations } from "@/db/schema";
import { eq } from "drizzle-orm";

export type AnnotationFrame = {
  frameNumber: number | null;
  annotationData: string;
};

export async function getAnnotations(submissionId: number): Promise<AnnotationFrame[]> {
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
  await db.delete(annotations).where(eq(annotations.submissionId, submissionId));
  return { success: true };
}
