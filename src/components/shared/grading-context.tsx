"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type { StudentWithGrade, StudentGrade } from "@/actions/grades";
import type { GradingStudent } from "@/types/grading";

interface GradingContextValue {
  /**
   * The student list typed as the minimal GradingStudent interface.
   * Sidebar and nav components only depend on this shape, so they are
   * insulated from changes to the fuller StudentWithGrade type.
   *
   * The internal React state is StudentWithGrade[] — this is just a
   * TypeScript narrowing at the public API boundary (no runtime cost).
   */
  students: GradingStudent[];

  /**
   * Update the grade record for one student. Used by GradeSheetClient
   * after a save/clear so the sidebar reflects the new status and score
   * without exposing the raw setState to all consumers.
   */
  updateStudentGrade: (studentId: number, grade: StudentGrade | null) => void;

  /** Currently selected student id. */
  selectedStudentId: number | null;
  setSelectedStudentId: Dispatch<SetStateAction<number | null>>;

  /**
   * Call this to request a student change. Routes through the active page's
   * handler (stored in selectHandlerRef) so each page can run its own
   * guard logic (dirty-check, annotation flush) before the switch happens.
   */
  selectStudent: (id: number) => void;

  /**
   * The ref pages write their selection guard to. Write a stable wrapper
   * on mount via useLayoutEffect (see grade-sheet-client / review-client).
   * The default handler is a plain setSelectedStudentId call.
   */
  selectHandlerRef: MutableRefObject<(id: number) => void>;

  /** Ref to the student list scroll container so position survives navigation. */
  scrollRef: MutableRefObject<HTMLDivElement | null>;
}

const GradingContext = createContext<GradingContextValue | null>(null);

export function useGrading() {
  const ctx = useContext(GradingContext);
  if (!ctx) throw new Error("useGrading must be used inside <GradingProvider>");
  return ctx;
}

interface GradingProviderProps {
  initialStudents: StudentWithGrade[];
  initialStudentId?: number;
  children: ReactNode;
}

export function GradingProvider({
  initialStudents,
  initialStudentId,
  children,
}: GradingProviderProps) {
  // Internal state retains the full StudentWithGrade shape so GradeSheetClient
  // can read entries/feedback when switching students.
  const [students, setStudents] = useState<StudentWithGrade[]>(initialStudents);

  const startId =
    (initialStudentId
      ? initialStudents.find((s) => s.id === initialStudentId)?.id
      : undefined) ?? initialStudents[0]?.id ?? null;

  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(startId);

  // Focused grade updater — the only mutation the public API exposes.
  const updateStudentGrade = useCallback(
    (studentId: number, grade: StudentGrade | null) => {
      setStudents((prev) =>
        prev.map((s) => (s.id === studentId ? { ...s, grade } : s)),
      );
    },
    [],
  );

  // Default handler: plain id swap. Pages replace this in useLayoutEffect.
  const selectHandlerRef = useRef<(id: number) => void>((id) =>
    setSelectedStudentId(id),
  );

  // Stable caller — never recreated, always routes through the current handler.
  const selectStudent = useCallback(
    (id: number) => selectHandlerRef.current(id),
    [],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <GradingContext.Provider
      value={{
        // StudentWithGrade[] is structurally assignable to GradingStudent[]
        // because StudentWithGrade satisfies every field GradingStudent declares.
        students,
        updateStudentGrade,
        selectedStudentId,
        setSelectedStudentId,
        selectStudent,
        selectHandlerRef,
        scrollRef,
      }}
    >
      {children}
    </GradingContext.Provider>
  );
}
