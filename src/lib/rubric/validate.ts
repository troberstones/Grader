import { DEFAULT_BAND_EDGES, HOUSE_LABELS, bandEdgesProblem } from "./bands";
import type { BandEdges, NormalCriterion, NormalLevel, NormalRubric } from "./types";

/**
 * Validation for rubrics arriving from outside — in practice, a professor's
 * paste from a chat assistant.
 *
 * Written by hand rather than driven from docs/rubric.schema.json, and
 * deliberately: the schema states the shape for the *assistant*, while this
 * states the problem for the *professor*. "must NOT have fewer than 4 items"
 * is a useless sentence to someone who did not write the JSON. Every message
 * here names the criterion by its own name and says what to do about it.
 *
 * Errors block import. Warnings do not — an assistant that adds a stray key or
 * writes one thin description has still produced a usable rubric, and failing
 * on that would send the professor back to the chat window for nothing.
 */

export interface Issue {
  /** Human-facing location, e.g. `criterion 3 ("Lighting"), level 2`. */
  where: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Present whenever `ok` is true: every default filled in. */
  rubric: NormalRubric | null;
}

const MAX_CRITERIA = 12;
const MIN_CRITERIA = 2;
/** Below this a level description is almost always a stub rather than a spec. */
const THIN_DESCRIPTION = 40;

const TOP_LEVEL_KEYS = new Set(["version", "name", "description", "bandEdges", "criteria", "$schema"]);
const CRITERION_KEYS = new Set(["name", "description", "share", "levels"]);
const LEVEL_KEYS = new Set(["label", "description"]);

export function validateRubric(input: unknown): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (where: string, message: string) => errors.push({ where, message });
  const warn = (where: string, message: string) => warnings.push({ where, message });

  if (!isRecord(input)) {
    return {
      ok: false,
      rubric: null,
      warnings,
      errors: [{ where: "the document", message: "this is not a JSON object. Paste the whole reply, starting with { and ending with }." }],
    };
  }

  reportUnknown(input, TOP_LEVEL_KEYS, "the rubric", warn);

  if (input.version !== 1) {
    err("the rubric", `"version" must be the number 1${input.version === undefined ? ", and it is missing" : `, not ${JSON.stringify(input.version)}`}.`);
  }

  const name = trimmed(input.name);
  if (!name) err("the rubric", `"name" is missing or empty.`);
  else if (name.length < 3) err("the rubric", `the name "${name}" is too short — at least 3 characters.`);
  else if (name.length > 120) err("the rubric", `the name is ${name.length} characters; the limit is 120.`);

  const description = trimmed(input.description);
  if (input.description !== undefined && description === null) {
    err("the rubric", `"description" must be text.`);
  } else if (description && description.length > 1000) {
    err("the rubric", `the description is ${description.length} characters; the limit is 1000.`);
  }

  let bandEdges: BandEdges = DEFAULT_BAND_EDGES;
  if (input.bandEdges !== undefined) {
    if (!Array.isArray(input.bandEdges)) {
      err("the rubric", `"bandEdges" must be a list of three numbers.`);
    } else {
      const problem = bandEdgesProblem(input.bandEdges as number[]);
      if (problem) err("the rubric", `"bandEdges" ${problem}.`);
      else bandEdges = [input.bandEdges[0], input.bandEdges[1], input.bandEdges[2]] as BandEdges;
    }
  }

  if (!Array.isArray(input.criteria)) {
    err("the rubric", `"criteria" is missing, or is not a list.`);
    return { ok: false, errors, warnings, rubric: null };
  }

  if (input.criteria.length < MIN_CRITERIA) {
    err("the rubric", `there ${input.criteria.length === 1 ? "is 1 criterion" : `are ${input.criteria.length} criteria`}; a rubric needs at least ${MIN_CRITERIA}.`);
  } else if (input.criteria.length > MAX_CRITERIA) {
    err("the rubric", `there are ${input.criteria.length} criteria; the limit is ${MAX_CRITERIA}, beyond which a rubric cannot be used during a live critique.`);
  }

  const criteria: NormalCriterion[] = [];
  const seenNames = new Map<string, number>();

  input.criteria.forEach((raw: unknown, i: number) => {
    const label = (n?: string | null) => `criterion ${i + 1}${n ? ` ("${n}")` : ""}`;

    if (!isRecord(raw)) {
      err(label(), "is not an object.");
      return;
    }

    const cname = trimmed(raw.name);
    reportUnknown(raw, CRITERION_KEYS, label(cname), warn);

    if (!cname) err(label(), `has no "name".`);
    else if (cname.length < 2) err(label(cname), "has a name shorter than 2 characters.");
    else if (cname.length > 80) err(label(cname), `has an ${cname.length}-character name; the limit is 80.`);

    if (cname) {
      const key = cname.toLowerCase();
      const first = seenNames.get(key);
      if (first !== undefined) {
        err(label(cname), `repeats the name of criterion ${first + 1}. Two criteria with the same name make a grade impossible to read back.`);
      } else {
        seenNames.set(key, i);
      }
    }

    const cdesc = trimmed(raw.description);
    if (cdesc && cdesc.length > 500) {
      err(label(cname), `has a ${cdesc.length}-character description; the limit is 500.`);
    }

    let share = 1;
    if (raw.share !== undefined) {
      if (typeof raw.share !== "number" || !Number.isFinite(raw.share)) {
        err(label(cname), `has a "share" that is not a number.`);
      } else if (raw.share <= 0) {
        err(label(cname), `has a share of ${raw.share}; shares must be greater than zero.`);
      } else {
        share = raw.share;
      }
    }

    const levels = validateLevels(raw.levels, label(cname), err, warn);
    if (levels && cname) {
      criteria.push({ name: cname, description: cdesc, share, levels });
    }
  });

  const ok = errors.length === 0;

  return {
    ok,
    errors,
    warnings,
    rubric: ok && name ? { version: 1, name, description, bandEdges, criteria } : null,
  };
}

