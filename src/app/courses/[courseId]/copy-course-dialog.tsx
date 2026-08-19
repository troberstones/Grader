"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { CopyCourseForm } from "@/app/courses/copy-course-form";

export function CopyCourseDialog({
  sourceId,
  sourceName,
  sourceHasStartDate,
}: {
  sourceId: number;
  sourceName: string;
  sourceHasStartDate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Copy className="mr-2 h-4 w-4" />
        Copy Course
      </DialogTrigger>
      <DialogContent>
        <CopyCourseForm
          sourceId={sourceId}
          sourceName={sourceName}
          sourceHasStartDate={sourceHasStartDate}
          onCancel={() => setOpen(false)}
          onSuccess={(newCourse) => {
            setOpen(false);
            router.push(`/courses/${newCourse.id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
