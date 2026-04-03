"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLsBridge } from "@/hooks/use-ls-bridge";
import { toast } from "sonner";
import { RefreshCw, WifiOff, Link2, Link2Off } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function LsSyncRosterButton({ courseId }: { courseId: number }) {
  const router = useRouter();
  const { status, busy, lsState, syncRoster } = useLsBridge();
  const [linkedCourseId, setLinkedCourseId] = useState<string | null | undefined>(undefined);

  // Load the stored LS course link
  useEffect(() => {
    fetch(`/api/ls-bridge/course-link?courseId=${courseId}`)
      .then((r) => r.json())
      .then((d) => setLinkedCourseId(d.lmsCourseId ?? null))
      .catch(() => setLinkedCourseId(null));
  }, [courseId]);

  const unavailable = status === "unavailable";
  const noTab = status === "no-ls-tab";
  // Warn if a link exists and the open LS tab is for a different course
  const mismatch =
    linkedCourseId && lsState?.courseID && linkedCourseId !== lsState.courseID;
  const disabled = unavailable || noTab || busy || status === "checking";

  async function handleSync() {
    const result = await syncRoster(courseId);
    if (!result) return;

    const { imported, updated } = result as { imported: number; updated: number };
    toast.success(
      imported || updated
        ? `Roster synced — ${imported} added, ${updated} updated`
        : "Roster already up to date"
    );
    // Refresh linked course ID in case it was just auto-set
    setLinkedCourseId(lsState?.courseID ?? null);
    router.refresh();
  }

  async function handleUnlink() {
    await fetch(`/api/ls-bridge/course-link?courseId=${courseId}`, { method: "DELETE" });
    setLinkedCourseId(null);
    toast.success("LS course link cleared — next sync will re-link automatically");
  }

  let tooltipMsg: string | undefined;
  if (unavailable) tooltipMsg = "Install the LS Bridge extension to sync directly from Learning Suite";
  else if (noTab) tooltipMsg = "Open Learning Suite in this browser, then try again";
  else if (mismatch)
    tooltipMsg = `Linked to LS course "${linkedCourseId}" but "${lsState!.courseID}" is open. Switch LS tabs or click to unlink.`;

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
        {linked ? `Sync (${linkedCourseId})` : "Sync from LS"}
      </Button>
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

  if (!tooltipMsg) return <TooltipProvider>{btn}</TooltipProvider>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>
          {btn}
        </TooltipTrigger>
        <TooltipContent>{tooltipMsg}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
