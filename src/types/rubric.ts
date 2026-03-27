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

export interface RubricJSON {
  name: string;
  description?: string;
  criteria: RubricCriterion[];
}
