import { describe, expect, it } from "vitest";
import type { Stroke } from "@grader/art-review/core";

import { termEndDate } from "@/lib/terms";
import { renderFeedbackEmail } from "./email-html";
import { gradeFingerprint } from "./fingerprint";
import type { FeedbackModel } from "./model";
import { displayName } from "./model";
import { isDot, strokesToSvg } from "./stroke-svg";

const stroke = (over: Partial<Stroke>): Stroke => ({
  localId: "s",
  tool: "pen",
  color: 0xff0000ff,
  width: 4,
  frameIn: 0,
  frameOut: 0,
  authorId: "instructor",
  points: [],
  ...over,
});

describe("dot detection", () => {
  it("treats a tap or a tiny scribble as a dot, and a real line as a mark", () => {
    expect(isDot(stroke({ points: [0.5, 0.5] }), 2000, 1000)).toBe(true);
    expect(isDot(stroke({ points: [0.5, 0.5, 0.5015, 0.5, 0.501, 0.501] }), 2000, 1000)).toBe(true);
    expect(isDot(stroke({ points: [0.1, 0.1, 0.3, 0.2] }), 2000, 1000)).toBe(false);
  });

  it("never counts text or stamps as dots", () => {
    expect(isDot(stroke({ tool: "text", text: "fill", points: [0.5, 0.5] }), 2000, 1000)).toBe(false);
    expect(isDot(stroke({ tool: "stamp", points: [0.5, 0.5] }), 2000, 1000)).toBe(false);
  });
});

describe("stroke SVG", () => {
  it("puts highlighter strokes in their own layer and escapes text", () => {
    const svg = strokesToSvg(
      [
        stroke({ tool: "highlight", points: [0, 0, 1, 1] }),
        stroke({ tool: "text", text: "<rim> & fill", points: [0.2, 0.2] }),
      ],
      2000,
      1000,
      1600,
      800,
    );
    expect(svg.highlight).toContain("<path");
    expect(svg.normal).toContain("&lt;rim&gt; &amp; fill");
    expect(svg.normal).toContain('viewBox="0 0 2000 1000"');
    expect(svg.normal).toContain('width="1600"');
  });

  it("returns null layers when there is nothing to draw", () => {
    expect(strokesToSvg([], 100, 100, 100, 100)).toEqual({ normal: null, highlight: null });
  });
});

describe("grade fingerprint", () => {
  const base = {
    status: "graded",
    totalScore: 47,
    feedback: "Nice.",
    entries: [
      { criteriaId: 2, levelId: 9, nudge: 0, comment: null },
      { criteriaId: 1, levelId: 4, nudge: null, comment: "" },
    ],
  };

  it("ignores entry order and null-vs-empty noise", () => {
    expect(gradeFingerprint(base)).toBe(
      gradeFingerprint({ ...base, feedback: "Nice. ", entries: [...base.entries].reverse().map((e) => ({ ...e, nudge: e.nudge ?? 0 })) }),
    );
  });

  it("changes when anything a student would see changes", () => {
    const fp = gradeFingerprint(base);
    expect(gradeFingerprint({ ...base, feedback: "Nicer." })).not.toBe(fp);
    expect(gradeFingerprint({ ...base, entries: [{ ...base.entries[0], levelId: 10 }, base.entries[1]] })).not.toBe(fp);
    expect(gradeFingerprint({ ...base, status: "missing" })).not.toBe(fp);
  });
});

describe("feedback email", () => {
  const model: FeedbackModel = {
    assignment: { id: 1, name: "Studio <Lighting>" },
    course: { id: 1, code: "ART 101", name: "Lighting", year: 2026, term: "fall" },
    student: { id: 1, name: "Ada Lovelace", sortName: "Lovelace, Ada", email: "ada@students.test" },
    gradeId: 1,
    status: "graded",
    letter: "B+",
    feedback: "Line one\nLine two",
    criteria: [
      {
        name: "Lighting",
        description: null,
        levels: ["Little", "Lacking", "Good", "Mastery"].map((label) => ({ label, description: `${label} work` })),
        selected: 2,
        nudge: 0,
        letter: "B+",
        comment: null,
      },
    ],
    fingerprint: "x",
  };
  const input = {
    model,
    includeRubric: true,
    frames: [{ src: "cid:frame-1@grader", label: "render.mp4 · frame 3", width: 1600, height: 900 }],
    frameNotes: [],
    link: null,
    instructor: { name: "Prof", email: "prof@example.test" },
    testRecipient: null,
  };

  it("escapes names, keeps line breaks, and references frames by cid", () => {
    const { html, subject, text } = renderFeedbackEmail(input);
    expect(subject).toBe("Feedback: Studio <Lighting> (ART 101)");
    expect(html).toContain("Studio &lt;Lighting&gt;");
    expect(html).toContain("Line one<br>Line two");
    expect(html).toContain('src="cid:frame-1@grader"');
    expect(html).toContain("✓ Good");
    expect(text).toContain("Lighting: Good (B+)");
  });

  it("leaves the rubric out when not asked for", () => {
    const { html } = renderFeedbackEmail({ ...input, includeRubric: false });
    expect(html).not.toContain("Lacking work");
    expect(html).not.toContain("Line one");
    expect(html).toContain("B+");
  });
});

describe("helpers", () => {
  it("ends a term on the last day of its final month", () => {
    expect(termEndDate(2026, "fall").toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(termEndDate(2027, "winter").toISOString()).toBe("2027-04-30T23:59:59.000Z");
    expect(termEndDate(2027, "spring").toISOString()).toBe("2027-06-30T23:59:59.000Z");
    expect(termEndDate(2027, "summer").toISOString()).toBe("2027-08-31T23:59:59.000Z");
  });

  it("turns Learning Suite's 'Last, First' into a spoken name", () => {
    expect(displayName("Lovelace, Ada")).toBe("Ada Lovelace");
    expect(displayName("Cher")).toBe("Cher");
    expect(displayName("Smith, Jr., Bob")).toBe("Smith, Jr., Bob");
  });
});
