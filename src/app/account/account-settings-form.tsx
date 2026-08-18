"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/auth/auth-shell";
import { changeOwnPassword, updateOwnProfile } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { ROLE_LABELS, type GlobalRole } from "@/lib/auth/roles";

interface AccountUser {
  name: string;
  email: string;
  globalRole: GlobalRole;
}

export function AccountSettingsForm({ user }: { user: AccountUser }) {
  return (
    <div className="space-y-6 max-w-lg">
      <ProfileCard user={user} />
      <PasswordCard />
    </div>
  );
}

function ProfileCard({ user }: { user: AccountUser }) {
  const [state, formAction, pending] = useActionState(updateOwnProfile, null);

  useEffect(() => {
    if (state?.ok) toast.success("Profile updated.");
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-medium">Profile</h3>
          <Badge variant="outline">{ROLE_LABELS[user.globalRole] ?? user.globalRole}</Badge>
        </div>

        {/* Keyed on the saved values: a successful save re-renders this with a
            new `user` prop while the form stays mounted, and Base UI's Input
            warns when `defaultValue` changes under an already-initialized
            field. Remounting on save is exactly the right behavior here —
            the DOM value and the new default are identical at that instant. */}
        <form key={`${user.name}:${user.email}`} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={user.name} required disabled={pending} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={user.email}
              required
              disabled={pending}
            />
          </div>

          <FormError>{state && !state.ok ? state.error : null}</FormError>

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [state, formAction, pending] = useActionState(changeOwnPassword, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Password changed.");
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-sm font-medium mb-5">Password</h3>

        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
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
            <Label htmlFor="confirm">Confirm new password</Label>
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

          <Button type="submit" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
