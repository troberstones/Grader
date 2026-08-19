"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copyCourse } from "@/actions/courses";
import { TERMS, TERM_LABELS, isTerm, type Term } from "@/lib/terms";

const currentYear = new Date().getFullYear();

/**
 * The "fill in the new course's details" step of copying a course — shared
 * by CopyCourseDialog (source fixed to whatever course page you're on) and
 * CopyCoursePicker (source chosen from a year/term picker) so there's one
 * implementation of this form, not two.
 */
export function CopyCourseForm({
  sourceId,
  sourceName,
  sourceHasStartDate,
  onCancel,
  onSuccess,
}: {
  sourceId: number;
  sourceName: string;
  sourceHasStartDate: boolean;
  onCancel: () => void;
  onSuccess: (course: { id: number; name: string }) => void;
}) {
  const [pending, setPending] = useState(false);
  const [term, setTerm] = useState<Term>("fall");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    setPending(true);
    try {
      const newCourse = await copyCourse(sourceId, {
        name: formData.get("name") as string,
        code: formData.get("code") as string,
        section: (formData.get("section") as string) || undefined,
        year: Number(formData.get("year")),
        term,
        startDate: (formData.get("startDate") as string) || undefined,
        sourceStartDate: sourceHasStartDate ? undefined : (formData.get("sourceStartDate") as string) || undefined,
      });
      toast.success(`Copied to ${newCourse.name}`);
      onSuccess(newCourse);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy this course.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Copy {sourceName}</DialogTitle>
        <DialogDescription>
          Copies assignments and their rubrics into a new, independent course — editing the copy never touches the
          original. Roster, submissions, and grades are not copied.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Course Name</Label>
          <Input id="name" name="name" defaultValue={sourceName} required disabled={pending} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="code">Course Code</Label>
            <Input id="code" name="code" placeholder="ART 325" required disabled={pending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="section">Section</Label>
            <Input id="section" name="section" placeholder="001" disabled={pending} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="term">Term</Label>
            <Select value={term} onValueChange={(v) => setTerm(isTerm(v) ? v : "fall")}>
              <SelectTrigger id="term">
                <SelectValue>{(v: Term) => TERM_LABELS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TERMS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TERM_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input id="year" name="year" type="number" defaultValue={currentYear} required disabled={pending} />
          </div>
        </div>
        {!sourceHasStartDate && (
          <div className="space-y-2">
            <Label htmlFor="sourceStartDate">{sourceName}&apos;s start date</Label>
            <Input id="sourceStartDate" name="sourceStartDate" type="date" disabled={pending} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Not on record yet. Enter it so due dates can shift correctly — it&apos;ll be saved on the original
              course too, not just this copy.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="startDate">New course&apos;s start date</Label>
          <Input id="startDate" name="startDate" type="date" disabled={pending} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Shifts assignment due dates onto the new term. Leave blank to copy them unchanged.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Copying…" : "Copy"}
          </Button>
        </div>
      </form>
    </>
  );
}
