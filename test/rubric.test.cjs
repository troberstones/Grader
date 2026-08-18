"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { BAND_PRESETS, fractionFor, levelFractions, bandEdgesProblem, letterFor, round1 } = require("./.build/bands");
const { computeScore, criterionPoints, previewOutcomes, bandTable } = require("./.build/score");
const { validateRubric, repairMessage } = require("./.build/validate");
const { toNormalRubric, toSelections, fromSelections, isShareModel } = require("./.build/adapter");

const ADVANCED = BAND_PRESETS.advanced; // [0.55, 0.74, 0.88]
const V1_BANDS = [0.12, 0.4, 0.72]; // what the original rubrics used

// ─── helpers ────────────────────────────────────────────────────────────

let unique = 0;
/** A level description long enough to avoid the "reads as a stub" warning. */
function desc(text) {
  unique += 1;
  return `${text} — observable in the render itself, not inferred (${unique}).`;
}

function criterion(name, share) {
  return {
    name,
    share,
    levels: [
      { description: desc("Nothing legible has been attempted here") },
      { description: desc("The intent is visible but key aspects are absent") },
      { description: desc("Reads correctly with flaws a viewer would forgive") },
      { description: desc("Indistinguishable from professional work") },
    ],
  };
}

function rubric(criteriaCount = 4, extra = {}) {
  const names = ["Light Response", "Material Authoring", "Texture Maps", "Composition", "Render Quality", "Effort"];
  return {
    version: 1,
    name: "Shading",
    criteria: Array.from({ length: criteriaCount }, (_, i) => criterion(names[i])),
    ...extra,
  };
}

function valid(input) {
  const result = validateRubric(input);
  assert.deepStrictEqual(result.errors, [], "expected no validation errors");
  assert.ok(result.rubric, "expected a normalised rubric");
  return result.rubric;
}

const allAt = (n, level) => Array.from({ length: n }, (_, i) => ({ criterionIndex: i, level }));

/** A DB-shaped criterion row: level ids are levelIdsStart + level (0-3). */
function dbCriterion(id, name, share, levelIdsStart) {
  return {
    id,
    name,
    description: null,
    share,
    levels: [0, 1, 2, 3].map((level) => ({
      id: levelIdsStart + level,
      level,
      label: `L${level}`,
      description: `Description for level ${level} of ${name}`,
    })),
  };
}

// ─── band arithmetic ────────────────────────────────────────────────────

test("level 3 is always the full fraction", () => {
  assert.deepStrictEqual(levelFractions(ADVANCED), [0.55, 0.74, 0.88, 1]);
  assert.strictEqual(fractionFor(ADVANCED, 3), 1);
});

test("a nudge moves a third of the way toward the neighbouring band", () => {
  // level 2 sits at 0.88; the gap up to mastery is 0.12, so +1 lands at 0.92.
  assert.strictEqual(round1(fractionFor(ADVANCED, 2, 1) * 100), 92);
  // the gap down to level 1 is 0.14, so -1 lands at 0.8333…
  assert.strictEqual(round1(fractionFor(ADVANCED, 2, -1) * 100), 83.3);
});

test("nudging up from mastery does nothing, because there is nothing above 100%", () => {
  assert.strictEqual(fractionFor(ADVANCED, 3, 1), 1);
});

test("nudging below level 0 extrapolates the gap rather than inventing a floor", () => {
  // The 0→1 gap is 0.19, so the imagined band below level 0 sits at 0.36 and a
  // third of that gap is 0.0633.
  assert.strictEqual(round1(fractionFor(ADVANCED, 0, -1) * 100), 48.7);
  assert.ok(fractionFor(ADVANCED, 0, -1) > 0, "must never reach zero — that is what 'missing' is for");
});

test("nudged positions never escape 0..1", () => {
  for (const level of [0, 1, 2, 3]) {
    for (const nudge of [-1, 0, 1]) {
      const f = fractionFor(ADVANCED, level, nudge);
      assert.ok(f >= 0 && f <= 1, `level ${level} nudge ${nudge} gave ${f}`);
    }
  }
});

