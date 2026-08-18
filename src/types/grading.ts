export type GradeStatus = "ungraded" | "in_progress" | "graded" | "missing";
export type MediaType = "image" | "video";
export type SubmissionType = "image" | "video" | "any";

/**
 * Minimal student shape required by shared display components
 * (StudentSidebar, StudentNavBar). Narrower than StudentWithGrade so those
 * components are insulated from grade-detail changes (entries, feedback, etc.).
 */
export interface GradingStudent {
  id: number;
  name: string;
  sortName: string;
  netId?: string | null;
  grade?: {
    status: GradeStatus;
    totalScore: number | null;
  } | null;
}
