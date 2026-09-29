import { describe, expect, it } from "vitest";

import { buildIngestPrompt, matchSegments, mergeFeedback, parseIngestFile } from "./comment-ingest";

const roster = [
  { id: 1, name: "Adriana Bassett", sortName: "Bassett, Adriana", netId: "b4ss3tt" },
  { id: 2, name: "Payson Dolbin", sortName: "Dolbin, Payson", netId: "pdolbin" },
  { id: 3, name: "Ethan Wright", sortName: "Wright, Ethan", netId: "ewright" },
  { id: 4, name: "Jacob Wright", sortName: "Wright, Jacob", netId: null },
];

const file = JSON.stringify({
  segments: [
    { timestamp: "00:02", transcript_name: "Adriana", student_list_name: "Bassett, Adriana", net_id: "B4SS3TT", match_status: "exact", summary: "A" },
    { timestamp: "01:45", transcript_name: "Pason", student_list_name: "Dolbin, Payson", net_id: null, match_status: "probable", summary: "P" },
    { timestamp: "39:09", transcript_name: null, student_list_name: null, net_id: null, match_status: "unmatched", possible_matches: ["Wright, Ethan", "Wright, Jacob"], summary: "W" },
    { timestamp: "40:00", transcript_name: "x", match_status: "exact", summary: "" },
  ],
});

describe("comment ingest", () => {
  it("parses JSON wrapped in a markdown fence and drops empty summaries", () => {
    const parsed = parseIngestFile("Here you go:\n```json\n" + file + "\n```");
    expect(parsed.segments).toHaveLength(3);
  });

  it("rejects input with no segments", () => {
    expect(() => parseIngestFile("{}")).toThrow(/segments/);
    expect(() => parseIngestFile("nope")).toThrow(/No JSON/);
  });

  it("matches by net ID, then by roster name, and leaves unmatched for a manual pick", () => {
    const [a, p, w] = matchSegments(parseIngestFile(file), roster);
    expect(a.studentId).toBe(1);
    expect(p.studentId).toBe(2);
    expect(w.studentId).toBeNull();
    expect(w.candidateIds).toEqual([3, 4]);
  });

  it("appends without duplicating text already present", () => {
    expect(mergeFeedback(null, "new", "append")).toBe("new");
    expect(mergeFeedback("old", "new", "append")).toBe("old\n\nnew");
    expect(mergeFeedback("old\n\nnew", "new", "append")).toBe("old\n\nnew");
    expect(mergeFeedback("old", "new", "replace")).toBe("new");
  });

  it("puts every roster name and net ID in the prompt", () => {
    const prompt = buildIngestPrompt("Materials", roster);
    expect(prompt).toContain("Bassett, Adriana | b4ss3tt");
    expect(prompt).toContain("Wright, Jacob | (no net ID)");
  });
});
