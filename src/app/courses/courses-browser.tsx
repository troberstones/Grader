"use client";

import { useState, useTransition } from "react";
import { CourseList } from "./course-list";
import { setMyTermPreference } from "@/actions/courses";
import { formatTerm, type Term } from "@/lib/terms";
import { cn } from "@/lib/utils";

interface Course {
  id: number;
  name: string;
  code: string;
  section: string | null;
  year: number;
  term: Term;
}

interface TermOption {
  year: number;
  term: Term;
}

function termKey(t: { year: number; term: Term }): string {
  return `${t.year}-${t.term}`;
}

export function CoursesBrowser({
  courses,
  terms,
  initialSelection,
}: {
  courses: Course[];
  terms: TermOption[];
  initialSelection: TermOption | null;
}) {
  // A saved preference might no longer have any courses (archived, or none
  // were ever created for it) — fall back to the newest real term instead of
  // silently showing an empty list for a term the rail doesn't even list.
  const savedIsLive = initialSelection && terms.some((t) => termKey(t) === termKey(initialSelection));
  const [selected, setSelected] = useState<TermOption | null>(
    (savedIsLive ? initialSelection : null) ?? terms[0] ?? null
  );
  const [, startTransition] = useTransition();

  function select(option: TermOption) {
    setSelected(option);
    startTransition(() => {
      setMyTermPreference(option.year, option.term);
    });
  }

  if (terms.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No courses yet. Create your first course to get started.</p>
      </div>
    );
  }

  const visible = selected
    ? courses.filter((c) => c.year === selected.year && c.term === selected.term)
    : [];

  return (
    <div className="flex gap-8">
      <nav className="w-44 shrink-0 space-y-1">
        {terms.map((t) => {
          const count = courses.filter((c) => c.year === t.year && c.term === t.term).length;
          const isSelected = selected ? termKey(selected) === termKey(t) : false;
          return (
            <button
              key={termKey(t)}
              type="button"
              onClick={() => select(t)}
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
      <div className="flex-1 min-w-0">
        <CourseList
          courses={visible}
          emptyMessage={selected ? `No courses in ${formatTerm(selected.year, selected.term)}.` : "Select a term."}
        />
      </div>
    </div>
  );
}
