"use client";

import { useEffect, useState } from "react";

/**
 * Live-formatted label for whichever of `submissionIds` most recently
 * reported ingest progress (see src/lib/ingest-progress.ts and
 * src/app/api/review/ingest-progress/[submissionId]/route.ts). Returns null
 * until the first event arrives, so callers should fall back to a static
 * label — a submission that's already ingested, or an image that needs no
 * transcode, may never publish anything.
 */
export function useIngestProgress(submissionIds: number[]): string | null {
  const key = submissionIds.join(",");
  const [label, setLabel] = useState<string | null>(null);

  // Reset during render rather than at the top of the effect below: adjusting
  // state when a prop changes belongs in render, not in an effect.
  // See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [labelFor, setLabelFor] = useState(key);
  if (labelFor !== key) {
    setLabelFor(key);
    setLabel(null);
  }

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").map(Number);
    const sources = ids.map((id) => {
      const es = new EventSource(`/api/review/ingest-progress/${id}`);
      es.onmessage = (e) => {
        try {
          const { stage, pct } = JSON.parse(e.data) as { stage: string; pct?: number };
          setLabel(typeof pct === "number" ? `${stage}… ${pct}%` : `${stage}…`);
        } catch {
          // malformed event — ignore
        }
      };
      return es;
    });
    return () => sources.forEach((es) => es.close());
  }, [key]);

  return label;
}
