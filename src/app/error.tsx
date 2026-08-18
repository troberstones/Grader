"use client";

import { useEffect } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Catches failures in pages and nested layouts below the root — the root
// layout's own render (currentAccount(), needsBootstrap()) is out of reach
// here and can only be caught by global-error.tsx. See that file.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <Card className="max-w-md mx-auto mt-16">
        <CardContent className="pt-6 text-center space-y-4">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. Try again, or come back later if it keeps happening.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">Reference: {error.digest}</p>
          )}
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
