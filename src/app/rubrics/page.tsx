import { getRubrics } from "@/actions/rubrics";

export const dynamic = "force-dynamic";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { RubricLibrary } from "./rubric-library";
import { Plus } from "lucide-react";

export default async function RubricsPage() {
  const rubrics = await getRubrics();

  return (
    <PageContainer>
      <Header
        title="Rubrics"
        description="Create and manage grading rubrics"
        actions={
          <LinkButton href="/rubrics/new">
            <Plus className="mr-2 h-4 w-4" />
            New Rubric
          </LinkButton>
        }
      />
      <RubricLibrary rubrics={rubrics} />
    </PageContainer>
  );
}
