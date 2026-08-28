import { requireGradeSession } from "@/lib/auth/session";
import { NewRubricClient } from "./new-rubric-client";

export const dynamic = "force-dynamic";

/**
 * Server shell so this page can be gated at all.
 *
 * The editor below is a client component, and a client component cannot run
 * the session guard — which is the whole reason for splitting it out here
 * rather than leaving the page as one "use client" file. A review session must
 * not reach an authoring surface, and refusing only at the save action would
 * still put the rubric on screen, which is the thing review mode exists to
 * prevent.
 */
export default async function Page() {
  await requireGradeSession();
  return <NewRubricClient />;
}
