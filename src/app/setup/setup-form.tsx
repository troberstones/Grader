"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { bootstrapAdmin } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function SetupForm() {
  // bootstrapAdmin() redirects itself on success — nothing to react to here.
  const [state, formAction, pending] = useActionState(bootstrapAdmin, null);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required autoFocus disabled={pending} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required disabled={pending} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          At least {MIN_PASSWORD_LENGTH} characters. A short phrase you can remember beats a mangled word.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
        />
      </div>

      <FormError>{state && !state.ok ? state.error : null}</FormError>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create administrator"}
      </Button>
    </form>
  );
}
