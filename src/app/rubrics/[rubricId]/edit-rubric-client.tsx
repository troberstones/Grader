"use client";

import { useState } from "react";
import { RUBRIC_EDITORS, type RubricEditorKey } from "@/components/rubric/registry";
import { updateRubric, updateShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";
import type { AuthoredRubric, NormalRubric } from "@/lib/rubric";

interface EditRubricClientProps {
  rubricId: number;
  initialKey: RubricEditorKey;
  legacyInitialData: RubricJSON;
  shareInitialData: NormalRubric | null;
}

export function EditRubricClient({ rubricId, initialKey, legacyInitialData, shareInitialData }: EditRubricClientProps) {
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<RubricEditorKey>(initialKey);

  const entry = RUBRIC_EDITORS.find((e) => e.key === version)!;

  async function handleSaveLegacy(data: RubricJSON) {
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

  async function handleSaveShare(data: AuthoredRubric) {
    setSaving(true);
    try {
      await updateShareRubric(rubricId, data);
      toast.success("Rubric saved");
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  const toggle = (
    <div className="flex items-center rounded-md border text-sm overflow-hidden self-start">
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
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{toggle}</div>
      {entry.kind === "share" ? (
        <entry.Editor initialData={shareInitialData} onSave={handleSaveShare} saving={saving} />
      ) : (
        <entry.Editor initialData={legacyInitialData} onSave={handleSaveLegacy} saving={saving} />
      )}
    </div>
  );
}
