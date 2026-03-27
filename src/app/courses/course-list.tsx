"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, ClipboardList, Trash2 } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { deleteCourse } from "@/actions/courses";
import Link from "next/link";

interface Course {
  id: number;
  name: string;
  code: string;
  section: string | null;
  semester: string;
}

export function CourseList({ courses }: { courses: Course[] }) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No courses yet. Create your first course to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <Card key={course.id} className="group">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <Link href={`/courses/${course.id}`} className="flex-1">
                <CardTitle className="text-base hover:underline">
                  {course.name}
                </CardTitle>
              </Link>
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
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="secondary">{course.code}</Badge>
              {course.section && (
                <Badge variant="outline">Section {course.section}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-3">{course.semester}</p>
            <div className="flex gap-2">
              <LinkButton href={`/courses/${course.id}/roster`} variant="outline" size="sm">
                <Users className="mr-1 h-3 w-3" />
                Roster
              </LinkButton>
              <LinkButton href={`/courses/${course.id}`} variant="outline" size="sm">
                <ClipboardList className="mr-1 h-3 w-3" />
                Assignments
              </LinkButton>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
