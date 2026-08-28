"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStudentsForCourse } from "@/actions/students";
import { createUploadLink, sendUploadLinks, listUploadLinks, revokeUploadLink, type UploadLinkRow } from "@/actions/upload-links";

interface Student {
  id: number;
  name: string;
  sortName: string;
  email: string | null;
}

export function SendUploadLinkDialog({ assignmentId, courseId }: { assignmentId: number; courseId: number }) {
  const [open, setOpen] = useState(false);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [creatingShared, setCreatingShared] = useState(false);
  const [links, setLinks] = useState<UploadLinkRow[] | null>(null);

  useEffect(() => {
    if (open && students === null) {
      getStudentsForCourse(courseId).then((rows) => setStudents(rows));
    }
  }, [open, courseId, students]);

  function refreshLinks() {
    listUploadLinks(assignmentId).then(setLinks);
  }

  useEffect(() => {
    if (open) refreshLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleRevoke(id: number) {
    await revokeUploadLink(id);
    refreshLinks();
  }

  const activeCount = links ? links.filter((l) => !l.revokedAt && !l.expired).length : 0;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!students) return;
    setSelected((prev) => (prev.size === students.length ? new Set() : new Set(students.map((s) => s.id))));
  }

  async function handleSendPerStudent() {
    if (selected.size === 0) return toast.error("Select at least one student.");
    setSending(true);
    try {
      const result = await sendUploadLinks(assignmentId, Array.from(selected), "per-student");
      reportResult(result);
      refreshLinks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send links.");
    } finally {
      setSending(false);
    }
  }

  async function handleCreateShared() {
    setCreatingShared(true);
    try {
      const result = await createUploadLink(assignmentId, null);
      if (result.ok && result.url) {
        setSharedUrl(new URL(result.url, window.location.origin).toString());
        refreshLinks();
      } else if (result.error) {
        toast.error(result.error);
      }
    } finally {
      setCreatingShared(false);
    }
  }

  async function handleSendShared() {
    if (selected.size === 0) return toast.error("Select at least one student.");
    setSending(true);
    try {
      const result = await sendUploadLinks(assignmentId, Array.from(selected), "shared");
      reportResult(result);
      refreshLinks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send links.");
    } finally {
      setSending(false);
    }
  }

  function reportResult(result: { ok: boolean; error?: string; sent: number; skipped: { name: string; reason: string }[] }) {
    if (!result.ok) {
      toast.error(result.error || "Failed to send links.");
      return;
    }
    if (result.sent > 0) toast.success(`Sent ${result.sent} upload link${result.sent === 1 ? "" : "s"}.`);
    if (result.skipped.length > 0) {
      toast.warning(`Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`);
    }
  }

  function copySharedUrl() {
    if (!sharedUrl) return;
    navigator.clipboard.writeText(sharedUrl);
    toast.success("Link copied.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Link2 className="mr-2 h-4 w-4" />
        Send upload link
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send upload link</DialogTitle>
          <DialogDescription>
            Let students submit media for this assignment without signing in. Links expire in 14 days.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="per-student">
          <TabsList>
            <TabsTrigger value="per-student">Per student</TabsTrigger>
            <TabsTrigger value="shared">Shared link</TabsTrigger>
            <TabsTrigger value="active">Active links{activeCount > 0 ? ` (${activeCount})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="per-student" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each selected student gets their own link, emailed to the address on file.
            </p>
            <StudentPicker students={students} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
            <div className="flex justify-end">
              <Button onClick={handleSendPerStudent} disabled={sending || !students}>
                {sending ? "Sending…" : `Send to ${selected.size} selected`}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="shared" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              One link for the whole assignment — whoever opens it picks their own name from the roster. Anyone
              with the link can see the class roster and upload as any student on it, so only share it with the
              class itself.
            </p>

            {!sharedUrl ? (
              <Button variant="outline" onClick={handleCreateShared} disabled={creatingShared}>
                {creatingShared ? "Creating…" : "Create shared link"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs">
                  {sharedUrl}
                </code>
                <Button variant="outline" size="icon" onClick={copySharedUrl}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground leading-relaxed pt-1">
              Or email it directly to selected students:
            </p>
            <StudentPicker students={students} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
            <div className="flex justify-end">
              <Button onClick={handleSendShared} disabled={sending || !students}>
                {sending ? "Sending…" : `Send to ${selected.size} selected`}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="active" className="space-y-3 pt-3">
            <ActiveLinksList links={links} onRevoke={handleRevoke} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ActiveLinksList({ links, onRevoke }: { links: UploadLinkRow[] | null; onRevoke: (id: number) => void }) {
  if (!links) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (links.length === 0) return <p className="text-sm text-muted-foreground">No links issued yet.</p>;

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
      {links.map((link) => {
        const inactive = !!link.revokedAt || link.expired;
        return (
          <div key={link.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0">
            <span className="flex-1">
              <span className={inactive ? "text-muted-foreground line-through" : ""}>
                {link.studentName ?? "Shared (whole assignment)"}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {link.revokedAt ? "revoked" : link.expired ? "expired" : `expires ${new Date(link.expiresAt.replace(" ", "T") + "Z").toLocaleDateString()}`}
              </span>
            </span>
            {!inactive && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onRevoke(link.id)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StudentPicker({
  students,
  selected,
  onToggle,
  onToggleAll,
}: {
  students: Student[] | null;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  if (!students) return <p className="text-sm text-muted-foreground">Loading roster…</p>;
  if (students.length === 0) return <p className="text-sm text-muted-foreground">No students enrolled.</p>;

  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
      <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        <input type="checkbox" checked={selected.size === students.length} onChange={onToggleAll} />
        Select all
      </label>
      {students.map((s) => (
        <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary/50">
          <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)} />
          <span className="flex-1">{s.sortName}</span>
          {!s.email && <span className="text-xs text-destructive">no email</span>}
        </label>
      ))}
    </div>
  );
}
