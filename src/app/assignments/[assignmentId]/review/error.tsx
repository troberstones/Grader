"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/**
 * Error boundary for the review route only.
 *
 * `error.tsx` wraps `page.tsx` in this segment but not the `[assignmentId]`
 * layout above it (GradingShell — the student roster and nav chrome), so a
 * crash in the viewer still leaves the instructor able to pick a different
 * student rather than losing the whole page to a blank screen. Sized and
 * colored to sit inside the same dark content area `ReviewClient` renders
 * into, so this doesn't read as a jarring theme break mid-session.
 */
export default function ReviewError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("art-review viewer crashed:", error);
  }, [error]);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 480,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e0e0e",
      }}
    >
      <div
        role="alert"
        style={{
          maxWidth: 460,
          textAlign: "center",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, color: "#f4f4f4" }}>The reviewer hit a problem</div>
        <div style={{ fontSize: 12, color: "#adaaaa", lineHeight: 1.6 }}>
          Something went wrong while showing this student&rsquo;s work. Retrying re-loads the
          viewer without leaving this page — pick another student from the roster if it keeps
          happening.
        </div>
        {error.digest && (
          <div style={{ fontSize: 11, color: "#6b6b6b", fontFamily: "monospace" }}>
            Reference: {error.digest}
          </div>
        )}
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            font: "inherit",
            fontSize: 12,
            color: "#0e0e0e",
            background: "#fca5a5",
            border: "none",
            borderRadius: 6,
            padding: "6px 16px",
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
