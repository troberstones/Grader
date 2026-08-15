"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { acceptInvite } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function AcceptForm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(acceptInvite.bind(null, token), null);

  useEffect(() => {
    if (state?.ok) {
      router.replace("/");
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" defaultValue={name} required disabled={pending} />
        <p className="text-xs text-muted-foreground">Correct it here if it is wrong.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          At least {MIN_PASSWORD_LENGTH} characters. Nobody else sees it, including whoever invited you.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required disabled={pending} />
      </div>

      <FormError>{state && !state.ok ? state.error : null}</FormError>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Setting up…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
