import { requireGradeSession } from "@/lib/auth/session";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";

export default async function AnalyticsPage() {
  await requireGradeSession();
  return (
    <PageContainer>
      <Header
        title="Analytics"
        description="Grade trends and performance analytics"
      />
      <div className="text-center py-12 text-muted-foreground">
        <p>Analytics will be available in Phase 8.</p>
      </div>
    </PageContainer>
  );
}
