import { notFound } from "next/navigation";
import { getRubric } from "@/actions/rubrics";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { EditRubricClient } from "./edit-rubric-client";

export const dynamic = "force-dynamic";

export default async function EditRubricPage({
  params,
}: {
  params: Promise<{ rubricId: string }>;
}) {
  const { rubricId } = await params;
  const rubric = await getRubric(Number(rubricId));
  if (!rubric) notFound();

  const initialData = {
    name: rubric.name,
    description: rubric.description ?? undefined,
    criteria: rubric.criteria.map((c) => ({
      name: c.name,
      description: c.description ?? undefined,
      weight: c.weight,
      levels: c.levels.map((l) => ({
        level: l.level,
        label: l.label,
        description: l.description,
        points: l.points,
      })),
    })),
  };

  return (
    <PageContainer>
      <Header
        title={rubric.name}
        description="Edit criteria and expectations"
        actions={
          <LinkButton href="/rubrics" variant="outline">
            Back to Rubrics
          </LinkButton>
        }
      />
      <EditRubricClient rubricId={Number(rubricId)} initialData={initialData} />
    </PageContainer>
  );
}