test("band edges must be increasing and strictly inside 0..1", () => {
  assert.strictEqual(bandEdgesProblem(ADVANCED), null);
  assert.match(bandEdgesProblem([0.5, 0.4, 0.9]), /increase/);
  assert.match(bandEdgesProblem([0, 0.4, 0.9]), /between 0 and 1/);
  assert.match(bandEdgesProblem([0.5, 0.9, 1]), /between 0 and 1/);
  assert.match(bandEdgesProblem([0.5, 0.9]), /exactly three/);
});

test("the band table reports all three positions per level", () => {
  const rows = bandTable(ADVANCED);
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows[2], { level: 2, minus: 83.3, base: 88, plus: 92 });
});

// ─── the calibration regression ─────────────────────────────────────────

test("the v1 bands failed students doing acceptable work", () => {
  // This is the bug the whole points model exists to fix: four criteria all at
  // "Good with Minor Flaws" — a compliment — earned a C-.
  const v1 = previewOutcomes(V1_BANDS, 4).find((r) => r.label === "all good, minor flaws");
  assert.strictEqual(v1.percent, 72);
  assert.strictEqual(v1.letter, "C-");

  const now = previewOutcomes(ADVANCED, 4).find((r) => r.label === "all good, minor flaws");
  assert.strictEqual(now.percent, 88);
  assert.strictEqual(now.letter, "B+");
});

test("the v1 bands turned one weak criterion into a failing grade", () => {
  const rows = previewOutcomes(V1_BANDS, 4);
  const mixed = rows.find((r) => r.label === "half good, half lacking");
  assert.strictEqual(mixed.letter, "F", "good in half the categories should not be an F");

  const now = previewOutcomes(ADVANCED, 4).find((r) => r.label === "half good, half lacking");
  assert.strictEqual(now.percent, 81);
});

test("mastery is 100% and no-effort still fails, under the new bands", () => {
  const rows = previewOutcomes(ADVANCED, 4);
  assert.strictEqual(rows.find((r) => r.label === "all mastery").percent, 100);
  assert.strictEqual(rows.find((r) => r.label === "all little / no effort").letter, "F");
});

test("the foundation preset lifts good-but-flawed work to an A-", () => {
  const row = previewOutcomes(BAND_PRESETS.foundation, 4).find((r) => r.label === "all good, minor flaws");
  assert.strictEqual(row.percent, 92);
  assert.strictEqual(row.letter, "A-");
});

test("preview degrades sensibly for a two-criterion rubric", () => {
  const rows = previewOutcomes(ADVANCED, 2);
  assert.ok(rows.length >= 4);
  assert.strictEqual(rows.find((r) => r.label === "all mastery").percent, 100);
});

test("letters follow the standard scale", () => {
  assert.strictEqual(letterFor(93), "A");
  assert.strictEqual(letterFor(92.9), "A-");
  assert.strictEqual(letterFor(59.9), "F");
});

// ─── scoring ────────────────────────────────────────────────────────────

test("an all-mastery rubric earns the whole assignment", () => {
  const r = valid(rubric(4));
  const s = computeScore(r, allAt(4, 3), 150);
  assert.strictEqual(s.points, 150);
  assert.strictEqual(s.percent, 100);
  assert.strictEqual(s.complete, true);
});

test("the same rubric works unchanged on assignments of different sizes", () => {
  const r = valid(rubric(4));
  const sel = allAt(4, 2);
  assert.strictEqual(computeScore(r, sel, 50).points, 44);
  assert.strictEqual(computeScore(r, sel, 200).points, 176);
  // Identical percentage: the rubric is dimensionless.
  assert.strictEqual(computeScore(r, sel, 50).percent, computeScore(r, sel, 200).percent);
});