function validateLevels(
  raw: unknown,
  where: string,
  err: (where: string, message: string) => void,
  warn: (where: string, message: string) => void,
): NormalCriterion["levels"] | null {
  if (!Array.isArray(raw)) {
    err(where, `has no "levels" list.`);
    return null;
  }

  if (raw.length !== 4) {
    err(where, `has ${raw.length} level${raw.length === 1 ? "" : "s"}; every criterion needs exactly 4, because the grading grid is a fixed grid.`);
    return null;
  }

  const out: NormalLevel[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < 4; i++) {
    const level = raw[i];
    const at = `${where}, level ${i}`;

    if (!isRecord(level)) {
      err(at, "is not an object.");
      return null;
    }

    reportUnknown(level, LEVEL_KEYS, at, warn);

    const desc = trimmed(level.description);
    if (!desc) {
      err(at, "has no description. Every level needs one — it is what the student reads.");
      return null;
    }
    if (desc.length < 10) {
      err(at, `has a ${desc.length}-character description, which cannot say anything useful.`);
      return null;
    }
    if (desc.length > 400) {
      err(at, `has a ${desc.length}-character description; the limit is 400.`);
      return null;
    }
    if (desc.length < THIN_DESCRIPTION) {
      warn(at, `the description is only ${desc.length} characters and reads as a stub.`);
    }

    const key = normalise(desc);
    const first = seen.get(key);
    if (first !== undefined) {
      err(at, `says the same thing as level ${first}. If two levels could describe the same submission, the grader cannot choose between them.`);
      return null;
    }
    seen.set(key, i);

    const labelText = trimmed(level.label);
    if (labelText && labelText.length > 60) {
      err(at, `has a ${labelText.length}-character label; the limit is 60.`);
      return null;
    }

    out.push({ label: labelText ?? HOUSE_LABELS[i], description: desc });
  }

  return out as NormalCriterion["levels"];
}

// ─── The repair loop ────────────────────────────────────────────────────

/**
 * A message the professor can paste straight back to the assistant.
 *
 * This is the part that makes AI authoring usable. Slightly-wrong JSON is the
 * normal case, not the exception, and a professor who has to understand a
 * validation error in order to proceed is a professor who stops using the
 * feature. Returns null when there is nothing to fix.
 */
export function repairMessage(result: ValidationResult): string | null {
  if (result.ok) return null;

  const lines = result.errors.map((e) => `- ${e.where}: ${e.message}`);

  return [
    "That rubric did not validate. Please fix these problems and return the corrected JSON — the whole document, with no commentary:",
    "",
    ...lines,
    "",
    "Keep everything else exactly as it was. Remember: no point values anywhere, exactly four levels per criterion, and the four descriptions for one criterion must be genuinely distinguishable from each other.",
  ].join("\n");
}

// ─── helpers ────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trimmed(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim();
}

/**
 * Assistants routinely add `total_points`, `instructions` or `grading_scale`.
 * Stripping them silently would hide a misunderstanding about who computes
 * points; failing on them would send the professor back to the chat for
 * something harmless. So: strip, and say so.
 */
function reportUnknown(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
  warn: (where: string, message: string) => void,
): void {
  const extra = Object.keys(obj).filter((k) => !allowed.has(k));
  if (extra.length) {
    warn(where, `ignored unexpected ${extra.length === 1 ? "key" : "keys"}: ${extra.map((k) => `"${k}"`).join(", ")}.`);
  }
}
