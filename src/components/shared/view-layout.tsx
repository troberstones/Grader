"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useIsReviewing } from "./session-mode";

/**
 * Below this the rubric cannot dock beside the artwork — there simply isn't the
 * width for a viewer and a criterion table at once. iPad portrait (768pt) sits
 * under it deliberately; landscape (1024pt) is exactly at it.
 */
const DOCK_QUERY = "(min-width: 1024px)";

const STORAGE_KEY = "grader.rubricDocked";

interface ViewLayoutValue {
  /** The window is wide enough to show artwork and rubric side by side. */
  canDock: boolean;
  /** The instructor wants the dock open. Only meaningful when `canDock`. */
  rubricDocked: boolean;
  setRubricDocked: (open: boolean) => void;
}

const ViewLayoutContext = createContext<ViewLayoutValue | null>(null);

export function useViewLayout() {
  const ctx = useContext(ViewLayoutContext);
  if (!ctx) throw new Error("useViewLayout must be used inside <ViewLayoutProvider>");
  return ctx;
}

/**
 * Where the rubric sits relative to the artwork.
 *
 * Lives in the grading shell rather than in the review page because the control
 * that drives it is in the shell's own header row — the switch is part of the
 * page structure, not part of the viewer. The art review module knows nothing
 * about any of this.
 *
 * Both values are read through useSyncExternalStore rather than being mirrored
 * into state: the window width and localStorage are external stores, and the
 * server snapshot (`false` for both) is what keeps hydration honest.
 */
export function ViewLayoutProvider({ children }: { children: ReactNode }) {
  const wideEnough = useSyncExternalStore(subscribeMedia, mediaSnapshot, serverFalse);
  const rubricDocked = useSyncExternalStore(subscribeDock, dockSnapshot, serverFalse);
  const reviewing = useIsReviewing();

  // A review session can never dock, however wide the window.
  //
  // This has to be denied here rather than by hiding the dock button, because
  // `rubricDocked` is localStorage: dock the rubric while grading, sign out,
  // sign back in to review, and the flag is still set — the rubric would come
  // straight back onto a screen the room can see, with no control on it to
  // close it. Withholding `canDock` closes that off for every consumer of this
  // context at once, including any added later.
  const canDock = wideEnough && !reviewing;

  const setRubricDocked = useCallback((open: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    // `storage` only fires in *other* tabs, so this tab needs telling directly.
    for (const listener of dockListeners) listener();
  }, []);

  return (
    <ViewLayoutContext.Provider value={{ canDock, rubricDocked, setRubricDocked }}>
      {children}
    </ViewLayoutContext.Provider>
  );
}

const serverFalse = () => false;

function subscribeMedia(onChange: () => void) {
  const mq = window.matchMedia(DOCK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function mediaSnapshot() {
  return window.matchMedia(DOCK_QUERY).matches;
}

const dockListeners = new Set<() => void>();

function subscribeDock(onChange: () => void) {
  dockListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    dockListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function dockSnapshot() {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}
