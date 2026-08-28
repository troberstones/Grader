"use client";

import { createContext, useContext } from "react";
import type { SessionMode } from "@/lib/auth/roles";

/**
 * The current session's mode, for the client tree.
 *
 * This is presentation only. Everything it hides is independently refused by
 * `can()` on the server (see src/lib/auth/roles.ts), because every exported
 * server action is reachable by RPC whether or not a button for it is
 * rendered. Hiding a control here is about not offering something that would
 * be refused — and, in review mode, about not putting evaluation on a screen
 * the room can see. It is never the thing that makes it safe.
 *
 * Defaults to "grade" so a component rendered outside the provider (a test, a
 * future route that forgets it) behaves exactly as it did before modes existed.
 */
const SessionModeContext = createContext<SessionMode>("grade");

export function SessionModeProvider({
  mode,
  children,
}: {
  mode: SessionMode;
  children: React.ReactNode;
}) {
  return <SessionModeContext.Provider value={mode}>{children}</SessionModeContext.Provider>;
}

export function useSessionMode(): SessionMode {
  return useContext(SessionModeContext);
}

/** Sugar for the common check, so call sites read as prose. */
export function useIsReviewing(): boolean {
  return useSessionMode() === "review";
}
