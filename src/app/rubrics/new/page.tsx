"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { RubricEditor } from "@/components/rubric/rubric-editor";
import { RubricEditorV2 } from "@/components/rubric/rubric-editor-v2";
import { RubricEditorV3 } from "@/components/rubric/rubric-editor-v3";
import { createRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";

type EditorVersion = "v1" | "v2" | "v3";

const VERSIONS: { key: EditorVersion; label: string }[] = [
  { key: "v1", label: "Classic" },
  { key: "v2", label: "Weighted" },
  { key: "v3", label: "Spreadsheet" },
];

export default function NewRubricPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<EditorVersion>("v3");

  async function handleSave(data: RubricJSON) {
    setSaving(true);
    try {
      const rubric = await createRubric({
        name: data.name,
        description: data.description,
        settings: data.settings,
        criteria: data.criteria,
      });
      toast.success("Rubric created");
      router.push(`/rubrics/${rubric.id}`);
    } catch (err) {
      toast.error(`Failed to create rubric: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error("createRubric error:", err);
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
          <div className="flex items-center rounded-md border text-sm overflow-hidden">
            {VERSIONS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setVersion(v.key)}
                className={`px-3 py-1.5 transition-colors ${
                  version === v.key
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
      />
      {version === "v3" ? (
        <RubricEditorV3 onSave={handleSave} saving={saving} />
      ) : version === "v2" ? (
        <RubricEditorV2 onSave={handleSave} saving={saving} />
      ) : (
        <RubricEditor onSave={handleSave} saving={saving} />
      )}
    </PageContainer>
  );
}
