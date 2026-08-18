"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { removeCourseMember, updateCourseMemberRole, type CourseMemberRow } from "@/actions/course-members";
import { COURSE_ROLES, COURSE_ROLE_LABELS, isCourseRole } from "@/lib/auth/roles";

export function MembersTable({ members, courseId }: { members: CourseMemberRow[]; courseId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onRoleChange(userId: number, value: string | null) {
    if (!isCourseRole(value)) return;
    startTransition(async () => {
      try {
        await updateCourseMemberRole(courseId, userId, value);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change that member's role.");
      }
    });
  }

  function onRemove(userId: number, name: string) {
    if (!confirm(`Remove ${name} from this course?`)) return;
    startTransition(async () => {
      try {
        await removeCourseMember(courseId, userId);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove that member.");
      }
    });
  }

  if (members.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No members yet.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-40">Role</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.userId}>
              <TableCell className="font-medium">{member.name}</TableCell>
              <TableCell className="text-muted-foreground">{member.email}</TableCell>
              <TableCell>
                <Select
                  value={member.role}
                  onValueChange={(v) => onRoleChange(member.userId, v)}
                  disabled={pending}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue>{(v: string) => (isCourseRole(v) ? COURSE_ROLE_LABELS[v] : v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {COURSE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {COURSE_ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  disabled={pending}
                  onClick={() => onRemove(member.userId, member.name)}
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
