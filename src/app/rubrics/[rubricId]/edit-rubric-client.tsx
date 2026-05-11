"use client";

import { useState } from "react";
import { RubricEditor } from "@/components/rubric/rubric-editor";
import { RubricEditorV2 } from "@/components/rubric/rubric-editor-v2";
import { RubricEditorV3 } from "@/components/rubric/rubric-editor-v3";
import { updateRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";

interface EditRubricClientProps {
  rubricId: number;
  initialData: RubricJSON;
}

type EditorVersion = "v1" | "v2" | "v3";

const VERSIONS: { key: EditorVersion; label: string }[] = [
  { key: "v1", label: "Classic" },
  { key: "v2", label: "Weighted" },
  { key: "v3", label: "Spreadsheet" },
];

export function EditRubricClient({ rubricId, initialData }: EditRubricClientProps) {
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<EditorVersion>("v3");

  async function handleSave(data: RubricJSON) {
    setSaving(true);
    try {
      await updateRubric(rubricId, {
        name: data.name,
        description: data.description,
        settings: data.settings,
        criteria: data.criteria,
      });
      toast.success("Rubric saved");
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  const toggle = (
    <div className="flex items-center rounded-md border text-sm overflow-hidden self-start">
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
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{toggle}</div>
      {version === "v3" ? (
        <RubricEditorV3 initialData={initialData} onSave={handleSave} saving={saving} />
      ) : version === "v2" ? (
        <RubricEditorV2 initialData={initialData} onSave={handleSave} saving={saving} />
      ) : (
        <RubricEditor initialData={initialData} onSave={handleSave} saving={saving} />
      )}
    </div>
  );
}
