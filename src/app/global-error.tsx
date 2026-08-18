"use client";

// The root layout itself does DB-backed work during render (currentAccount(),
// needsBootstrap() — see layout.tsx) — a failure there can only be caught
// here, since a segment's error.tsx does not catch errors thrown by that
// segment's own layout.tsx. This file replaces the whole document, so it's
// kept dependency-free: no shared components, no DB calls, nothing that
// could itself fail the way the thing it's catching just did.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#0e0e0e",
          color: "#f5f5f5",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 400, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#a3a3a3", marginBottom: 16 }}>
            The application failed to load. Try again, or come back later if it keeps happening.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#a3a3a3", fontFamily: "monospace", marginBottom: 16 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              background: "#e8672c",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
