export interface RubricLevel {
  level: number; // 0=lowest, 3=Professional
  label: string;
  description: string;
  points: number;
}

export interface RubricCriterion {
  name: string;
  description?: string;
  weight: number;
  levels: RubricLevel[];
}

export interface RubricSettings {
  gradingMode?: "v3";
  // Marks a rubric authored by the new share-model editor (src/lib/rubric/).
  // Coexists with gradingMode: "v3" above — different rubrics carry one or
  // the other, never both.
  model?: "share";
  bandEdges?: [number, number, number];
}

export interface RubricJSON {
  name: string;
  description?: string;
  settings?: RubricSettings;
  criteria: RubricCriterion[];
}
