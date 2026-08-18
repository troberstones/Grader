"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { searchStudents } from "@/actions/archive";

export function ArchiveSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; name: string; netId: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The query the current results/error belong to — lets render logic tell a
  // fresh empty query apart from "searched and found nothing" without the
  // effect itself clearing state synchronously.
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;

    const timer = setTimeout(() => {
      searchStudents(q)
        .then((rows) => {
          setResults(rows);
          setError(null);
          setSearchedQuery(q);
        })
        .catch((err) => {
          setResults([]);
          setError(err instanceof Error ? err.message : "Could not search the archive.");
          setSearchedQuery(q);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const isCurrent = trimmed.length > 0 && searchedQuery === trimmed;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by student name or net ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isCurrent && results.length > 0 && (
        <div className="border rounded-lg divide-y divide-border overflow-hidden">
          {results.map((student) => (
            <Link
              key={student.id}
              href={`/archive/${student.id}`}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors"
            >
              <span className="font-medium">{student.name}</span>
              {student.netId && <span className="text-xs text-muted-foreground">{student.netId}</span>}
            </Link>
          ))}
        </div>
      )}

      {isCurrent && error && <p className="text-sm text-destructive py-6 text-center">{error}</p>}

      {isCurrent && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">No students match &quot;{trimmed}&quot;.</p>
      )}
    </div>
  );
}
