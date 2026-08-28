"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { RUBRIC_EDITORS } from "@/components/rubric/registry";
import { createShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { AuthoredRubric } from "@/lib/rubric";

export function NewRubricClient() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
      <NewRubricForm />
    </Suspense>
  );
}

function NewRubricForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set when arriving from an assignment's rubric picker — see
  // edit-assignment-client.tsx and assignments/new/page.tsx. On save, the new
  // rubric is handed back to that page instead of landing on /rubrics/:id.
  const returnTo = searchParams.get("returnTo");

  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(RUBRIC_EDITORS[0].key);

  const entry = RUBRIC_EDITORS.find((e) => e.key === key) ?? RUBRIC_EDITORS[0];

  function goToNewRubric(rubricId: number) {
    if (returnTo) {
      const url = new URL(returnTo, window.location.origin);
      url.searchParams.set("newRubricId", String(rubricId));
      router.push(url.pathname + url.search);
    } else {
      router.push(`/rubrics/${rubricId}`);
    }
  }

  async function handleSave(data: AuthoredRubric) {
    setSaving(true);
    try {
      const rubric = await createShareRubric(data);
      toast.success("Rubric created");
      goToNewRubric(rubric.id);
    } catch (err) {
      toast.error(`Failed to create rubric: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error("createShareRubric error:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <Header
        title="New Rubric"
        description="Define the criteria and graduated expectations"
        actions={
          <div className="flex items-center gap-3">
            {/* Only worth a switch when there is something to switch between —
                there is one editor now, and the registry is what would bring a
                second one back. */}
            {RUBRIC_EDITORS.length > 1 && (
              <div className="flex items-center rounded-md border text-sm overflow-hidden">
                {RUBRIC_EDITORS.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    onClick={() => setKey(e.key)}
                    className={`px-3 py-1.5 transition-colors ${
                      key === e.key
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            )}
            <LinkButton href={returnTo ?? "/rubrics"} variant="outline">
              {returnTo ? "Back to assignment" : "Cancel"}
            </LinkButton>
          </div>
        }
      />
      <entry.Editor onSave={handleSave} saving={saving} />
    </PageContainer>
  );
}
