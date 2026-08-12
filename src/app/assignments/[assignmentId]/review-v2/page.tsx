import { redirect } from "next/navigation";

/**
 * The art reviewer is the default viewer now and lives at `/review`. This stub
 * keeps the address it was built under working, so a tab left open on a tablet
 * lands somewhere useful instead of a 404. Safe to delete once nothing points
 * here.
 */
export default async function ReviewV2Redirect({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { assignmentId } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.set(key, value);
  }
  const suffix = query.size > 0 ? `?${query}` : "";
  redirect(`/assignments/${assignmentId}/review${suffix}`);
}
