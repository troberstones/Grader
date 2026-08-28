"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Image as ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { signIn } from "@/actions/auth";
import type { SessionMode } from "@/lib/auth/roles";

/**
 * Sign in, and choose what the session is for while doing it.
 *
 * The mode is picked here rather than on a screen after sign-in so that a
 * session is never half-formed: there is no window in which someone is
 * authenticated but has not yet said what they are here to do, and therefore
 * no state every guard would have to handle. It cannot be changed afterwards —
 * leaving review mode means signing out — so this is the only place it is set.
 *
 * "Grade" is rendered first deliberately. Submitting a form with Enter uses the
 * first submit button in the document, so the keyboard path lands on the
 * unrestricted session the app has always given, and review mode is never
 * entered by accident.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signIn, null);
  const [chosen, setChosen] = useState<SessionMode | null>(null);

  useEffect(() => {
    if (state?.ok) {
      // A review session cannot reach the grade sheet, so it starts at the
      // assignment list rather than at `next`, which may well be a page it is
      // about to be redirected out of.
      router.replace(chosen === "review" ? "/assignments" : next);
      // The layout renders the signed-in user, so the tree has to be re-fetched
      // rather than served from the client router cache.
      router.refresh();
    }
  }, [state, next, chosen, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>

      <FormError>{state && !state.ok ? state.error : null}</FormError>

      <div className="space-y-2">
        <ModeButton
          mode="grade"
          icon={ClipboardList}
          label="Sign in to grade"
          detail="Rubrics, scores and assignment editing."
          pending={pending}
          chosen={chosen}
          onChoose={setChosen}
        />
        <ModeButton
          mode="review"
          icon={ImageIcon}
          label="Sign in to review"
          detail="Artwork and annotation only — no rubric or scores on screen."
          variant="outline"
          pending={pending}
          chosen={chosen}
          onChoose={setChosen}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        A review session is fixed until you sign out. Choose it when the screen
        is shared with the room.
      </p>
    </form>
  );
}

function ModeButton({
  mode,
  icon: Icon,
  label,
  detail,
  variant = "default",
  pending,
  chosen,
  onChoose,
}: {
  mode: SessionMode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  variant?: "default" | "outline";
  pending: boolean;
  chosen: SessionMode | null;
  onChoose: (mode: SessionMode) => void;
}) {
  // `name`/`value` on the submitter is what tells the action which was pressed;
  // the click handler only records it for this component's own pending label.
  return (
    <Button
      type="submit"
      name="mode"
      value={mode}
      variant={variant}
      onClick={() => onChoose(mode)}
      disabled={pending}
      className="w-full h-auto flex-col items-start gap-0.5 py-2.5 text-left"
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4 shrink-0" />
        {pending && chosen === mode ? "Signing in…" : label}
      </span>
      <span className="text-xs font-normal opacity-80">{detail}</span>
    </Button>
  );
}