test("shares weight the mean", () => {
  const r = valid({
    version: 1,
    name: "Weighted",
    criteria: [criterion("Heavy", 3), criterion("Light", 1)],
  });
  // 3 parts at mastery, 1 part at level 0 → (3×1 + 1×0.55) / 4 = 0.8875
  const s = computeScore(r, [
    { criterionIndex: 0, level: 3 },
    { criterionIndex: 1, level: 0 },
  ], 100);
  assert.strictEqual(s.percent, 88.8);
});

test("rounding happens once, on the final figure", () => {
  const r = valid(rubric(3));
  const s = computeScore(r, [
    { criterionIndex: 0, level: 0 },
    { criterionIndex: 1, level: 1 },
    { criterionIndex: 2, level: 2 },
  ], 100);
  // (0.55 + 0.74 + 0.88) / 3 = 0.723333… → 72.3, not a sum of rounded parts.
  assert.strictEqual(s.percent, 72.3);
  // Criteria expose fractions and no points, so there is nothing to sum wrongly.
  assert.ok(!("points" in s.perCriterion[0]));
});

test("a part-graded rubric reports the grade so far, not a failing one", () => {
  const r = valid(rubric(4));
  const s = computeScore(r, allAt(2, 3), 100);
  assert.strictEqual(s.scored, 2);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.complete, false);
  assert.strictEqual(s.percent, 100, "two of four at mastery is 100% so far, not 50%");
});

test("an ungraded rubric has no score at all", () => {
  const r = valid(rubric(4));
  const s = computeScore(r, [], 100);
  assert.strictEqual(s.points, null);
  assert.strictEqual(s.fraction, null);
  assert.strictEqual(s.scored, 0);
});

test("selections outside the rubric are ignored rather than trusted", () => {
  const r = valid(rubric(2));
  const s = computeScore(r, [{ criterionIndex: 0, level: 3 }, { criterionIndex: 9, level: 0 }], 100);
  assert.strictEqual(s.scored, 1);
  assert.strictEqual(s.percent, 100);
});

test("criterionPoints sums to the total when every criterion is scored", () => {
  const r = valid(rubric(2));
  const selections = [{ criterionIndex: 0, level: 3 }, { criterionIndex: 1, level: 0 }];
  const score = computeScore(r, selections, 100);
  const p0 = criterionPoints(r, score.perCriterion[0], 100);
  const p1 = criterionPoints(r, score.perCriterion[1], 100);
  assert.strictEqual(round1(p0 + p1), score.points);
});

test("criterionPoints stays stable regardless of what else gets scored later", () => {
  const r = valid(rubric(2));
  // Only one of two equal-share criteria scored: computeScore reports the
  // grade "so far" (100%, since the one scored criterion is mastery)...
  const score = computeScore(r, [{ criterionIndex: 0, level: 3 }], 100);
  assert.strictEqual(score.points, 100);
  // ...but this criterion is only half the rubric's total share, so its own
  // stable number is 50 — it must not jump to 100 just because nothing else
  // is scored yet, and must not later jump again once the other one is.
  assert.strictEqual(criterionPoints(r, score.perCriterion[0], 100), 50);
});

test("nudges reach the score", () => {
  const r = valid(rubric(2));
  const plain = computeScore(r, allAt(2, 2), 100).percent;
  const nudged = computeScore(r, [
    { criterionIndex: 0, level: 2, nudge: 1 },
    { criterionIndex: 1, level: 2, nudge: 1 },
  ], 100).percent;
  assert.strictEqual(plain, 88);
  assert.strictEqual(nudged, 92);
});

// ─── validation ─────────────────────────────────────────────────────────

test("a well-formed rubric validates with no complaints", () => {
  const result = validateRubric(rubric(4));
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.warnings, []);
  assert.strictEqual(result.rubric.criteria.length, 4);
});

