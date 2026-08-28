"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { RUBRIC_EDITORS } from "@/components/rubric/registry";
import { createShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { AuthoredRubric } from "@/lib/rubric";

export default function NewRubricPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(RUBRIC_EDITORS[0].key);

  const entry = RUBRIC_EDITORS.find((e) => e.key === key) ?? RUBRIC_EDITORS[0];

  async function handleSave(data: AuthoredRubric) {
    setSaving(true);
    try {
      const rubric = await createShareRubric(data);
      toast.success("Rubric created");
      router.push(`/rubrics/${rubric.id}`);
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
          // Only worth a switch when there is something to switch between —
          // there is one editor now, and the registry is what would bring a
          // second one back.
          RUBRIC_EDITORS.length > 1 ? (
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
          ) : null
        }
      />
      <entry.Editor onSave={handleSave} saving={saving} />
    </PageContainer>
  );
}
