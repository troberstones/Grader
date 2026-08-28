import { RubricTable } from "./rubric-table";

interface RubricPreviewProps {
  criteria: Array<{
    id?: number;
    name: string;
    weight: number;
    levels: Array<{
      id?: number;
      level: number;
      label: string;
      description: string;
      points: number;
    }>;
  }>;
}

export function RubricPreview({ criteria }: RubricPreviewProps) {
  return <RubricTable criteria={criteria} />;
}
