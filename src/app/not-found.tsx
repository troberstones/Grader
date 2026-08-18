import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

export default function NotFound() {
  return (
    <PageContainer>
      <Card className="max-w-md mx-auto mt-16">
        <CardContent className="pt-6 text-center space-y-4">
          <h2 className="text-lg font-semibold">Page not found</h2>
          <p className="text-sm text-muted-foreground">
            There&apos;s nothing here. It may have been moved or deleted.
          </p>
          <LinkButton href="/">Back to dashboard</LinkButton>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
