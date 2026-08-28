import rubricSchema from "../../../../docs/rubric.schema.json";
import { RUBRIC_TEMPLATES } from "./templates";

/**
 * Builds the copy-pasteable prompt described in docs/rubric-authoring.md
 * ("The prompt") — the professor fills in what only they know, copies this
 * into any chat assistant, and pastes the JSON reply into PasteImportPanel.
 * Nothing here is sent anywhere by grader.
 */

export const STUDENT_LEVELS = ["freshman", "sophomore", "junior", "senior", "graduate"] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];

export const STUDENT_LEVEL_LABELS: Record<StudentLevel, string> = {
  freshman: "Freshman",
  sophomore: "Sophomore",
  junior: "Junior",
  senior: "Senior",
  graduate: "Graduate",
};

export interface PromptInputs {
  /** A RUBRIC_TEMPLATES key, or "general" for no type-specific guidance. */
  templateKey: string;
  course: string;
  assignmentName: string;
  whatStudentsProduce: string;
  studentLevel: StudentLevel;
  criteriaCount: number;
}

export function buildRubricPrompt(input: PromptInputs): string {
  const template = RUBRIC_TEMPLATES.find((t) => t.key === input.templateKey);

  const lines: string[] = [
    "You are helping a university studio-art professor write a grading rubric.",
    "Produce **only** a JSON document conforming to the schema below. No commentary before or after, no markdown fence, no explanation.",
    "",
    "**The assignment**",
    `- Course: \`${input.course.trim() || "{{course code — course name}}"}\``,
    `- Assignment: \`${input.assignmentName.trim() || "{{assignment name}}"}\``,
    `- What students produce: \`${input.whatStudentsProduce.trim() || "{{describe the deliverable}}"}\``,
    `- Student level: \`${STUDENT_LEVEL_LABELS[input.studentLevel]}\``,
    `- Number of criteria: about \`${input.criteriaCount}\``,
    "",
  ];

  if (template) {
    lines.push(
      `**Rubric type: ${template.name}**`,
      `- ${template.purpose}`,
      `- Typically used for classes like: ${template.classHint}`,
      "- A starting weight split commonly used for this type of class (adapt the criterion names to the actual assignment; keep this relative emphasis unless it genuinely doesn't fit):",
      ...template.criteria.map((c) => `  - ${c.name} — share ${c.share}`),
      "",
    );
  }

  lines.push(
    "**Rules**",
    "- Do not include point values anywhere. Points are computed by the system from each criterion's `share`. Use `share` to express relative importance: `2` against two `1`s means that criterion is worth half the assignment.",
    "- Exactly four levels per criterion, ordered lowest to highest. Omit `label` — the system supplies the standard labels.",
    '- Each level description says what the work **looks like** at that level, in terms an instructor could point at on screen. Write about the artefact, not the student: "Specular response reads as plastic on metal surfaces", not "Student did not understand materials". Never write "Student shows effort".',
    "- The four descriptions for one criterion must be genuinely distinguishable. If two levels could describe the same submission, rewrite them.",
    "- Criteria must be separately observable. If two criteria would always receive the same score, merge them.",
    "- Pitch the vocabulary at the stated student level.",
    "",
    "**Schema**",
    "```json",
    JSON.stringify(rubricSchema, null, 2),
    "```",
  );

  return lines.join("\n");
}
