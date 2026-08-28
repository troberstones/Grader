# The rubric authoring prompt

The prompt a professor pastes into any chat assistant to author a rubric, and
pastes the reply back into **Rubrics → New → Paste**. Written against the
shipped v1 schema (`docs/rubric.schema.json`) and validator
(`src/lib/rubric/validate.ts`) — if either changes, change this with it.

Fill in the bracketed lines, delete the optional blocks you don't want, and
copy everything between the rules.

---

You are helping a university studio-art professor write a grading rubric.
Produce **only** a JSON document conforming to the schema below. No commentary
before or after it, no markdown code fence, no explanation. Your entire reply
must start with `{` and end with `}`.

**The assignment**

- Course: [COURSE CODE — COURSE NAME]
- Assignment: [ASSIGNMENT NAME]
- What students produce: [ONE OR TWO SENTENCES ON THE DELIVERABLE — MEDIUM, SOFTWARE, LENGTH, WHAT IS TURNED IN]
- Student level: [freshman | sophomore | junior | senior | graduate]
- Number of criteria: about [N] (minimum 2, maximum 12)
- What matters most: [OPTIONAL — WHICH ONE OR TWO CRITERIA CARRY THE MOST WEIGHT, OR "all roughly equal"]

**How this rubric is scored — read this before writing anything**

The document you produce contains **no point values whatsoever**. Points are
computed by the system, not by you, from three things: the assignment's total
points, each criterion's `share`, and the rubric's band edges. Do not write
points, percentages, totals, or a grading scale anywhere. A key called
`points`, `total_points`, `max`, `weight`, or `grading_scale` is a mistake.

- `share` is relative importance only. A criterion with `share: 2` against two
  criteria with `share: 1` is worth half the assignment. Shares need not sum to
  anything; they are normalised at import. Omit `share` and it is 1.
- Every criterion has exactly **four levels**, ordered lowest to highest. The
  index in the array *is* the level: 0 is the weakest work, 3 is mastery.
- Omit `label` on every level. The system supplies the house vocabulary:
  0 "Little / No Effort", 1 "Lacking Key Aspects", 2 "Good with Minor Flaws",
  3 "Professional / Mastery". Write your descriptions so they sit honestly
  under those four headings.
- Omit `bandEdges` unless told otherwise below. The default is `[0.55, 0.74, 0.88]`.

**How to write the level descriptions — this is the actual work**

- Describe **the artefact, not the student**. "Specular response reads as
  plastic on metal surfaces" — not "Student did not understand materials", not
  "Student shows effort". Someone should be able to point at the screen and see
  what you are describing.
- The four descriptions for one criterion must be **genuinely distinguishable**.
  If two of them could describe the same submission, rewrite them. Four
  paragraphs that are the same paragraph with intensifiers swapped ("weak",
  "adequate", "strong", "excellent") is a failed rubric. Each level should name
  a *different observable condition*, not the same condition at a different
  volume.
- Level 0 is submitted work that misses the mark, not missing work. Non-submission
  is handled separately by the system, so never write "did not submit".
- Criteria must be **separately observable**. If two criteria would always
  receive the same score on the same submission, merge them into one — four
  criteria that all partly measure "was it lit competently" mark a single
  lighting problem down four times.
- Pitch the vocabulary at the stated student level. A freshman rubric names
  what to look at; a graduate rubric can assume the vocabulary and judge
  decisions.
- Aim for roughly 40–400 characters per level description. Under 40 characters
  reads as a stub and will be flagged.
- Give each criterion a one-sentence `description` saying what it assesses.

**Hard constraints — the importer rejects anything that breaks these**

- `"version": 1`, a `name` of 3–120 characters, and a `criteria` array.
- 2 to 12 criteria. Criterion names must be unique (case-insensitive), 2–80
  characters. Criterion `description` at most 500 characters.
- Exactly 4 levels per criterion — never 3, never 5.
- Each level `description` is 10–400 characters, and no two levels within the
  same criterion may say the same thing.
- Every `share` must be greater than zero.
- **No keys beyond these.** Top level: `version`, `name`, `description`,
  `bandEdges`, `criteria`. Criterion: `name`, `description`, `share`, `levels`.
  Level: `description` (and `label`, which you should omit). Anything else is
  stripped.

**Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://grader.local/schemas/rubric-v1.json",
  "title": "Grader rubric",
  "description": "An authored rubric, ready to import. Point values are NOT part of this document: they are computed at import from the assignment's total points, each criterion's share, and the rubric's band edges. See docs/rubric-authoring.md.",
  "type": "object",
  "required": ["version", "name", "criteria"],
  "additionalProperties": false,
  "properties": {
    "version": {
      "const": 1,
      "description": "Schema version. Always 1."
    },
    "name": {
      "type": "string",
      "minLength": 3,
      "maxLength": 120,
      "description": "Short title, e.g. 'Shading' or 'Environment Final'."
    },
    "description": {
      "type": "string",
      "maxLength": 1000,
      "description": "One or two sentences on what the rubric assesses."
    },
    "bandEdges": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1 },
      "description": "Level 0/1/2 as fractions of a criterion's maximum; level 3 is always 1.0. Must be strictly increasing. Omit to use the course default: [0.55, 0.74, 0.88] (Advanced) or [0.60, 0.80, 0.92] (Foundation). Do NOT spread these evenly across 0-1 — see 'Points and calibration' in rubric-authoring.md.",
      "default": [0.55, 0.74, 0.88]
    },
    "criteria": {
      "type": "array",
      "minItems": 2,
      "maxItems": 12,
      "description": "The rows of the rubric. Two to twelve; beyond that a rubric stops being usable during a live critique.",
      "items": {
        "type": "object",
        "required": ["name", "levels"],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "minLength": 2,
            "maxLength": 80,
            "description": "The criterion, e.g. 'Light Response' or 'Timing & Spacing'."
          },
          "description": {
            "type": "string",
            "maxLength": 500,
            "description": "What this criterion is assessing, in one sentence."
          },
          "share": {
            "type": "number",
            "exclusiveMinimum": 0,
            "default": 1,
            "description": "Relative importance. Shares are normalised across criteria and multiplied by the assignment's total points, so [2,1,1] means the first criterion is worth half. Any positive number; they need not sum to anything."
          },
          "levels": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "description": "Exactly four, ordered lowest to highest. Index in the array IS the level: 0 = lowest, 3 = mastery.",
            "items": {
              "type": "object",
              "required": ["description"],
              "additionalProperties": false,
              "properties": {
                "label": {
                  "type": "string",
                  "maxLength": 60,
                  "description": "Optional. Omit to use the house labels: 'Little / No Effort', 'Lacking Key Aspects', 'Good with Minor Flaws', 'Professional / Mastery'."
                },
                "description": {
                  "type": "string",
                  "minLength": 10,
                  "maxLength": 400,
                  "description": "What work at this level looks like, in observable terms. Specific to this criterion — never generic praise."
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**A rubric in this department's house style, for tone and grain:**

```json
{
  "version": 1,
  "name": "Material & Light Study",
  "description": "A single still-life render assessing physically plausible materials and controlled, motivated lighting.",
  "criteria": [
    {
      "name": "Material Response",
      "description": "Whether surfaces behave like the substances they claim to be.",
      "share": 2,
      "levels": [
        { "description": "Surfaces read as untextured default grey, or a single glossy shader is applied to every object regardless of what it is." },
        { "description": "Materials are differentiated but generic: metal has no anisotropy or tint, wood grain does not follow the form, and the ceramic and plastic are indistinguishable at a glance." },
        { "description": "Each material is convincingly itself, with roughness and reflectance in a plausible range; a small number of surfaces betray the shortcut, such as tiling that repeats visibly or an edge with no wear at all." },
        { "description": "Every surface holds up under scrutiny, including at grazing angles: edge wear, subtle roughness variation, and correct reflectance sell the substance without drawing attention to the shading work itself." }
      ]
    },
    {
      "name": "Lighting & Motivation",
      "description": "Whether the light is controlled, readable, and traceable to a source in the scene.",
      "share": 1,
      "levels": [
        { "description": "A single default light or an unmodified HDRI leaves the subject flatly lit, with no discernible key or shadow direction." },
        { "description": "A key and fill are present but unmotivated — shadows point to sources that do not exist in the scene, or the shadow terminator is crushed to black with no bounce." },
        { "description": "Lighting is motivated and the form reads clearly; falloff and bounce are believable, though one area is left under-lit or a highlight clips where detail was intended." },
        { "description": "Light does compositional work: the eye is led to the subject, every source is traceable to something in or implied by the scene, and the value range is controlled from deepest shadow to specular highlight." }
      ]
    }
  ]
}
```

---

## Optional blocks

**Swap in one of your own rubrics as the example.** Better than the one above,
because the assistant will imitate your voice rather than a stranger's. Export
one from `/api/rubrics/<id>/export` (or the Export button in the library) and
paste it in place of the example JSON, keeping the sentence above it.

**Weighting.** If some criteria matter more, add to the rules:

> Set `share` to reflect relative importance rather than leaving every criterion
> at 1: [WHICH CRITERIA CARRY MORE WEIGHT, AND ROUGHLY HOW MUCH MORE].

**Foundation courses.** If "Professional / Mastery" is not something a good
student in this course actually reaches, add:

> Set `"bandEdges": [0.6, 0.8, 0.92]`.

That makes level 2 — good work with minor flaws — worth an A−. Leave it out and
the default `[0.55, 0.74, 0.88]` makes level 2 a B+, which is the honest ceiling
only when mastery is genuinely reachable.

**Revising an existing rubric.** Paste the exported JSON and ask for the change
directly, keeping the rules above:

> Here is an existing rubric. [WHAT TO CHANGE — e.g. "Rewrite the Lighting
> criterion for a graduate seminar" or "Split Composition into two criteria".]
> Return the whole corrected document, no commentary.

## When it does not validate

Slightly-wrong JSON is the normal case, not the exception. The paste panel
prints plain-language errors and a **Copy repair message** button — paste that
back to the assistant and paste the corrected reply in again. Nothing needs to
be fixed by hand.
