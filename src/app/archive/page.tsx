import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { ArchiveSearch } from "./archive-search";

export default function ArchivePage() {
  return (
    <PageContainer>
      <Header
        title="Student Archive"
        description="A student's submissions, grades, and annotations across every course they've been enrolled in."
      />
      <ArchiveSearch />
    </PageContainer>
  );
}
