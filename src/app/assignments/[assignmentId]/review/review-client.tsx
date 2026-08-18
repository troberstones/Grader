"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArtReviewer,
  type ReviewDataAdapter,
  type ReviewItem,
} from "@grader/art-review";
import { useGrading } from "@/components/shared/grading-context";
import { StudentNavBar } from "@/components/shared/student-nav-bar";
import { useViewLayout } from "@/components/shared/view-layout";
import { RubricDock } from "@/components/rubric/rubric-dock";
import { MediaDropZone } from "@/components/review/media-drop-zone";
import { useReviewChannel } from "@/lib/review-channel";
import { uploadFiles } from "@/lib/media-upload";
import type { getAssignment } from "@/actions/assignments";
import { deleteSubmission } from "@/actions/submissions";
import {
  appendStrokes,
  deleteStrokes,
  getMarkers,
  getStrokes,
  listReviewItems,
  loadPrefs,
  savePrefs,
} from "@/actions/review";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

interface Props {
  assignment: Assignment;
  author: { id: string; name: string; color: number };
}

/**
 * Grader's adapter for the art review module.
 *
 * Everything grader-specific lives here: what a "student" is, where files come
 * from, how the channel is routed. The module itself knows none of it.
 */
export function ReviewClient({ assignment, author }: Props) {
  const assignmentId = assignment.id;
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
   *
   * Only `overflow` is touched. This used to set `touch-action: none` here as
   * well, from the same theory; the real culprit turned out to be iPadOS
   * Scribble, and a `none` on this shared ancestor cannot be re-enabled by a
   * descendant — which would leave the docked rubric unscrollable by touch.
   * The module sets `touch-action: none` on its own stage, where it belongs.
   */
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const prevOverflow = main.style.overflow;
    main.style.overflow = "hidden";
    return () => {
      main.style.overflow = prevOverflow;
    };
  }, []);

  const { selectedStudentId, students } = useGrading();
  const { canDock, rubricDocked } = useViewLayout();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [contextId, refreshKey]);

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
      addItems: async (contextId, files) => {
        const m = contextId.match(/^assignment:(\d+):student:(\d+)$/);
        if (!m) throw new Error("Unrecognized context.");
        await uploadFiles(Number(m[1]), Number(m[2]), files);
      },
      removeItem: async (itemId) => {
        await deleteSubmission(Number(itemId.replace("sub:", "")));
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

  const viewer = !selectedStudentId ? (
    <Centered>Select a student to begin the review.</Centered>
  ) : loading ? (
    <Centered>Preparing media for {student?.name ?? "student"}…</Centered>
  ) : error ? (
    <Centered tone="error">{error}</Centered>
  ) : items.length === 0 && selectedStudentId ? (
    <MediaDropZone
      assignmentId={assignmentId}
      studentId={selectedStudentId}
      studentName={student?.name ?? "this student"}
      submissionType={assignment.submissionType as "image" | "video" | "any"}
      onUploaded={() => setRefreshKey((k) => k + 1)}
    />
  ) : !channel ? null : (
    <ArtReviewer
      // Remount per student: sources, caches and stroke state are all scoped
      // to one student's playlist.
      key={contextId}
      items={items}
      adapter={adapter}
      channel={channel}
      author={author}
      contextId={contextId!}
      onItemsChanged={() => setRefreshKey((k) => k + 1)}
      pdfWorkerUrl="/pdf.worker.min.mjs"
      headerSlot={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#adaaaa" }}>{assignment.name}</span>
          <StudentNavBar />
        </div>
      }
    />
  );

  /*
   * The rubric docks beside the artwork rather than inside it. Everything to the
   * left of the divider is the module and knows nothing about grades; everything
   * to the right is grader's own. That separation is the point — scores must not
   * become viewer state, because viewer state is what gets broadcast to the
   * other machines. See docs/security.md.
   */
  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>{viewer}</div>
      {canDock && rubricDocked && selectedStudentId && (
        <RubricDock assignment={assignment} />
      )}
    </div>
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
