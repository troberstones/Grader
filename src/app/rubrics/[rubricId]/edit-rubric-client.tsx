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
      const { rescored, nowInProgress } = await updateShareRubric(rubricId, data);
      if (rescored > 0) {
        const rescoredNoun = `${rescored} grade${rescored === 1 ? "" : "s"}`;
        toast.success(
          nowInProgress > 0
            ? `Rescored ${rescoredNoun} — ${nowInProgress} ${nowInProgress === 1 ? "is" : "are"} now in progress because a new criterion needs scoring.`
            : `Rubric saved — rescored ${rescoredNoun}.`
        );
      } else {
        toast.success("Rubric saved");
      }
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
