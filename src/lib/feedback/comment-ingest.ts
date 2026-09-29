/**
 * Ingesting spoken critique comments into written feedback.
 *
 * The workflow: the professor records a class critique, gets a transcript,
 * and pastes it — together with the prompt built by `buildIngestPrompt` —
 * into an LLM. The LLM answers with JSON in the `CommentIngestFile` shape,
 * which `parseIngestFile` reads and `matchSegments` pins to roster students.
 * The professor then confirms the matches before anything is written.
 */

export type RosterEntry = {
  id: number;
  name: string;
  sortName: string;
  netId: string | null;
};

export type MatchStatus = "exact" | "probable" | "unmatched";

export type IngestSegment = {
  timestamp: string | null;
  transcript_name: string | null;
  student_list_name: string | null;
  net_id: string | null;
  match_status: MatchStatus;
  possible_matches?: string[];
  summary: string;
};

export type CommentIngestFile = {
  segments: IngestSegment[];
};

export type MatchedSegment = IngestSegment & {
  /** Roster student this segment resolved to, or null if it needs a manual pick. */
  studentId: number | null;
  /** Roster ids named in `possible_matches`, for putting first in the manual picker. */
  candidateIds: number[];
};

const EXAMPLE = `{
  "sources": { "transcript": "critique.txt", "student_list": "roster in prompt" },
  "counts": {
    "student_list_entries": 24,
    "named_transcript_segments": 20,
    "unnamed_transcript_segments": 1,
    "exact_matches": 12,
    "probable_matches": 8,
    "students_without_identifiable_segments": 4
  },
  "segments": [
    {
      "timestamp": "00:02",
      "transcript_name": "Adriana",
      "student_list_name": "Bassett, Adriana",
      "net_id": "b4ss3tt",
      "match_status": "exact",
      "summary": "Improved overall. Differentiate rusty metal from paint with separate materials and bump settings, reduce the bump, and add more breakup to highlights."
    },
    {
      "timestamp": "01:45",
      "transcript_name": "Pason",
      "student_list_name": "Dolbin, Payson",
      "net_id": "pdolbin",
      "match_status": "probable",
      "summary": "Wood looks good, but the paint layer is too deep and behaves unnaturally. Make flaking expose the wood and preserve the strong overall fidelity and color."
    },
    {
      "timestamp": "39:09",
      "transcript_name": null,
      "student_list_name": null,
      "net_id": null,
      "match_status": "unmatched",
      "possible_matches": ["Wright, Ethan", "Wright, Jacob"],
      "summary": "Improve tactile grunge, clarify material identity and roughness, and make chips and material transitions more convincing."
    }
  ],
  "mismatches": [
    { "transcript_name": "Pason", "possible_match": "Dolbin, Payson", "issue": "Spelling variation: Pason versus Payson." },
    {
      "transcript_name": null,
      "possible_matches": ["Wright, Ethan", "Wright, Jacob"],
      "issue": "No clearly named segment for these students. The unnamed segment at 39:09 may be one of them."
    }
  ]
}`;

/** The prompt the professor copies into an LLM alongside the transcript. */
export function buildIngestPrompt(assignmentName: string, roster: RosterEntry[]): string {
  const rosterLines = roster
    .map((s) => `${s.sortName}${s.netId ? ` | ${s.netId}` : " | (no net ID)"}`)
    .join("\n");

  return `You are helping an art professor turn a recorded critique into written feedback for each student.

Below is the class roster for "${assignmentName}" (format: "Last, First | net ID"), followed by a transcript of the critique. The professor critiques students one at a time and usually says the student's first name (or a nickname) at the start of each critique. The transcript is machine-generated, so names are often misspelled or phonetically garbled.

Your job:
1. Split the transcript into one segment per student critique. Use the timestamp where each critique begins.
2. Match each segment to exactly one roster entry.
   - "exact": the spoken name clearly matches a roster first name (or unique full name).
   - "probable": a spelling variant, nickname, surname-based shorthand, or phonetic garble that most likely points to one roster entry.
   - "unmatched": no name is said, or it could plausibly be more than one student. Set student_list_name and net_id to null and list the candidates in "possible_matches".
   Never invent students. student_list_name must be copied exactly from the roster ("Last, First") and net_id must be that student's net ID.
3. Write a "summary" of the critique addressed to the student: 1–3 sentences of concrete, actionable feedback in plain language, keeping the professor's specific observations (what works, what to change). Do not include grades or scores.
4. In "mismatches", list every probable or unmatched segment with a short explanation, plus one entry listing roster students who have no identifiable segment.
5. Fill in "counts" accordingly.

Respond with ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:

${EXAMPLE}

ROSTER (${roster.length} students):
${rosterLines}

TRANSCRIPT:
[paste the transcript here]
`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Reads the LLM's answer. Tolerates markdown code fences and stray prose
 * around the JSON object, since chat UIs add them no matter what the prompt
 * says. Throws with a readable message on anything unusable.
 */
export function parseIngestFile(text: string): CommentIngestFile {
  let body = text.trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) body = fenced[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found.");

  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const segmentsRaw = (raw as { segments?: unknown })?.segments;
  if (!Array.isArray(segmentsRaw)) throw new Error('Expected a "segments" array.');

  const segments: IngestSegment[] = [];
  for (const s of segmentsRaw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const summary = str(o.summary);
    if (!summary) continue;
    const status = o.match_status === "exact" || o.match_status === "probable" ? o.match_status : "unmatched";
    segments.push({
      timestamp: str(o.timestamp),
      transcript_name: str(o.transcript_name),
      student_list_name: str(o.student_list_name),
      net_id: str(o.net_id),
      match_status: status,
      possible_matches: Array.isArray(o.possible_matches)
        ? o.possible_matches.map(str).filter((x): x is string => x !== null)
        : undefined,
      summary,
    });
  }
  if (segments.length === 0) throw new Error("The file has no segments with a summary.");
  return { segments };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolves each segment to a roster student: by net ID first (the LLM copies
 * it from the roster, so it's the most reliable key), then by the exact
 * "Last, First" name. Anything else is left for the professor to pick.
 */
export function matchSegments(file: CommentIngestFile, roster: RosterEntry[]): MatchedSegment[] {
  const byNetId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const s of roster) {
    if (s.netId) byNetId.set(norm(s.netId), s.id);
    byName.set(norm(s.sortName), s.id);
    byName.set(norm(s.name), s.id);
  }
  const lookupName = (n: string | null) => (n ? byName.get(norm(n)) ?? null : null);

  return file.segments.map((seg) => {
    const studentId =
      seg.match_status === "unmatched"
        ? null
        : (seg.net_id ? byNetId.get(norm(seg.net_id)) ?? null : null) ?? lookupName(seg.student_list_name);
    const candidateIds = (seg.possible_matches ?? [])
      .map(lookupName)
      .filter((id): id is number => id !== null);
    return { ...seg, studentId, candidateIds };
  });
}

/**
 * Merges ingested text into existing feedback. Appending skips text that's
 * already there, so importing the same file twice doesn't double it up.
 */
export function mergeFeedback(existing: string | null, incoming: string, mode: "append" | "replace"): string {
  const prev = existing?.trim() ?? "";
  if (mode === "replace" || prev === "") return incoming.trim();
  if (prev.includes(incoming.trim())) return prev;
  return `${prev}\n\n${incoming.trim()}`;
}