test("defaults are filled in so nothing downstream asks what was omitted", () => {
  const r = valid(rubric(2));
  assert.deepStrictEqual(r.bandEdges, BAND_PRESETS.advanced);
  assert.strictEqual(r.criteria[0].share, 1);
  assert.strictEqual(r.criteria[0].levels[0].label, "Little / No Effort");
  assert.strictEqual(r.criteria[0].levels[3].label, "Professional / Mastery");
  assert.strictEqual(r.description, null);
});

test("an authored label overrides the house one", () => {
  const input = rubric(2);
  input.criteria[0].levels[3].label = "Exhibition ready";
  const r = valid(input);
  assert.strictEqual(r.criteria[0].levels[3].label, "Exhibition ready");
});

test("a non-object is rejected with advice about pasting", () => {
  const result = validateRubric("not json");
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].message, /Paste the whole reply/);
});

test("the wrong number of levels is an error, naming the criterion", () => {
  const input = rubric(2);
  input.criteria[1].levels.pop();
  const result = validateRubric(input);
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].where, /Material Authoring/);
  assert.match(result.errors[0].message, /has 3 levels; every criterion needs exactly 4/);
});

test("two levels saying the same thing is an error", () => {
  const input = rubric(2);
  input.criteria[0].levels[2].description = input.criteria[0].levels[1].description;
  const result = validateRubric(input);
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].message, /says the same thing as level 1/);
});

test("trailing punctuation and casing do not hide a duplicated level", () => {
  const input = rubric(2);
  input.criteria[0].levels[2].description = input.criteria[0].levels[1].description.toUpperCase() + ".";
  assert.strictEqual(validateRubric(input).ok, false);
});

test("duplicate criterion names are an error", () => {
  const input = rubric(3);
  input.criteria[2].name = "light response";
  const result = validateRubric(input);
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].message, /repeats the name of criterion 1/);
});

test("too few and too many criteria are both rejected", () => {
  assert.strictEqual(validateRubric(rubric(1)).ok, false);
  const many = { version: 1, name: "Huge", criteria: Array.from({ length: 13 }, (_, i) => criterion(`C${i}`)) };
  const result = validateRubric(many);
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].message, /live critique/);
});

test("a zero or negative share is an error", () => {
  const input = rubric(2);
  input.criteria[0].share = 0;
  assert.match(validateRubric(input).errors[0].message, /greater than zero/);
});

