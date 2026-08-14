"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, ClipboardList, Trash2 } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { deleteCourse } from "@/actions/courses";

interface Course {
  id: number;
  name: string;
  code: string;
  section: string | null;
}

export function CourseList({
  courses,
  emptyMessage,
  activeCourseId,
  onSelect,
  onOpenAssignments,
}: {
  courses: Course[];
  emptyMessage: string;
  activeCourseId: number | null;
  onSelect: (courseId: number) => void;
  onOpenAssignments: (courseId: number) => void;
}) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border divide-y divide-border overflow-hidden">
      {courses.map((course) => {
        const isActive = course.id === activeCourseId;
        return (
          <div key={course.id} className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/40 transition-colors group">
            <button
              type="button"
              onClick={() => onSelect(course.id)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
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
              {isActive && (
                <Badge variant="default" className="text-xs shrink-0">
                  Active
                </Badge>
              )}
            </button>
            <div className="flex items-center gap-1 shrink-0">
              <LinkButton href={`/courses/${course.id}/roster`} variant="ghost" size="sm">
                <Users className="mr-1 h-3.5 w-3.5" />
                Roster
              </LinkButton>
              <Button variant="ghost" size="sm" onClick={() => onOpenAssignments(course.id)}>
                <ClipboardList className="mr-1 h-3.5 w-3.5" />
                Assignments
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                onClick={async () => {
                  if (confirm("Delete this course? This cannot be undone.")) {
                    await deleteCourse(course.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
