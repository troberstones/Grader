"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { removeEnrollment } from "@/actions/students";

interface Student {
  id: number;
  name: string;
  sortName: string;
  netId: string | null;
  email: string | null;
}

export function RosterTable({
  students,
  courseId,
}: {
  students: Student[];
  courseId: number;
}) {
  if (students.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No students enrolled. Import a roster CSV from Learning Suite.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Net ID</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow key={student.id}>
              <TableCell className="font-medium">{student.sortName}</TableCell>
              <TableCell>
                {student.netId ? (
                  <Badge variant="secondary">{student.netId}</Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {student.email || "-"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={async () => {
                    if (confirm(`Remove ${student.name} from this course?`)) {
                      await removeEnrollment(courseId, student.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
