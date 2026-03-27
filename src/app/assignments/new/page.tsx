"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCourses } from "@/actions/courses";
import { getRubrics } from "@/actions/rubrics";
import { createAssignment } from "@/actions/assignments";
import { toast } from "sonner";

type Course = { id: number; name: string; code: string; semester: string };
type Rubric = { id: number; name: string };

export default function NewAssignmentPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
      <NewAssignmentForm />
    </Suspense>
  );
}

function NewAssignmentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCourseId = searchParams.get("courseId");

  const [courses, setCourses] = useState<Course[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [saving, setSaving] = useState(false);

  // Form state
  const [courseId, setCourseId] = useState(preselectedCourseId ?? "");
  const [rubricId, setRubricId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pointsPossible, setPointsPossible] = useState("100");
  const [submissionType, setSubmissionType] = useState<"image" | "video" | "any">("any");
  const [lmsAssignmentId, setLmsAssignmentId] = useState("");

  useEffect(() => {
    getCourses().then(setCourses);
    getRubrics().then(setRubrics);
  }, []);

  // Auto-set points from rubric
  useEffect(() => {
    if (!rubricId || rubricId === "none") return;
    // Points possible stays manual — rubric provides per-criterion breakdown
  }, [rubricId]);

  async function handleCreate() {
    if (!courseId || !name || !pointsPossible) {
      toast.error("Please fill in Course, Name, and Points Possible");
      return;
    }
    setSaving(true);
    try {
      const assignment = await createAssignment({
        courseId: Number(courseId),
        rubricId: rubricId && rubricId !== "none" ? Number(rubricId) : null,
        name,
        description: description || undefined,
        dueDate: dueDate || undefined,
        pointsPossible: Number(pointsPossible),
        submissionType,
        lmsAssignmentId: lmsAssignmentId || undefined,
      });
      toast.success("Assignment created");
      router.push(`/assignments/${assignment.id}`);
    } catch (err) {
      toast.error(`Failed to create: ${err instanceof Error ? err.message : "Unknown error"}`);
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <Header
        title="New Assignment"
        description="Set up a grading assignment and link it to a rubric"
        actions={
          <LinkButton href="/assignments" variant="outline">
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
            <div className="space-y-2">
              <Label htmlFor="course">Course *</Label>
              <Select value={courseId || null} onValueChange={(v) => setCourseId(v ?? "")}>
                <SelectTrigger id="course">
                  <SelectValue placeholder="Select a course…" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code} — {c.name} ({c.semester})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Assignment Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Project 1 — Material Studies"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the assignment…"
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
              <Select value={rubricId || null} onValueChange={(v) => setRubricId(v ?? "")}>
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
                A rubric lets you grade per-criterion.{" "}
                <a href="/rubrics/new" target="_blank" className="underline">
                  Create a new rubric
                </a>
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
              <Select value={submissionType} onValueChange={(v) => setSubmissionType((v ?? "any") as "image" | "video" | "any")}>
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

        {/* LMS Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning Suite Integration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lmsId">LMS Assignment ID (optional)</Label>
              <Input
                id="lmsId"
                value={lmsAssignmentId}
                onChange={(e) => setLmsAssignmentId(e.target.value)}
                placeholder="Paste the Learning Suite assignment ID if known"
              />
              <p className="text-xs text-muted-foreground">
                Used to match grades when importing/exporting to Learning Suite.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <LinkButton href="/assignments" variant="outline">
            Cancel
          </LinkButton>
          <Button onClick={handleCreate} disabled={saving || !courseId || !name}>
            {saving ? "Creating…" : "Create Assignment"}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
