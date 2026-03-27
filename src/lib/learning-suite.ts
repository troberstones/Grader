import type { LMSRosterRow, LMSGradeExportRow } from "@/types/learning-suite";

/**
 * Parse a Learning Suite roster CSV row into a normalized student record.
 * Handles various column name formats from LS exports.
 */
export function normalizeRosterRow(row: LMSRosterRow): {
  name: string;
  sortName: string;
  netId: string | null;
  lmsStudentId: string | null;
  email: string | null;
} | null {
  const lastName = row["Last Name"]?.trim();
  const firstName = row["First Name"]?.trim();
  const fullName = row["Student Name"]?.trim();
  const netId = row["Net ID"]?.trim() || null;
  const lmsStudentId = row["Student ID"]?.trim() || null;
  const email = row["Email"]?.trim() || null;

  let name: string;
  let sortName: string;

  if (lastName && firstName) {
    name = `${firstName} ${lastName}`;
    sortName = `${lastName}, ${firstName}`;
  } else if (fullName) {
    name = fullName;
    // Try to parse "Last, First" format
    if (fullName.includes(",")) {
      sortName = fullName;
      const parts = fullName.split(",").map((p) => p.trim());
      name = `${parts[1]} ${parts[0]}`;
    } else {
      sortName = fullName;
    }
  } else {
    return null;
  }

  return { name, sortName, netId, lmsStudentId, email };
}

/**
 * Format a grade export row for Learning Suite bulk import.
 */
export function formatGradeExportRow(
  netId: string,
  studentName: string,
  score: number,
  feedback?: string
): LMSGradeExportRow {
  return {
    "Net ID": netId,
    "Student Name": studentName,
    "Score": String(score),
    ...(feedback ? { "Feedback": feedback } : {}),
  };
}
