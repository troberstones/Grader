"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateAssignment } from "@/actions/assignments";
import { toast } from "sonner";
import type { getAssignment, getAllAssignments } from "@/actions/assignments";
import type { getCourses } from "@/actions/courses";
import type { getRubrics } from "@/actions/rubrics";

type Assignment = NonNullable<Awaited<ReturnType<typeof getAssignment>>>;
type Course = Awaited<ReturnType<typeof getCourses>>[number];
type Rubric = Awaited<ReturnType<typeof getRubrics>>[number];

interface EditAssignmentClientProps {
  assignment: Assignment;
  courses: Course[];
  rubrics: Rubric[];
}

export function EditAssignmentClient({ assignment, courses, rubrics }: EditAssignmentClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(assignment.name);
  const [description, setDescription] = useState(assignment.description ?? "");
  const [rubricId, setRubricId] = useState(assignment.rubricId ? String(assignment.rubricId) : "none");
  const [pointsPossible, setPointsPossible] = useState(String(assignment.pointsPossible));
  const [dueDate, setDueDate] = useState(assignment.dueDate ?? "");
  const [submissionType, setSubmissionType] = useState<"image" | "video" | "any">(
    (assignment.submissionType as "image" | "video" | "any") ?? "any"
  );
  const [lmsAssignmentId, setLmsAssignmentId] = useState(assignment.lmsAssignmentId ?? "");

  async function handleSave() {
    if (!name || !pointsPossible) {
      toast.error("Name and Points Possible are required");
      return;
    }
    setSaving(true);
    try {
      await updateAssignment(assignment.id, {
        name,
        description: description || null,
        rubricId: rubricId && rubricId !== "none" ? Number(rubricId) : null,
        pointsPossible: Number(pointsPossible),
        dueDate: dueDate || null,
        submissionType,
        lmsAssignmentId: lmsAssignmentId || null,
      });
      toast.success("Assignment updated");
      router.push(`/assignments/${assignment.id}`);
    } catch (err) {
      toast.error(`Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <Header
        title="Edit Assignment"
        description={`${assignment.course.code} — ${assignment.course.name}`}
        actions={
          <LinkButton href={`/assignments/${assignment.id}`} variant="outline">
            Cancel
          </LinkButton>
        }
      />

      <div className="max-w-2xl space-y-6">
        {/* Core fields */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Course is read-only on edit */}
            <div className="space-y-2">
              <Label>Course</Label>
              <div className="flex h-9 items-center rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {assignment.course.code} — {assignment.course.name} ({assignment.course.semester})
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Assignment Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Grading setup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grading Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rubric">Rubric (optional)</Label>
              <Select
                value={rubricId || null}
                onValueChange={(v) => setRubricId(v ?? "none")}
              >
                <SelectTrigger id="rubric">
                  <SelectValue placeholder="Select a rubric…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No rubric</SelectItem>
                  {rubrics.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Changing the rubric will not delete existing grade entries.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="points">Points Possible *</Label>
                <Input
                  id="points"
                  type="number"
                  min="0"
                  step="0.5"
                  value={pointsPossible}
                  onChange={(e) => setPointsPossible(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="due">Due Date (optional)</Label>
                <Input
                  id="due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Submission Type</Label>
              <Select
                value={submissionType}
                onValueChange={(v) => setSubmissionType((v ?? "any") as "image" | "video" | "any")}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Image or Video</SelectItem>
                  <SelectItem value="image">Image only</SelectItem>
                  <SelectItem value="video">Video only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* LMS */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning Suite Integration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="lmsId">LMS Assignment ID (optional)</Label>
              <Input
                id="lmsId"
                value={lmsAssignmentId}
                onChange={(e) => setLmsAssignmentId(e.target.value)}
                placeholder="Learning Suite assignment ID"
              />
              <p className="text-xs text-muted-foreground">
                Used to match grades when importing/exporting to Learning Suite.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between gap-3">
          <LinkButton href={`/assignments/${assignment.id}`} variant="outline">
            Cancel
          </LinkButton>
          <Button onClick={handleSave} disabled={saving || !name}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
