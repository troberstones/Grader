"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { signIn } from "@/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signIn, null);

  useEffect(() => {
    if (state?.ok) {
      router.replace(next);
      // The layout renders the signed-in user, so the tree has to be re-fetched
      // rather than served from the client router cache.
      router.refresh();
    }
  }, [state, next, router]);

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

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
