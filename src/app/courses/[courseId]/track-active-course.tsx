"use client";

import { useEffect } from "react";
import { setActiveCourse } from "@/actions/courses";

/** Renders nothing — just marks this course as the active one on mount. */
export function TrackActiveCourse({ courseId }: { courseId: number }) {
  useEffect(() => {
    setActiveCourse(courseId);
  }, [courseId]);

  return null;
}
