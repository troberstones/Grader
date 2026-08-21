"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { RUBRIC_EDITORS, type RubricEditorKey } from "@/components/rubric/registry";
import { createRubric, createShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";
import type { AuthoredRubric } from "@/lib/rubric";

export default function NewRubricPage() {
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
  // New work defaults to the share model; Classic/Weighted/Spreadsheet stay
  // one click away for anyone who wants to author with the old system.
  const [version, setVersion] = useState<RubricEditorKey>("share");

  const entry = RUBRIC_EDITORS.find((e) => e.key === version)!;

  function goToNewRubric(rubricId: number) {
    if (returnTo) {
      const url = new URL(returnTo, window.location.origin);
      url.searchParams.set("newRubricId", String(rubricId));
      router.push(url.pathname + url.search);
    } else {
      router.push(`/rubrics/${rubricId}`);
    }
  }

  async function handleSaveLegacy(data: RubricJSON) {
    setSaving(true);
    try {
      const rubric = await createRubric({
        name: data.name,
        description: data.description,
        settings: data.settings,
        criteria: data.criteria,
      });
      toast.success("Rubric created");
      goToNewRubric(rubric.id);
    } catch (err) {
      toast.error(`Failed to create rubric: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error("createRubric error:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveShare(data: AuthoredRubric) {
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
            <div className="flex items-center rounded-md border text-sm overflow-hidden">
              {RUBRIC_EDITORS.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => setVersion(e.key)}
                  className={`px-3 py-1.5 transition-colors ${
                    version === e.key
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <LinkButton href={returnTo ?? "/rubrics"} variant="outline">
              {returnTo ? "Back to assignment" : "Cancel"}
            </LinkButton>
          </div>
        }
      />
      {entry.kind === "share" ? (
        <entry.Editor onSave={handleSaveShare} saving={saving} />
      ) : (
        <entry.Editor onSave={handleSaveLegacy} saving={saving} />
      )}
    </PageContainer>
  );
}
