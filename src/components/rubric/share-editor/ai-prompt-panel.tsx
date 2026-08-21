"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { RUBRIC_TEMPLATES } from "./templates";
import { buildRubricPrompt, STUDENT_LEVELS, STUDENT_LEVEL_LABELS, type StudentLevel } from "./prompt";

/**
 * Step 1 of "generate with AI" (docs/rubric-authoring.md): collects what only
 * the professor knows and renders the copy-pasteable prompt. Step 2 is the
 * existing PasteImportPanel below it — same textarea, same Validate button,
 * this just feeds it from an assistant instead of a professor's own JSON.
 */
export function AiPromptPanel() {
  const [templateKey, setTemplateKey] = useState("general");
  const [course, setCourse] = useState("");
  const [assignmentName, setAssignmentName] = useState("");
  const [whatStudentsProduce, setWhatStudentsProduce] = useState("");
  const [studentLevel, setStudentLevel] = useState<StudentLevel>("sophomore");
  const [criteriaCount, setCriteriaCount] = useState(4);

  const template = RUBRIC_TEMPLATES.find((t) => t.key === templateKey);

  const prompt = useMemo(
    () => buildRubricPrompt({ templateKey, course, assignmentName, whatStudentsProduce, studentLevel, criteriaCount }),
    [templateKey, course, assignmentName, whatStudentsProduce, studentLevel, criteriaCount],
  );

  function copyPrompt() {
    navigator.clipboard.writeText(prompt);
    toast.success("Prompt copied — paste it into ChatGPT, Claude, or any assistant.");
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Fill in the assignment below, copy the generated prompt, and run it in any AI assistant. Paste
        the JSON it replies with into &quot;Paste a rubric&quot; underneath and press Validate.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-type">Rubric type</Label>
          <Select value={templateKey} onValueChange={(v) => setTemplateKey(v ?? "general")}>
            <SelectTrigger id="ai-type" className="w-full">
              <SelectValue placeholder="General / custom">
                {(v: string | null) => (v && v !== "general" ? (RUBRIC_TEMPLATES.find((t) => t.key === v)?.name ?? v) : "General / custom")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General / custom</SelectItem>
              {RUBRIC_TEMPLATES.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && <p className="text-[11px] text-muted-foreground/70">{template.purpose}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-level">Student level</Label>
          <Select value={studentLevel} onValueChange={(v) => setStudentLevel((v ?? "sophomore") as StudentLevel)}>
            <SelectTrigger id="ai-level" className="w-full">
              <SelectValue placeholder="Student level">{(v: string | null) => STUDENT_LEVEL_LABELS[(v ?? "sophomore") as StudentLevel]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STUDENT_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {STUDENT_LEVEL_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-course">Course</Label>
          <Input
            id="ai-course"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            placeholder="CSANM 354 — Advanced Shading"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-assignment">Assignment</Label>
          <Input
            id="ai-assignment"
            value={assignmentName}
            onChange={(e) => setAssignmentName(e.target.value)}
            placeholder="Project 2 — Material Studies"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-produce">What students produce</Label>
          <Textarea
            id="ai-produce"
            value={whatStudentsProduce}
            onChange={(e) => setWhatStudentsProduce(e.target.value)}
            placeholder="A fully shaded, lit hero asset turntable, 10-15 seconds"
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-count">Number of criteria</Label>
          <Input
            id="ai-count"
            type="number"
            min={2}
            max={12}
            value={criteriaCount}
            onChange={(e) => setCriteriaCount(Math.min(12, Math.max(2, Number(e.target.value) || 4)))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Prompt</Label>
          <Button type="button" variant="outline" size="sm" onClick={copyPrompt}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy prompt
          </Button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {prompt}
        </pre>
      </div>
    </div>
  );
}
