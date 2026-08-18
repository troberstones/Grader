"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Copy, KeyRound, Plus, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GLOBAL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, isGlobalRole, type GlobalRole } from "@/lib/auth/roles";
import {
  forceSignOut,
  inviteUser,
  resetPassword,
  setCanViewArchive,
  setUserRole,
  setUserStatus,
  type AccountRow,
} from "@/actions/auth";

export function UserAdmin({ accounts, currentUserId }: { accounts: AccountRow[]; currentUserId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(accounts.length <= 1);
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string; label: string; emailSent: boolean } | null>(null);
  // Controlled rather than read from FormData: the role must be one of ours
  // whether or not the Select renders a hidden input.
  const [inviteRole, setInviteRole] = useState<GlobalRole>("instructor");

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error ?? "That did not work.");
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "");

    startTransition(async () => {
      const result = await inviteUser({
        name,
        email: String(data.get("email") ?? ""),
        globalRole: inviteRole,
      });

      if (!result.ok || !result.inviteUrl) {
        toast.error(result.error ?? "Could not create the invitation.");
        return;
      }

      setInviteLink({
        name,
        url: new URL(result.inviteUrl, window.location.origin).toString(),
        label: "Invitation",
        emailSent: !!result.emailSent,
      });
      form.reset();
      router.refresh();
    });
  }

  function onResetPassword(account: AccountRow) {
    startTransition(async () => {
      const result = await resetPassword(account.id);
      if (!result.ok || !result.inviteUrl) {
        toast.error(result.error ?? "Could not create a reset link.");
        return;
      }
      setInviteLink({
        name: account.name,
        url: new URL(result.inviteUrl, window.location.origin).toString(),
        label: "Password reset link",
        emailSent: !!result.emailSent,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {/* ── Invite ─────────────────────────────────────────────── */}
      <div>
        {!inviteOpen ? (
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Invite someone
          </Button>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={onInvite} className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-48 flex-1">
                  <Label htmlFor="invite-name">Name</Label>
                  <Input id="invite-name" name="name" required disabled={pending} />
                </div>
                <div className="space-y-2 min-w-56 flex-1">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input id="invite-email" name="email" type="email" required disabled={pending} />
                </div>
                <div className="space-y-2 min-w-44">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(role) => isGlobalRole(role) && setInviteRole(role)}
                    disabled={pending}
                  >
                    <SelectTrigger id="invite-role" className="w-full">
                      <SelectValue>{(role) => ROLE_LABELS[role as GlobalRole] ?? String(role)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {GLOBAL_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={pending}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {pending ? "Creating…" : "Create invitation"}
                </Button>
              </form>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                This also emails the link when the server can send mail — copy it and share it directly if
                email doesn&apos;t arrive. It works once, expires in seven days, and the person sets their own
                password, which you never see.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* The link is shown exactly once: only its hash is stored, so it cannot
          be retrieved later and a lost link needs a fresh invitation. */}
      {inviteLink && (
        <InviteLink name={inviteLink.name} url={inviteLink.url} label={inviteLink.label} emailSent={inviteLink.emailSent} />
      )}

      {/* ── Accounts ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last signed in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const self = account.id === currentUserId;
                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">
                        {account.name}
                        {self && <span className="ml-2 text-xs text-muted-foreground">you</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{account.email}</div>
                    </TableCell>

                    <TableCell>
                      <Select
                        value={account.globalRole}
                        disabled={pending}
                        onValueChange={(role) => {
                          // Base UI hands back `string | null`, and a role that
                          // is not one of ours must not reach the action.
                          if (!isGlobalRole(role)) return;
                          if (role === account.globalRole) return;
                          run(
                            () => setUserRole(account.id, role),
                            `${account.name} is now a ${ROLE_LABELS[role].toLowerCase()}.`,
                          );
                        }}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue>{(role) => ROLE_LABELS[role as GlobalRole] ?? String(role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {GLOBAL_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              <span className="flex flex-col items-start">
                                <span>{ROLE_LABELS[role]}</span>
                                <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    <TableCell>
                      <StatusBadge account={account} />
                    </TableCell>

                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {account.lastLoginAt ? account.lastLoginAt.slice(0, 16) : "never"}
                    </TableCell>

                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      {account.status === "active" && (
                        <Button
                          variant={account.canViewArchive ? "secondary" : "ghost"}
                          size="sm"
                          disabled={pending}
                          title="Toggle access to the cross-course student archive"
                          onClick={() =>
                            run(
                              () => setCanViewArchive(account.id, !account.canViewArchive),
                              account.canViewArchive
                                ? `${account.name} can no longer view the archive.`
                                : `${account.name} can now view the archive.`,
                            )
                          }
                        >
                          <Archive className="mr-2 h-4 w-4" />
                          Archive
                        </Button>
                      )}
                      {account.status === "active" && (
                        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResetPassword(account)}>
                          <KeyRound className="mr-2 h-4 w-4" />
                          Reset password
                        </Button>
                      )}
                      {account.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => forceSignOut(account.id), `Signed ${account.name} out everywhere.`)}
                        >
                          Sign out
                        </Button>
                      )}
                      {account.status === "disabled" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => setUserStatus(account.id, "active"), `${account.name} can sign in again.`)}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Enable
                        </Button>
                      ) : (
                        !self &&
                        account.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => setUserStatus(account.id, "disabled"), `${account.name} is disabled.`)}
                          >
                            <UserMinus className="mr-2 h-4 w-4" />
                            Disable
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ account }: { account: AccountRow }) {
  if (account.status === "disabled") return <Badge variant="destructive">Disabled</Badge>;
  if (account.status === "invited") {
    return account.inviteExpired ? (
      <Badge variant="outline">Invitation expired</Badge>
    ) : (
      <Badge variant="secondary">Invited</Badge>
    );
  }
  return <Badge variant="outline">Active</Badge>;
}

function InviteLink({
  name,
  url,
  label = "Invitation",
  emailSent,
}: {
  name: string;
  url: string;
  label?: string;
  emailSent: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm mb-3">
          {label} for <span className="font-medium">{name}</span>. Send them this link — it is shown only once.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        {emailSent ? (
          <p className="mt-2 text-xs text-muted-foreground">Also emailed to the address on file.</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Could not send an email — share this link directly.</p>
        )}
      </CardContent>
    </Card>
  );
}
