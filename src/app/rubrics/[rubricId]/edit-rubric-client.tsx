"use client";

import { useState } from "react";
import { RubricEditor } from "@/components/rubric/rubric-editor";
import { updateRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";

interface EditRubricClientProps {
  rubricId: number;
  initialData: RubricJSON;
}

export function EditRubricClient({ rubricId, initialData }: EditRubricClientProps) {
  const [saving, setSaving] = useState(false);

  async function handleSave(data: RubricJSON) {
    setSaving(true);
    try {
      await updateRubric(rubricId, {
        name: data.name,
        description: data.description,
        criteria: data.criteria,
      });
      toast.success("Rubric saved");
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  return <RubricEditor initialData={initialData} onSave={handleSave} saving={saving} />;
}
