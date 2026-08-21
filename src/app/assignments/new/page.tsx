"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { LinkButton } from "@/components/ui/link-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCourse } from "@/actions/courses";
import { getRubrics } from "@/actions/rubrics";
import { createAssignment } from "@/actions/assignments";
import { toast } from "sonner";
import { formatTerm, type Term } from "@/lib/terms";

type Course = { id: number; name: string; code: string; section: string | null; year: number; term: Term };
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
  const courseIdParam = searchParams.get("courseId");
  const courseId = courseIdParam ? Number(courseIdParam) : null;

  const [course, setCourse] = useState<Course | null>(null);
  const [courseLoaded, setCourseLoaded] = useState(false);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [saving, setSaving] = useState(false);

  // Form state
  const [rubricId, setRubricId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pointsPossible, setPointsPossible] = useState("100");
  const [submissionType, setSubmissionType] = useState<"image" | "video" | "any">("any");
  const [lmsAssignmentId, setLmsAssignmentId] = useState("");

  useEffect(() => {
    getRubrics().then(setRubrics);
  }, []);

  useEffect(() => {
    if (!courseId) {
      setCourseLoaded(true);
      return;
    }
    getCourse(courseId).then((c) => {
      setCourse(c);
      setCourseLoaded(true);
    });
  }, [courseId]);

  // Coming back from "Create a new rubric" (see the Rubric field below): it
  // now exists but wasn't in the `rubrics` fetched above, so re-fetch and
  // select it.
  useEffect(() => {
    const newRubricId = searchParams.get("newRubricId");
    if (!newRubricId) return;
    getRubrics().then(setRubrics);
    setRubricId(newRubricId);
    toast.success("Rubric created and selected");
    router.replace(courseIdParam ? `/assignments/new?courseId=${courseIdParam}` : "/assignments/new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Auto-set points from rubric
  useEffect(() => {
    if (!rubricId || rubricId === "none") return;
    // Points possible stays manual — rubric provides per-criterion breakdown
  }, [rubricId]);

  async function handleCreate() {
    if (!course || !name || !pointsPossible) {
      toast.error("Please fill in Name and Points Possible");
      return;
    }
    setSaving(true);
    try {
      const assignment = await createAssignment({
        courseId: course.id,
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

  if (courseLoaded && !course) {
    return (
      <PageContainer>
        <Header title="New Assignment" />
        <div className="max-w-2xl">
          <p className="text-muted-foreground mb-4">
            An assignment always belongs to a specific course. Open the course you want to add
            this assignment to, then use its &quot;New Assignment&quot; button.
          </p>
          <LinkButton href="/courses">Go to Courses</LinkButton>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Header
        breadcrumb={
          course && (
            <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
              <Link href="/courses" className="hover:text-foreground transition-colors">
                Courses
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <Link href={`/courses/${course.id}`} className="hover:text-foreground transition-colors">
                {course.code}
              </Link>
            </nav>
          )
        }
        title="New Assignment"
        description={
          course
            ? `${course.name}${course.section ? ` · Section ${course.section}` : ""} · ${formatTerm(course.year, course.term)}`
            : "Loading course…"
        }
        actions={
          <LinkButton href={course ? `/courses/${course.id}` : "/assignments"} variant="outline">
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
                  <SelectValue placeholder="Select a rubric…">
                    {(v: string | null) => {
                      if (!v) return "Select a rubric…";
                      if (v === "none") return "No rubric";
                      return rubrics.find((r) => String(r.id) === v)?.name ?? v;
                    }}
                  </SelectValue>
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
                <a
                  href={`/rubrics/new?returnTo=${encodeURIComponent(courseIdParam ? `/assignments/new?courseId=${courseIdParam}` : "/assignments/new")}`}
                  className="underline"
                >
                  Create a new rubric
                </a>{" "}
                — saving it brings you back here with it selected.
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
          <LinkButton href={course ? `/courses/${course.id}` : "/assignments"} variant="outline">
            Cancel
          </LinkButton>
          <Button onClick={handleCreate} disabled={saving || !course || !name}>
            {saving ? "Creating…" : "Create Assignment"}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
