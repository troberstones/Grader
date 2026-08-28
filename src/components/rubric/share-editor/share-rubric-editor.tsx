"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_BAND_EDGES, validateRubric } from "@/lib/rubric";
import type { AuthoredRubric, BandEdges, Issue, NormalRubric } from "@/lib/rubric";
import { AiPromptPanel } from "./ai-prompt-panel";
import { BandCalibration } from "./band-calibration";
import { CriteriaGrid } from "./criteria-grid";
import { PasteImportPanel } from "./paste-import-panel";
import { RUBRIC_TEMPLATES } from "./templates";
import type { DraftCriterion } from "./types";

interface Props {
  initialData?: NormalRubric | null;
  onSave: (rubric: AuthoredRubric) => Promise<void>;
  saving?: boolean;
}

function toDraftCriteria(criteria: NormalRubric["criteria"]): DraftCriterion[] {
  return criteria.map((c) => ({
    name: c.name,
    description: c.description ?? "",
    share: c.share,
    levels: c.levels.map((l) => l.description) as [string, string, string, string],
  }));
}

/**
 * The share-model editor: no points anywhere, just criteria with a relative
 * `share` and a rubric-wide band calibration — see src/lib/rubric/ and
 * docs/rubric-authoring.md. New rubrics start at a template picker or the
 * paste-and-validate panel; editing an existing one goes straight to the
 * grid.
 */
export function ShareRubricEditor({ initialData, onSave, saving }: Props) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [bandEdges, setBandEdges] = useState<BandEdges>(initialData?.bandEdges ?? DEFAULT_BAND_EDGES);
  const [criteria, setCriteria] = useState<DraftCriterion[]>(() =>
    initialData ? toDraftCriteria(initialData.criteria) : [],
  );
  const [started, setStarted] = useState(!!initialData);
  const [errors, setErrors] = useState<Issue[] | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);

  function startFromTemplate(templateKey: string) {
    const template = RUBRIC_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    setCriteria(
      template.criteria.map((c) => ({ name: c.name, description: "", share: c.share, levels: ["", "", "", ""] })),
    );
    setStarted(true);
  }

  function startBlank() {
    setCriteria([]);
    setStarted(true);
  }

  function handleImport(rubric: NormalRubric) {
    setName(rubric.name);
    setDescription(rubric.description ?? "");
    setBandEdges(rubric.bandEdges);
    setCriteria(toDraftCriteria(rubric.criteria));
    setStarted(true);
    setShowAiPanel(false);
  }

  async function handleSave() {
    const authored: AuthoredRubric = {
      version: 1,
      name,
      description: description || undefined,
      bandEdges,
      criteria: criteria.map((c) => ({
        name: c.name,
        description: c.description || undefined,
        share: c.share,
        levels: c.levels.map((desc) => ({ description: desc })),
      })),
    };
    // Same check the server runs — catching it here means an incomplete
    // rubric never leaves the browser, and the fix (which field, which
    // criterion) shows up right where the problem is instead of in a
    // wall-of-text toast after a round trip.
    const result = validateRubric(authored);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(null);
    await onSave(authored);
  }

  if (!started) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold">Start from a template</h3>
          <p className="text-xs text-muted-foreground">
            Picks a starting weight split across four common categories — fully editable afterward, including
            renaming or adding criteria. Or start blank, or generate one with AI below.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RUBRIC_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => startFromTemplate(t.key)}
              className="rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
            >
              <div className="text-sm font-semibold">{t.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t.purpose}</div>
              <div className="mt-1 text-[11px] text-muted-foreground/70">{t.classHint}</div>
              <div className="mt-2 text-xs tabular-nums text-muted-foreground">
                {t.criteria.map((c) => c.share).join(" / ")}
              </div>
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={startBlank}>
          Start blank
        </Button>

        <div className="border-t pt-4">
          <h3 className="mb-3 text-sm font-semibold">Generate with AI</h3>
          <AiPromptPanel />
          <div className="mt-4 border-t pt-4">
            <PasteImportPanel onImport={handleImport} />
          </div>
        </div>
      </div>
    );
  }

  const canSave = !!name && criteria.length >= 2 && !saving;

  return (
    <div className="space-y-6 pb-24">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="grid flex-1 gap-3 md:grid-cols-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rubric name (required)"
            className="font-semibold"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        <Button onClick={handleSave} disabled={!canSave} className="shrink-0">
          {saving ? "Saving..." : "Save Rubric"}
        </Button>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => setShowAiPanel((v) => !v)} className="self-start">
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        {showAiPanel ? "Hide Generate with AI" : "Generate with AI…"}
      </Button>

      {showAiPanel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate with AI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Pasting a rubric below replaces the name, description, and criteria on this page with what
              you paste — review it before saving.
            </p>
            <AiPromptPanel />
            <div className="border-t pt-4">
              <PasteImportPanel onImport={handleImport} />
            </div>
          </CardContent>
        </Card>
      )}

      {errors && errors.length > 0 && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">
            Can&apos;t save yet — {errors.length} {errors.length === 1 ? "problem" : "problems"} below:
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.where}:</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <BandCalibration bandEdges={bandEdges} onChange={setBandEdges} criteriaCount={Math.max(criteria.length, 1)} />
        </CardContent>
      </Card>

      <CriteriaGrid criteria={criteria} onChange={setCriteria} showErrors={!!errors} />

      {criteria.length < 2 && (
        <p className="text-xs text-muted-foreground">A rubric needs at least 2 criteria before it can be saved.</p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving..." : "Save Rubric"}
        </Button>
      </div>
    </div>
  );
}
