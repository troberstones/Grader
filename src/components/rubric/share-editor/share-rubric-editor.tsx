"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_BAND_EDGES } from "@/lib/rubric";
import type { AuthoredRubric, BandEdges, NormalRubric } from "@/lib/rubric";
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
    await onSave(authored);
  }

  if (!started) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold">Start from a template</h3>
          <p className="text-xs text-muted-foreground">
            Picks a starting weight split across four common categories — fully editable afterward, including
            renaming or adding criteria. Or start blank, or paste a rubric from an AI assistant below.
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
          <PasteImportPanel onImport={handleImport} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calibration</CardTitle>
        </CardHeader>
        <CardContent>
          <BandCalibration bandEdges={bandEdges} onChange={setBandEdges} criteriaCount={Math.max(criteria.length, 1)} />
        </CardContent>
      </Card>

      <CriteriaGrid criteria={criteria} onChange={setCriteria} />

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
