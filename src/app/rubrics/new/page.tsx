"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { RubricEditor } from "@/components/rubric/rubric-editor";
import { createRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";

export default function NewRubricPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleSave(data: RubricJSON) {
    setSaving(true);
    try {
      const rubric = await createRubric({
        name: data.name,
        description: data.description,
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
      <Header title="New Rubric" description="Define the criteria and graduated expectations" />
      <RubricEditor onSave={handleSave} saving={saving} />
    </PageContainer>
  );
}
