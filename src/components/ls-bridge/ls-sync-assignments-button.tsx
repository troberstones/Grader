"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLsBridge } from "@/hooks/use-ls-bridge";
import { toast } from "sonner";
import { RefreshCw, WifiOff, Link2, Link2Off } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function LsSyncAssignmentsButton({ courseId }: { courseId: number }) {
  const router = useRouter();
  const { status, busy, lsState, syncAssignments } = useLsBridge();
  const [linkedCourseId, setLinkedCourseId] = useState<string | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [manualGradebookId, setManualGradebookId] = useState("");

  useEffect(() => {
    fetch(`/api/ls-bridge/course-link?courseId=${courseId}`)
      .then((r) => r.json())
      .then((d) => setLinkedCourseId(d.lmsCourseId ?? null))
      .catch(() => setLinkedCourseId(null));
  }, [courseId]);

  const unavailable = status === "unavailable";
  const noTab = status === "no-ls-tab";
  const mismatch =
    linkedCourseId && lsState?.courseID && linkedCourseId !== lsState.courseID;
  const disabled = unavailable || noTab || busy || status === "checking";

  async function runSync(gradebookID?: string) {
    setDialogOpen(false);
    const result = await syncAssignments(courseId, gradebookID || undefined);
    if (!result) return;

    const { added, updated } = result as { added: number; updated: number };
    toast.success(
      added || updated
        ? `Assignments synced — ${added} added, ${updated} updated`
        : "Assignments already up to date",
      {
        description:
          added > 0
            ? "Only assignments with online submissions were imported."
            : undefined,
      }
    );
    setLinkedCourseId(lsState?.courseID ?? null);
    router.refresh();
  }

  async function handleSync() {
    // Try auto-detection first. If it fails, the error toast will show.
    // The dialog gives an escape hatch to enter the ID manually.
    await runSync();
  }

  async function handleUnlink() {
    await fetch(`/api/ls-bridge/course-link?courseId=${courseId}`, { method: "DELETE" });
    setLinkedCourseId(null);
    toast.success("LS course link cleared");
  }

  let tooltipMsg: string | undefined;
  if (unavailable) tooltipMsg = "Install the LS Bridge extension to sync directly from Learning Suite";
  else if (noTab) tooltipMsg = "Open the Learning Suite gradebook (Grades > Scores) in this browser, then try again";
  else if (mismatch)
    tooltipMsg = `Linked to LS course "${linkedCourseId}" but "${lsState!.courseID}" is open. Switch LS tabs or unlink first.`;

  const linked = linkedCourseId != null;
  const icon = unavailable || noTab
    ? <WifiOff className="mr-2 h-4 w-4" />
    : busy
    ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
    : linked
    ? <Link2 className="mr-2 h-4 w-4" />
    : <RefreshCw className="mr-2 h-4 w-4" />;

  const btn = (
    <div className="flex items-center gap-1">
      <Button
        variant={mismatch ? "destructive" : "outline"}
        onClick={handleSync}
        disabled={disabled}
      >
        {icon}
        {linked ? `Sync Assignments (${linkedCourseId})` : "Sync Assignments"}
      </Button>
      {!disabled && (
        <Tooltip>
          <TooltipTrigger render={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setManualGradebookId(""); setDialogOpen(true); }}
              disabled={disabled}
              title="Enter Gradebook ID manually"
            />
          }>
            <span className="text-xs font-mono font-bold">ID</span>
          </TooltipTrigger>
          <TooltipContent>Enter Gradebook ID manually</TooltipContent>
        </Tooltip>
      )}
      {linked && !unavailable && !noTab && (
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={handleUnlink} />}>
            <Link2Off className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Unlink from LS course "{linkedCourseId}"</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      {tooltipMsg ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>
            {btn}
          </TooltipTrigger>
          <TooltipContent>{tooltipMsg}</TooltipContent>
        </Tooltip>
      ) : btn}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Gradebook ID</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Auto-detection sometimes fails. You can find the Gradebook ID in Chrome DevTools
              on the Learning Suite tab: <strong>Network</strong> tab → filter by{" "}
              <code className="text-xs bg-muted px-1 rounded">ajax.php</code> → click any
              gradebook request → look at the <strong>Request URL</strong> or the response JSON
              for a field named <code className="text-xs bg-muted px-1 rounded">gradebookID</code>.
            </p>
            <Input
              placeholder="e.g. abc123"
              value={manualGradebookId}
              onChange={(e) => setManualGradebookId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && manualGradebookId.trim() && runSync(manualGradebookId.trim())}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!manualGradebookId.trim() || busy}
              onClick={() => runSync(manualGradebookId.trim())}
            >
              Sync with this ID
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
