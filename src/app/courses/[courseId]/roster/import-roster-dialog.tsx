"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Upload } from "lucide-react";
import { importRoster } from "@/actions/students";
import { decodeCsv } from "@/lib/csv";
import { toast } from "sonner";

export function ImportRosterDialog({ courseId }: { courseId: number }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /*
   * State, not a ref. This used to be a ref filled in by an async FileReader
   * while the Import button enabled itself the moment a name was set, so
   * clicking straight after choosing a file could send an empty string and be
   * told to select a file — with a file plainly selected. Holding the text in
   * state keeps the button honest about whether there is anything to send.
   */
  const [csvText, setCsvText] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setCsvText(null);

    file
      .arrayBuffer()
      .then((buffer) => setCsvText(decodeCsv(buffer)))
      .catch(() => {
        setFileName(null);
        toast.error("Could not read that file.");
      });
  }

  async function handleImport() {
    if (!csvText) return;

    setImporting(true);
    try {
      const result = await importRoster(courseId, csvText);
      if (!result.success) {
        // parseRoster's errors name the columns it found, so they are worth
        // showing in full rather than truncating to a toast one-liner.
        toast.error(result.error || "Import failed", { duration: 12000 });
        return;
      }

      const parts: string[] = [];
      if (result.imported) parts.push(`${result.imported} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.duplicates) parts.push(`${result.duplicates} duplicate`);

      if (!result.imported && !result.updated) {
        toast.error(`No students imported${parts.length ? ` (${parts.join(", ")})` : ""}.`);
        return;
      }

      toast.success(parts.join(", "));
      setOpen(false);
      setFileName(null);
      setCsvText(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred during import");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Upload className="mr-2 h-4 w-4" />
        Import Roster
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Student Roster</DialogTitle>
          <DialogDescription>
            Upload a CSV exported from Learning Suite, or any list with a name column.
            Column names and their order do not have to match — a full name, or a first
            and last name, is the only thing required. A Net ID or BYU email is used to
            recognise students you already have.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            {fileName ? (
              <p className="text-sm font-medium">{fileName}</p>
            ) : (
              <div>
                <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click to select a CSV file
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={!csvText || importing}>
              {importing ? "Importing..." : fileName && !csvText ? "Reading..." : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
