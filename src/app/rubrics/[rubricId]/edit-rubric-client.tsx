"use client";

import { useState } from "react";
import { RUBRIC_EDITORS } from "@/components/rubric/registry";
import { updateShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { AuthoredRubric, NormalRubric } from "@/lib/rubric";

interface EditRubricClientProps {
  rubricId: number;
  initialData: NormalRubric;
}

export function EditRubricClient({ rubricId, initialData }: EditRubricClientProps) {
  const [saving, setSaving] = useState(false);
  const entry = RUBRIC_EDITORS[0];

  async function handleSave(data: AuthoredRubric) {
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

  return (
    <div className="space-y-4">
      <entry.Editor initialData={initialData} onSave={handleSave} saving={saving} />
    </div>
  );
}
