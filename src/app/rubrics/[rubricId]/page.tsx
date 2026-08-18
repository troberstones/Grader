import { notFound } from "next/navigation";
import { getRubric } from "@/actions/rubrics";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { EditRubricClient } from "./edit-rubric-client";
import { isShareModel, toNormalRubric } from "@/lib/rubric";
import type { RubricEditorKey } from "@/components/rubric/registry";

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
  const share = isShareModel({ settings });
  // Opens on whichever editor this rubric already declares itself as, so a
  // v3-authored rubric doesn't land on an editor that would silently
  // discard its calibration. The toggle still lets you switch deliberately
  // — same as today, switching mid-edit already discards in-progress state.
  const initialKey: RubricEditorKey = share ? "share" : settings?.gradingMode === "v3" ? "v3" : "v1";

  const legacyInitialData = {
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
        // Legacy/v3 rubrics always have a real number here.
        points: l.points ?? 0,
      })),
    })),
  };

  const shareInitialData = share
    ? toNormalRubric({
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
      })
    : null;

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
      <EditRubricClient
        rubricId={Number(rubricId)}
        initialKey={initialKey}
        legacyInitialData={legacyInitialData}
        shareInitialData={shareInitialData}
      />
    </PageContainer>
  );
}
