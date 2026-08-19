import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiRequireCapability } from "@/lib/auth/api";
import { submissionResource } from "@/lib/auth/resource-lookup";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await params;
  const resource = await submissionResource(Number(submissionId));
  const auth = await apiRequireCapability("roster.view", resource);
  if (!auth.user) return auth.response;

  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, Number(submissionId)));

  if (!rows[0]) {
    return new NextResponse("Not found", { status: 404 });
  }

  const submission = rows[0];
  const absolutePath = path.join(process.cwd(), submission.filePath);

  try {
    const buffer = await fs.readFile(absolutePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": submission.fileType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${submission.fileName}"`,
      },
    });
  } catch {
    return new NextResponse("File not found on disk", { status: 404 });
  }
}
