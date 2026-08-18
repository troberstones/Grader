"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StudentNavBar } from "@/components/shared/student-nav-bar";
import { useGrading } from "@/components/shared/grading-context";
import { useRubricGrading } from "@/hooks/use-rubric-grading";
import { RubricGradingPanel } from "@/components/rubric/rubric-grading-panel";
import { toast } from "sonner";
import {
  Download,
  RotateCcw,
  CloudDownload,
  Upload,
  Link,
  UserX,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { getAssignment } from "@/actions/assignments";
import { useLsBridge } from "@/hooks/use-ls-bridge";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;

interface GradeSheetClientProps {
  assignment: Assignment;
}

export function GradeSheetClient({ assignment }: GradeSheetClientProps) {
  const router = useRouter();
  const { students } = useGrading();
  const { status: lsStatus, busy: lsBusy, syncSubmissions, pushGrades } = useLsBridge();
  const lsReady = lsStatus === "ready";
  const [discussionDialogOpen, setDiscussionDialogOpen] = useState(false);
  const [discussionUrlInput, setDiscussionUrlInput] = useState(assignment.lmsDiscussionUrl ?? "");
  const [savingDiscussionUrl, setSavingDiscussionUrl] = useState(false);

  async function handleSaveDiscussionUrl() {
    const raw = discussionUrlInput.trim();
    // Accept full URL or just the short ID (e.g. "5LB6")
    const shortUrl = raw.match(/\/id-([\w-]+)/)?.[1] ?? raw;
    if (!shortUrl) return;
    setSavingDiscussionUrl(true);
    await fetch(`/api/assignments/${assignment.id}/discussion-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lmsDiscussionUrl: shortUrl }),
    });
    setSavingDiscussionUrl(false);
    setDiscussionDialogOpen(false);
    toast.success("Discussion URL saved");
    router.refresh();
  }

  async function handleFetchSubmissions() {
    if (!assignment.lmsDiscussionUrl) {
      setDiscussionDialogOpen(true);
      return;
    }
    const result = await syncSubmissions(assignment.id);
    if (!result) return;
    const { synced, errors } = result;
    if (synced > 0) {
      toast.success(`${synced} submission${synced !== 1 ? "s" : ""} downloaded from LS`);
      router.refresh();
    } else {
      toast.info("No new submissions found in Learning Suite");
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} failed — check console for details`);
      console.error("[LS Bridge] submission errors:", errors);
    }
  }

  async function handlePushGrades() {
    const result = await pushGrades(assignment.id);
    if (!result) return;
    const { pushed, errors } = result;
    if (pushed > 0) {
      toast.success(`${pushed} grade${pushed !== 1 ? "s" : ""} pushed to Learning Suite`);
    } else {
      toast.info("No graded submissions to push");
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} failed — check console for details`);
      console.error("[LS Bridge] push errors:", errors);
    }
  }

  const grading = useRubricGrading(assignment);
  const { selectedStudent, saving, exporting, handleClear, handleMarkMissing, exportCsv } = grading;

  async function handleExport() {
    await exportCsv(assignment.name);
  }

  const gradedCount = students.filter((s) => s.grade?.status === "graded").length;


  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {selectedStudent ? (
          <>
            {/* Student nav bar */}
            <StudentNavBar
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClear}
                    disabled={saving || !selectedStudent.grade}
                    title="Clear grade"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleMarkMissing}
                    disabled={saving}
                    title="Mark as not submitted — distinct from a grade of zero"
                  >
                    <UserX className="h-3.5 w-3.5" />
                  </Button>
                  {lsReady && (
                    <>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => { setDiscussionUrlInput(assignment.lmsDiscussionUrl ?? ""); setDiscussionDialogOpen(true); }}
                              title="Set LS discussion URL"
                            >
                              <Link className={`h-3.5 w-3.5 ${assignment.lmsDiscussionUrl ? "text-primary" : "text-muted-foreground"}`} />
                            </Button>
                          }
                        />
                        <TooltipContent>{assignment.lmsDiscussionUrl ? `Discussion: ${assignment.lmsDiscussionUrl}` : "Link LS discussion URL"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handleFetchSubmissions}
                              disabled={lsBusy || saving}
                              title="Fetch submissions from LS"
                            >
                              {lsBusy ? (
                                <CloudDownload className="h-3.5 w-3.5 animate-pulse" />
                              ) : (
                                <CloudDownload className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          }
                        />
                        <TooltipContent>Fetch submissions from Learning Suite</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handlePushGrades}
                              disabled={lsBusy || saving || gradedCount === 0}
                              title="Push grades to LS"
                            >
                              <Upload className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <TooltipContent>Push grades to Learning Suite</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={handleExport}
                    disabled={exporting || gradedCount === 0}
                  >
                    <Download className="h-3 w-3 mr-1.5" />
                    {exporting ? "Exporting…" : "Export"}
                  </Button>
                </div>
              }
            />

            {/* Rubric grading area — same panel the review-route dock renders. */}
            <RubricGradingPanel grading={grading} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a student from the list to begin grading.</p>
          </div>
        )}
      </div>

      <Dialog open={discussionDialogOpen} onOpenChange={setDiscussionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link LS Discussion</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              In Learning Suite, open the discussion for this assignment and copy the page URL.
              Paste it below — or just the short ID at the end (e.g.{" "}
              <code className="text-xs bg-muted px-1 rounded">5LB6</code>).
            </p>
            <Input
              placeholder="https://learningsuite.byu.edu/.../discuss/discussion/id-5LB6"
              value={discussionUrlInput}
              onChange={(e) => setDiscussionUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && discussionUrlInput.trim() && handleSaveDiscussionUrl()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscussionDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!discussionUrlInput.trim() || savingDiscussionUrl}
              onClick={handleSaveDiscussionUrl}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
