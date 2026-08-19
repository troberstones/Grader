"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Copy } from "lucide-react";
import { CopyCourseForm } from "./copy-course-form";
import { formatTerm, type Term } from "@/lib/terms";
import { cn } from "@/lib/utils";

interface Course {
  id: number;
  name: string;
  code: string;
  section: string | null;
  year: number;
  term: Term;
  startDate: string | null;
}

interface TermOption {
  year: number;
  term: Term;
}

function termKey(t: TermOption): string {
  return `${t.year}-${t.term}`;
}

/**
 * The explicit, scoped entry point for copying a course you don't already
 * have open — a year/term picker (same rail pattern as CoursesBrowser),
 * scoped to name/code/term only, never roster or grades. Once a source is
 * picked, step 2 is the same CopyCourseForm the per-course-page
 * CopyCourseDialog uses.
 */
export function CopyCoursePicker({ courses, terms }: { courses: Course[]; terms: TermOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState<TermOption | null>(terms[0] ?? null);
  const [source, setSource] = useState<Course | null>(null);

  function reset() {
    setSource(null);
    setSelectedTerm(terms[0] ?? null);
  }

  const visible = selectedTerm
    ? courses.filter((c) => c.year === selectedTerm.year && c.term === selectedTerm.term)
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Copy className="mr-2 h-4 w-4" />
        Copy Existing Course
      </DialogTrigger>
      <DialogContent className={source ? undefined : "sm:max-w-2xl"}>
        {source ? (
          <CopyCourseForm
            sourceId={source.id}
            sourceName={source.name}
            sourceHasStartDate={!!source.startDate}
            onCancel={() => setSource(null)}
            onSuccess={(newCourse) => {
              setOpen(false);
              reset();
              router.push(`/courses/${newCourse.id}`);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy an Existing Course</DialogTitle>
              <DialogDescription>
                Pick a course to use as a template — any department-visible course, not just your own. Only the
                assignments and rubrics come across; roster, submissions, and grades never do.
              </DialogDescription>
            </DialogHeader>
            {terms.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No courses to copy from yet.</p>
            ) : (
              <div className="flex gap-6">
                <nav className="w-36 shrink-0 space-y-1">
                  {terms.map((t) => {
                    const count = courses.filter((c) => c.year === t.year && c.term === t.term).length;
                    const isSelected = selectedTerm ? termKey(selectedTerm) === termKey(t) : false;
                    return (
                      <button
                        key={termKey(t)}
                        type="button"
                        onClick={() => setSelectedTerm(t)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors",
                          isSelected
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <span>{formatTerm(t.year, t.term)}</span>
                        <span className="text-xs tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                </nav>
                <div className="flex-1 min-w-0 max-h-80 overflow-y-auto">
                  {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No courses in {selectedTerm ? formatTerm(selectedTerm.year, selectedTerm.term) : "this term"}.
                    </p>
                  ) : (
                    <div className="rounded-xl border divide-y divide-border overflow-hidden">
                      {visible.map((course) => (
                        <button
                          key={course.id}
                          type="button"
                          onClick={() => setSource(course)}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                        >
                          <span className="font-medium truncate">{course.name}</span>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {course.code}
                          </Badge>
                          {course.section && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              Sec {course.section}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
