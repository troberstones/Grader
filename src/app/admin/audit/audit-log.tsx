"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAuditLog, type AuditLogRow } from "@/actions/audit";

const ACTION_LABELS: Record<string, string> = {
  "grade.save": "Grade saved",
  "grade.clear": "Grade cleared",
  "grade.mark_missing": "Grade marked missing",
  "user.role_change": "Role changed",
  "user.status_change": "Status changed",
  "user.force_sign_out": "Forced sign-out",
  "user.invite": "User invited",
  "user.password_reset_issued": "Password reset issued",
  "course.delete": "Course deleted",
  "rubric.delete": "Rubric deleted",
};

function describeTarget(row: AuditLogRow): string {
  if (!row.targetType) return "—";
  return row.targetId ? `${row.targetType} #${row.targetId}` : row.targetType;
}

function describeDetail(row: AuditLogRow): string {
  if (!row.detail) return "";
  try {
    const parsed = JSON.parse(row.detail) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  } catch {
    return row.detail;
  }
}

export function AuditLogView({ initialRows }: { initialRows: AuditLogRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();
  // No more pages once a page comes back short of the server's page size.
  const [exhausted, setExhausted] = useState(initialRows.length < 100);

  function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    startTransition(async () => {
      try {
        const more = await listAuditLog(last.id);
        setRows((prev) => [...prev, ...more]);
        if (more.length < 100) setExhausted(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load more.");
      }
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                  {row.createdAt.slice(0, 19)}
                </TableCell>
                <TableCell className="text-sm">{row.actorEmail}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ACTION_LABELS[row.action] ?? row.action}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{describeTarget(row)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={describeDetail(row)}>
                  {describeDetail(row)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  Nothing recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {!exhausted && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" disabled={pending} onClick={loadMore}>
              {pending ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
