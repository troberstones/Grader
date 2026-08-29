/**
 * In-memory pub/sub for ingest progress, keyed by submissionId — same pattern
 * as the assignment sync channel (src/app/api/sync/[assignmentId]/route.ts),
 * but the publisher here is server-side ingest code in the same process
 * rather than another client's request, so there's no POST side.
 */

type Listener = (stage: string, pct?: number) => void;

const listeners = new Map<number, Set<Listener>>();

export function publishIngestProgress(submissionId: number, stage: string, pct?: number): void {
  const set = listeners.get(submissionId);
  if (!set) return;
  for (const listener of set) listener(stage, pct);
}

export function subscribeIngestProgress(submissionId: number, listener: Listener): () => void {
  if (!listeners.has(submissionId)) listeners.set(submissionId, new Set());
  listeners.get(submissionId)!.add(listener);
  return () => {
    const set = listeners.get(submissionId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) listeners.delete(submissionId);
  };
}
