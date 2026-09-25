"use client";

import { useEffect, useMemo, useState } from "react";
import { ArtReviewer, type ReviewChannel, type ReviewDataAdapter, type ReviewItem } from "@grader/art-review";

import { feedbackMarkers, feedbackReviewItems, feedbackStrokes } from "@/actions/feedback-view";

/**
 * The student's work with its annotations, in the reviewer, read-only. The
 * adapter reads through the link token (src/actions/feedback-view.ts) and
 * refuses every write; the reviewer's `readOnly` hides the tools that would
 * attempt one.
 */

// A room of one: nothing to sync with, so nothing to send or receive.
const soloChannel: ReviewChannel = {
  send() {},
  subscribe: () => () => {},
  clientId: "feedback-viewer",
  connected: true,
  onConnectionChange: () => () => {},
};

const viewer = { id: "student", name: "Student", color: 0x7aa2ffff };

function readOnlyError(): Promise<never> {
  return Promise.reject(new Error("This feedback is view-only."));
}

export function FeedbackReviewer({ token }: { token: string }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    feedbackReviewItems(token)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your work."));
  }, [token]);

  const adapter: ReviewDataAdapter = useMemo(
    () => ({
      listItems: () => feedbackReviewItems(token),
      getStrokes: (itemId) => feedbackStrokes(token, itemId),
      getMarkers: (itemId) => feedbackMarkers(token, itemId),
      getLayers: async (itemId) => {
        const res = await fetch(`/api/review/layers/${itemId.replace("sub:", "")}?ft=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error("no layer manifest");
        return res.json();
      },
      appendStrokes: readOnlyError,
      deleteStrokes: readOnlyError,
    }),
    [token],
  );

  if (error) return <Message>{error}</Message>;
  if (!items) return <Message>Loading your work…</Message>;
  if (items.length === 0) return <Message>There&rsquo;s no submitted work to show for this assignment.</Message>;

  return (
    <div className="h-full min-h-[60dvh] overflow-hidden rounded-xl">
      <ArtReviewer
        items={items}
        adapter={adapter}
        channel={soloChannel}
        author={viewer}
        contextId={`feedback:${token.slice(0, 8)}`}
        pdfWorkerUrl="/pdf.worker.min.mjs"
        readOnly
      />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[40dvh] items-center justify-center rounded-xl bg-card text-sm text-muted-foreground">
      {children}
    </div>
  );
}
