"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArtReviewer,
  type ReviewDataAdapter,
  type ReviewItem,
} from "@grader/art-review";
import { useGrading } from "@/components/shared/grading-context";
import { StudentNavBar } from "@/components/shared/student-nav-bar";
import { useReviewChannel } from "@/lib/review-channel";
import {
  appendStrokes,
  deleteStrokes,
  getMarkers,
  getStrokes,
  listReviewItems,
  loadPrefs,
  savePrefs,
} from "@/actions/review";

interface Props {
  assignmentId: number;
  assignmentName: string;
  author: { id: string; name: string; color: number };
}

/**
 * Grader's adapter for the art review module.
 *
 * Everything grader-specific lives here: what a "student" is, where files come
 * from, how the channel is routed. The module itself knows none of it.
 */
export function ReviewClient({ assignmentId, assignmentName, author }: Props) {
  /**
   * Take the app shell out of scroll for this route only.
   *
   * `<main>` is `overflow-auto` for every other page, and a scroll container
   * wrapped around a drawing surface gives iPadOS something to arbitrate: it
   * withholds pencil input while deciding whether a drag belongs to the page.
   * A diagnostic capture of a lost letter showed no contact events reaching the
   * page at all, with even the hover rate collapsing from ~120 Hz to ~8 Hz for
   * its duration.
   *
   * This page sizes itself to the viewport, so it never needed to scroll.
   * Restored on unmount — every other page still wants it.
   */
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const prevOverflow = main.style.overflow;
    const prevTouch = main.style.touchAction;
    main.style.overflow = "hidden";
    main.style.touchAction = "none";
    return () => {
      main.style.overflow = prevOverflow;
      main.style.touchAction = prevTouch;
    };
  }, []);

  const { selectedStudentId, students } = useGrading();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextId = useMemo(
    () => (selectedStudentId ? `assignment:${assignmentId}:student:${selectedStudentId}` : null),
    [assignmentId, selectedStudentId],
  );

  // Rides grader's existing global sync bus rather than opening a third SSE
  // stream per tab — see review-channel.ts. Scoped by contextId so transport
  // events for one student never drive another's review.
  const channel = useReviewChannel(contextId);

  useEffect(() => {
    if (!contextId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // First open of a submission transcodes an all-intra proxy, so this can
    // take a few seconds; afterwards the derivatives are on disk.
    listReviewItems(contextId)
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load media");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contextId]);

  const adapter: ReviewDataAdapter = useMemo(
    () => ({
      listItems: listReviewItems,
      getStrokes: (itemId, sinceSeq) => getStrokes(itemId, sinceSeq),
      appendStrokes: (itemId, strokes) => appendStrokes(itemId, strokes),
      deleteStrokes: (itemId, ids) => deleteStrokes(itemId, ids),
      getMarkers: (itemId) => getMarkers(itemId),
      getLayers: async (itemId) => {
        const submissionId = itemId.replace("sub:", "");
        const res = await fetch(`/api/review/layers/${submissionId}`);
        if (!res.ok) throw new Error("no layer manifest");
        return res.json();
      },
      savePrefs,
      loadPrefs,
      // Dev-loop affordance: the input log's Send button lands its dump next to
      // the source rather than in Files on a tablet. The route is 404 in prod.
      sendDiagnostics: async (name, text) => {
        const res = await fetch("/api/review/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, text }),
        });
        if (!res.ok) throw new Error(`server said ${res.status}`);
        const { path } = (await res.json()) as { path: string };
        return path;
      },
    }),
    [],
  );

  const student = students.find((s) => s.id === selectedStudentId);

  if (!selectedStudentId) {
    return <Centered>Select a student to begin the review.</Centered>;
  }
  if (loading) {
    return <Centered>Preparing media for {student?.name ?? "student"}…</Centered>;
  }
  if (error) {
    return <Centered tone="error">{error}</Centered>;
  }
  if (items.length === 0) {
    return <Centered>No submissions for {student?.name ?? "this student"}.</Centered>;
  }
  if (!channel) return null;

  return (
    <ArtReviewer
      // Remount per student: sources, caches and stroke state are all scoped
      // to one student's playlist.
      key={contextId}
      items={items}
      adapter={adapter}
      channel={channel}
      author={author}
      pdfWorkerUrl="/pdf.worker.min.mjs"
      headerSlot={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#adaaaa" }}>{assignmentName}</span>
          <StudentNavBar />
        </div>
      }
    />
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: tone === "error" ? "#fca5a5" : "#adaaaa",
        fontSize: 14,
        background: "#0e0e0e",
      }}
    >
      {children}
    </div>
  );
}
