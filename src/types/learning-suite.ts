// Roster columns are not modelled as a type any more: exports disagree on
// what they are called, so parseRoster in src/lib/learning-suite.ts detects
// them at runtime instead of asserting a shape the files do not honour.

// Grade export format for Learning Suite bulk import
export interface LMSGradeExportRow {
  "Net ID": string;
  "Student Name": string;
  "Score": string;
  "Feedback"?: string;
}
