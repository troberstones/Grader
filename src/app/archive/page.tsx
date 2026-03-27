import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";

export default function ArchivePage() {
  return (
    <PageContainer>
      <Header
        title="Archive"
        description="Archived assignments and student work"
      />
      <div className="text-center py-12 text-muted-foreground">
        <p>Archive will be available in Phase 7.</p>
      </div>
    </PageContainer>
  );
}
