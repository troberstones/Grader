/**
 * Quick-start templates for the share-model editor, adapted from a mockup
 * ("grading_model_1.html") proposing 5 class-type presets — a different
 * default weight split, across the same 4 categories, per type of class.
 *
 * These are starting points only: picking one pre-fills the criteria grid
 * (name + share), which the professor then edits freely — rename, add or
 * remove criteria, rebalance shares — exactly like any other rubric. There
 * is no enforced 4-category structure in the data model; a "category" here
 * is just a criterion whose name happens to match one of these four.
 */

export interface RubricTemplate {
  key: string;
  name: string;
  purpose: string;
  classHint: string;
  criteria: Array<{ name: string; description: string; share: number }>;
}

function placeholder(category: string): string {
  return `Describe what "${category}" looks like at this level for this specific assignment.`;
}

function categoryCriteria(
  shares: [number, number, number, number],
): RubricTemplate["criteria"] {
  const names = ["Presentation + Process", "Technical Proficiency", "Craft / Design", "Intentionality"];
  return names.map((name, i) => ({ name, description: placeholder(name), share: shares[i] }));
}

export const RUBRIC_TEMPLATES: RubricTemplate[] = [
  {
    key: "foundational",
    name: "Foundational",
    purpose: "Build individual competence in one specific skill.",
    classHint: "CSANM 150 · Visual Narrative · figure/gesture drawing",
    criteria: categoryCriteria([20, 60, 15, 5]),
  },
  {
    key: "applied",
    name: "Applied Foundations",
    purpose: "Apply learned skills inside a larger, integrative project.",
    classHint: "CSANM 250 · Storyboarding · CSANM 342 Real-Time",
    criteria: categoryCriteria([20, 40, 25, 15]),
  },
  {
    key: "portfolio",
    name: "Portfolio",
    purpose: "Produce work that gets the student hired.",
    classHint: "Previs · Character / Environment (post-split)",
    criteria: categoryCriteria([10, 20, 40, 30]),
  },
  {
    key: "studio",
    name: "Studio",
    purpose: "Navigate real ambiguity with real dependencies — this is the job.",
    classHint: "CSANM 450 / 452 · CSANM 459 / 460R · IP class",
    criteria: categoryCriteria([25, 20, 30, 25]),
  },
  {
    key: "seminar",
    name: "Seminar",
    purpose: "Knowledge, argument, professional judgment.",
    classHint: "DESAN 460 Business & Ethics — a class that fits none of the other four",
    criteria: categoryCriteria([35, 15, 10, 40]),
  },
];
