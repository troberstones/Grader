// Learning Suite CSV roster format (columns vary by export)
export interface LMSRosterRow {
  "Student Name"?: string;
  "Last Name"?: string;
  "First Name"?: string;
  "Net ID"?: string;
  "Student ID"?: string;
  "Email"?: string;
  "Section"?: string;
  [key: string]: string | undefined;
}

// Grade export format for Learning Suite bulk import
export interface LMSGradeExportRow {
  "Net ID": string;
  "Student Name": string;
  "Score": string;
  "Feedback"?: string;
}
