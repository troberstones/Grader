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
import { toast } from "sonner";

export function ImportRosterDialog({ courseId }: { courseId: number }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvTextRef = useRef<string>("");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      csvTextRef.current = ev.target?.result as string;
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvTextRef.current) {
      toast.error("Please select a CSV file first.");
      return;
    }

    setImporting(true);
    try {
      const result = await importRoster(courseId, csvTextRef.current);
      if (result.success) {
        toast.success(`Imported ${result.imported} students${result.skipped ? ` (${result.skipped} skipped)` : ""}`);
        setOpen(false);
        setFileName(null);
        csvTextRef.current = "";
      } else {
        toast.error(result.error || "Import failed");
      }
    } catch {
      toast.error("An error occurred during import");
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
            Upload a CSV file exported from Learning Suite. The file should contain columns like
            &quot;Student Name&quot; or &quot;First Name&quot;/&quot;Last Name&quot;, and optionally &quot;Net ID&quot; and &quot;Email&quot;.
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
            <Button onClick={handleImport} disabled={!fileName || importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
