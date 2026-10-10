import { useEffect, useState } from "react";
import type { ViewerState } from "@grader/art-review";

/**
 * Where the art reviewer was left, per student, for the life of the tab.
 *
 * The reviewer remounts for every student and unmounts entirely on the trip to
 * the grade sheet, and each mount used to start from the first file at frame 0,
 * fitted. This keeps the whole view — file, frame, zoom and pan (per file),
 * colour, flips, layers, and whether a second file was open beside it — so
 * coming back, or reloading, finds the review as it was.
 *
 * sessionStorage rather than localStorage: this is "where I was just now", not
 * a preference. Two tabs reviewing the same student should not fight over it,
 * and next week's session should open clean.
 */

const KEY_PREFIX = "grader.reviewView:";
const WRITE_DELAY_MS = 300;

export interface SavedReviewView {
  /** The open file by id — an index goes stale when the playlist changes. */
  itemId: string | null;
  compareId: string | null;
  state: Partial<ViewerState>;
}

export interface ReviewViewMemory {
  load(contextId: string): SavedReviewView | null;
  save(contextId: string, view: SavedReviewView): void;
  flush(): void;
}

function createMemory(): ReviewViewMemory {
  // Authoritative for this page; storage is written behind it, because the
  // viewer reports every frame while playing.
  const views = new Map<string, SavedReviewView>();
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    for (const id of dirty) {
      try {
        window.sessionStorage.setItem(KEY_PREFIX + id, JSON.stringify(views.get(id)));
      } catch {
        // Full or unavailable: the in-memory copy still covers this page.
      }
    }
    dirty.clear();
  }

  return {
    load(contextId) {
      const held = views.get(contextId);
      if (held) return held;
      if (typeof window === "undefined") return null;
      try {
        const raw = window.sessionStorage.getItem(KEY_PREFIX + contextId);
        const parsed = raw ? (JSON.parse(raw) as SavedReviewView) : null;
        return parsed && typeof parsed.state === "object" && parsed.state ? parsed : null;
      } catch {
        return null;
      }
    },
    save(contextId, view) {
      views.set(contextId, view);
      dirty.add(contextId);
      timer ??= setTimeout(flush, WRITE_DELAY_MS);
    },
    flush,
  };
}

export function useReviewViewMemory(): ReviewViewMemory {
  const [memory] = useState(createMemory);
  useEffect(() => {
    // pagehide covers a reload or a closed laptop; the cleanup covers leaving
    // for the grade sheet inside the write delay.
    window.addEventListener("pagehide", memory.flush);
    return () => {
      window.removeEventListener("pagehide", memory.flush);
      memory.flush();
    };
  }, [memory]);
  return memory;
}
