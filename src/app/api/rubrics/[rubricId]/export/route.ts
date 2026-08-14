import { NextResponse } from "next/server";
import { exportRubricToJSON } from "@/actions/rubrics";
import { apiRequireCapability } from "@/lib/auth/api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ rubricId: string }> }
) {
  const auth = await apiRequireCapability("course.view");
  if (!auth.user) return auth.response;

  const { rubricId } = await params;
  const json = await exportRubricToJSON(Number(rubricId));
  if (!json) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(json);
}
