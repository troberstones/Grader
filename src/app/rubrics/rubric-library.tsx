"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Grid3X3, Trash2, Copy, Download, Upload } from "lucide-react";
import { deleteRubric, duplicateRubric, importRubricFromJSON, createShareRubric } from "@/actions/rubrics";
import { toast } from "sonner";
import type { RubricJSON } from "@/types/rubric";
import type { AuthoredRubric } from "@/lib/rubric";

interface RubricItem {
  id: number;
  name: string;
  description: string | null;
  updatedAt: string;
}

export function RubricLibrary({ rubrics }: { rubrics: RubricItem[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // The share-model shape (src/lib/rubric/) has no `weight` on a
      // criterion — legacy RubricJSON always does, it's a required field.
      const isAuthored = parsed?.version === 1 && !("weight" in (parsed.criteria?.[0] ?? {}));
      if (isAuthored) {
        await createShareRubric(parsed as AuthoredRubric);
      } else {
        await importRubricFromJSON(parsed as RubricJSON);
      }
      toast.success(`Imported rubric: ${parsed.name}`);
    } catch {
      toast.error("Invalid rubric JSON file");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDuplicate(id: number, name: string) {
    await duplicateRubric(id);
    toast.success(`Duplicated: ${name}`);
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete rubric "${name}"? This cannot be undone.`)) return;
    await deleteRubric(id);
    toast.success("Rubric deleted");
  }

  async function handleExport(id: number, name: string) {
    const res = await fetch(`/api/rubrics/${id}/export`);
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
          <Upload className="mr-2 h-4 w-4" />
          {importing ? "Importing..." : "Import JSON"}
        </Button>
      </div>

      {rubrics.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Grid3X3 className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <p>No rubrics yet. Create one or import a JSON file.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rubrics.map((rubric) => (
            <Card key={rubric.id} className="group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/rubrics/${rubric.id}`} className="flex-1">
                    <CardTitle className="text-base hover:underline">{rubric.name}</CardTitle>
                  </Link>
                </div>
                {rubric.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{rubric.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  <LinkButton href={`/rubrics/${rubric.id}`} variant="outline" size="sm">
                    Edit
                  </LinkButton>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(rubric.id, rubric.name)}>
                    <Copy className="mr-1 h-3 w-3" />
                    Duplicate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleExport(rubric.id, rubric.name)}>
                    <Download className="mr-1 h-3 w-3" />
                    Export
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => handleDelete(rubric.id, rubric.name)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
