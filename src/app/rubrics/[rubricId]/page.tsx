import { notFound } from "next/navigation";
import { getRubric } from "@/actions/rubrics";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { EditRubricClient } from "./edit-rubric-client";
import { UnconvertedRubricNotice } from "@/components/rubric/unconverted-rubric-notice";
import { isShareModel, toNormalRubric } from "@/lib/rubric";

export const dynamic = "force-dynamic";

export default async function EditRubricPage({
  params,
}: {
  params: Promise<{ rubricId: string }>;
}) {
  const { rubricId } = await params;
  const rubric = await getRubric(Number(rubricId));
  if (!rubric) notFound();

  const settings = rubric.settings ?? null;

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
      {isShareModel({ settings }) ? (
        <EditRubricClient
          rubricId={Number(rubricId)}
          initialData={toNormalRubric({
            name: rubric.name,
            description: rubric.description ?? null,
            settings,
            criteria: rubric.criteria.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              share: c.weight,
              levels: c.levels,
            })),
          })}
        />
      ) : (
        // Deliberately not opened in the editor anyway. `toNormalRubric` would
        // hand it the DEFAULT band edges, which are not the ones its stored
        // points were written against — so the editor would show a calibration
        // this rubric has never used, and saving would apply it to everyone
        // already graded.
        <UnconvertedRubricNotice name={rubric.name} />
      )}
    </PageContainer>
  );
}