test("bad band edges are reported against the rubric", () => {
  const result = validateRubric(rubric(2, { bandEdges: [0.9, 0.4, 0.5] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.errors[0].message, /bandEdges/);
});

test("good band edges are carried through", () => {
  const r = valid(rubric(2, { bandEdges: [0.6, 0.8, 0.92] }));
  assert.deepStrictEqual(r.bandEdges, [0.6, 0.8, 0.92]);
});

test("a missing version is an error, since the shape may change", () => {
  const input = rubric(2);
  delete input.version;
  assert.match(validateRubric(input).errors[0].message, /is missing/);
});

test("keys the assistant invented are stripped with a warning, not a failure", () => {
  const input = rubric(2, { total_points: 100, grading_scale: "A-F" });
  const result = validateRubric(input);
  assert.strictEqual(result.ok, true, "harmless extras must not send the professor back to the chat");
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /"total_points"/);
  assert.match(result.warnings[0].message, /"grading_scale"/);
  assert.ok(!("total_points" in result.rubric));
});

test("a thin level description warns but still imports", () => {
  const input = rubric(2);
  input.criteria[0].levels[0].description = "Did not try.";
  const result = validateRubric(input);
  assert.strictEqual(result.ok, true);
  assert.match(result.warnings[0].message, /stub/);
});

test("a level description too short to say anything is an error", () => {
  const input = rubric(2);
  input.criteria[0].levels[0].description = "Bad.";
  assert.strictEqual(validateRubric(input).ok, false);
});

test("every error names where it happened", () => {
  const input = rubric(3);
  input.criteria[1].levels.pop();
  input.criteria[2].share = -1;
  const result = validateRubric(input);
  assert.ok(result.errors.length >= 2);
  for (const e of result.errors) {
    assert.ok(e.where && e.where.length > 0, "an error with no location is unactionable");
  }
});

// ─── the DB-row adapter ─────────────────────────────────────────────────

test("isShareModel checks settings.model, not the legacy gradingMode flag", () => {
  assert.strictEqual(isShareModel({ settings: { model: "share" } }), true);
  assert.strictEqual(isShareModel({ settings: { gradingMode: "v3" } }), false);
  assert.strictEqual(isShareModel({ settings: null }), false);
});

test("toNormalRubric maps db rows to the pure shape, defaulting bandEdges", () => {
  const dbRubric = {
    name: "Shading",
    description: "desc",
    settings: null,
    criteria: [
      dbCriterion(10, "Light Response", 2, 100),
      dbCriterion(11, "Composition", 1, 200),
    ],
  };
  const normal = toNormalRubric(dbRubric);
  assert.strictEqual(normal.version, 1);
  assert.strictEqual(normal.name, "Shading");
  assert.deepStrictEqual(normal.bandEdges, BAND_PRESETS.advanced);
  assert.strictEqual(normal.criteria.length, 2);
  assert.strictEqual(normal.criteria[0].share, 2);
  assert.strictEqual(normal.criteria[0].levels[3].label, "L3");
});

test("toNormalRubric carries an explicit bandEdges through instead of defaulting", () => {
  const dbRubric = {
    name: "X",
    description: null,
    settings: { model: "share", bandEdges: [0.6, 0.8, 0.92] },
    criteria: [dbCriterion(1, "A", 1, 1)],
  };
  assert.deepStrictEqual(toNormalRubric(dbRubric).bandEdges, [0.6, 0.8, 0.92]);
});

test("selections round-trip through db criteria/level ids and back to indices", () => {
  const criteria = [dbCriterion(10, "Light Response", 1, 100), dbCriterion(11, "Composition", 1, 200)];
  const selections = [
    { criterionIndex: 0, level: 3, nudge: 1 },
    { criterionIndex: 1, level: 0, nudge: 0 },
  ];
  const entries = fromSelections(criteria, selections);
  assert.deepStrictEqual(entries, [
    { criteriaId: 10, levelId: 103, nudge: 1 },
    { criteriaId: 11, levelId: 200, nudge: 0 },
  ]);
  assert.deepStrictEqual(toSelections(criteria, entries), selections);
});

test("toSelections skips an entry with no level chosen or an unrecognised criterion", () => {
  const criteria = [dbCriterion(10, "Light Response", 1, 100)];
  const entries = [
    { criteriaId: 10, levelId: null },
    { criteriaId: 999, levelId: 100 },
  ];
  assert.deepStrictEqual(toSelections(criteria, entries), []);
});

test("toSelections normalises an out-of-range nudge to 0 rather than trusting it", () => {
  const criteria = [dbCriterion(10, "Light Response", 1, 100)];
  const entries = [{ criteriaId: 10, levelId: 103, nudge: 7 }];
  assert.deepStrictEqual(toSelections(criteria, entries), [{ criterionIndex: 0, level: 3, nudge: 0 }]);
});

// ─── the repair loop ────────────────────────────────────────────────────

test("a valid rubric needs no repair message", () => {
  assert.strictEqual(repairMessage(validateRubric(rubric(2))), null);
});

test("the repair message is addressed to the assistant, listing every problem", () => {
  const input = rubric(3);
  input.criteria[1].levels.pop();
  input.criteria[2].share = 0;

  const msg = repairMessage(validateRubric(input));
  assert.match(msg, /did not validate/);
  assert.match(msg, /Material Authoring/);
  assert.match(msg, /Texture Maps/);
  assert.match(msg, /no commentary/);
  assert.match(msg, /no point values anywhere/);
  assert.strictEqual(msg.split("\n").filter((l) => l.startsWith("- ")).length, 2);
});
