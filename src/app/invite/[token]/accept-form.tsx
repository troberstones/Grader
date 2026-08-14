"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { acceptInvite } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export function AcceptForm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await acceptInvite(token, { name: String(form.get("name") ?? ""), password });
      if (!result.ok) {
        setError(result.error ?? "Could not set your password.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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

      <FormError>{error}</FormError>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Setting up…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
