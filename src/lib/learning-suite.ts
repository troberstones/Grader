import Papa from "papaparse";
import type { LMSGradeExportRow } from "@/types/learning-suite";

/**
 * Roster CSV parsing.
 *
 * Every roster that reaches here was exported by something else — Learning
 * Suite's Export Class Roll, a department spreadsheet, a TA's hand-made list —
 * and they do not agree on what the columns are called, on whether the header
 * is the first line, or on whether a name is one column or two.
 *
 * This used to match six exact header strings ("Net ID", "Student Name", …)
 * and return null for any row it could not read. A file that spelled a column
 * "NetID" or "Last" therefore imported zero students and still reported
 * success, and one benign parse warning anywhere aborted the whole file. Two
 * real exports failed that way on 2026-09-08.
 *
 * So the rules here are: match headers by shape rather than by spelling, find
 * the header row rather than assuming it is first, keep going when a row is
 * unreadable, and when the file genuinely cannot be read say which columns
 * were actually found. A roster that half-imports in silence is worse than one
 * that refuses and tells you why.
 */

export interface RosterStudent {
  name: string;
  sortName: string;
  netId: string | null;
  lmsStudentId: string | null;
  email: string | null;
}

type RosterField = "fullName" | "lastName" | "firstName" | "netId" | "lmsStudentId" | "email";

export interface RosterParseResult {
  students: RosterStudent[];
  /** The header row as written in the file, for error messages. */
  headers: string[];
  /** Which header each field was read from, for the import summary. */
  columns: Partial<Record<RosterField, string>>;
  /** Rows that held something but could not be read as a student. */
  skipped: number;
  /** Rows dropped because an earlier row named the same student. */
  duplicates: number;
  /** Set when nothing could be read. `students` is empty when it is. */
  error?: string;
}

/**
 * Header aliases matched against the whole normalized header.
 *
 * Normalizing to lowercase letters and digits means "Net ID", "NetID",
 * "net_id" and "NET-ID" are one key, which is most of the variation seen in
 * practice. Order within a list is preference: the earlier alias wins if a
 * file somehow has both.
 */
const EXACT: Record<RosterField, string[]> = {
  lastName: ["lastname", "surname", "familyname", "last"],
  firstName: ["firstname", "givenname", "preferredfirstname", "first"],
  fullName: ["studentname", "fullname", "displayname", "preferredname", "name", "student"],
  netId: ["netid", "byunetid", "username", "userid", "login"],
  lmsStudentId: ["studentid", "byuid", "personid", "studentnumber", "idnumber", "id"],
  email: ["email", "emailaddress", "byuemail", "studentemail", "mail"],
};

/**
 * Aliases matched anywhere inside a normalized header, for decorated exports
 * like "Student Name (Last, First)" or "BYU Net ID *".
 *
 * Deliberately excludes the short and ambiguous keys — "id", "name", "last",
 * "first", "mail" — because as substrings they collide with each other and
 * with unrelated columns ("Middle Initial", "Last Login", "Name of Section").
 */
const LOOSE: Record<RosterField, string[]> = {
  lastName: ["lastname", "surname"],
  firstName: ["firstname", "givenname"],
  fullName: ["studentname", "fullname"],
  netId: ["netid"],
  lmsStudentId: ["studentid", "byuid"],
  email: ["email"],
};

const FIELDS = Object.keys(EXACT) as RosterField[];

/** Name suffixes that must not be mistaken for the surname when sorting. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "dds", "esq"]);

/** How far into the file to look for the header row before giving up. */
const HEADER_SEARCH_ROWS = 20;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Work out which column holds which field.
 *
 * Two passes, because exactness has to win: a file with both "Name" and
 * "Last Name" must read "Last Name" as the surname rather than letting a
 * substring match claim it first. A column is only ever assigned to one field.
 */
function mapHeaders(cells: string[]): Partial<Record<RosterField, number>> {
  const normalized = cells.map(normalizeHeader);
  const found: Partial<Record<RosterField, number>> = {};
  const taken = new Set<number>();

  for (const pass of [EXACT, LOOSE]) {
    for (const field of FIELDS) {
      if (found[field] !== undefined) continue;
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < normalized.length; i++) {
        if (taken.has(i) || !normalized[i]) continue;
        const rank = pass[field].findIndex((alias) =>
          pass === EXACT ? normalized[i] === alias : normalized[i].includes(alias),
        );
        if (rank >= 0 && rank < bestRank) {
          best = i;
          bestRank = rank;
        }
      }
      if (best >= 0) {
        found[field] = best;
        taken.add(best);
      }
    }
  }

  return found;
}

/** A row can only be the header if it names somewhere to get a name from. */
function isHeaderRow(cols: Partial<Record<RosterField, number>>): boolean {
  return cols.fullName !== undefined || cols.lastName !== undefined || cols.firstName !== undefined;
}

/**
 * Reduce a Net ID to the form stored in the database: lowercase, no domain.
 *
 * Exports vary between "jsmith", "JSmith", "jsmith@byu.edu" and "@jsmith";
 * they are all the same person, and the students table has a unique index on
 * net_id that would otherwise hold two of them.
 */
function cleanNetId(raw: string | undefined): string | null {
  if (!raw) return null;
  const netId = raw.trim().toLowerCase().replace(/^@+/, "").split("@")[0].replace(/\s+/g, "");
  return netId || null;
}

function cleanEmail(raw: string | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/**
 * Split a single name column into display and sort forms.
 *
 * "Last, First" is what Learning Suite writes; "First Last" is what people
 * type. Both have to end up sorting by surname, because the student sidebar
 * orders on sortName and a roster sorted by first name is unusable when you
 * are looking someone up.
 */
function splitFullName(full: string): { name: string; sortName: string } {
  const value = collapse(full);

  if (value.includes(",")) {
    const [last, ...rest] = value.split(",");
    const surname = collapse(last);
    const given = collapse(rest.join(","));
    if (surname && given) return { name: `${given} ${surname}`, sortName: `${surname}, ${given}` };
    return { name: surname || given, sortName: surname || given };
  }

  const parts = value.split(" ");
  if (parts.length < 2) return { name: value, sortName: value };

  // "Robert Downey Jr." sorts under Downey, not under Jr.
  let end = parts.length - 1;
  if (parts.length >= 3 && SUFFIXES.has(normalizeHeader(parts[end]))) end -= 1;

  const surname = parts.slice(end).join(" ");
  const given = parts.slice(0, end).join(" ");
  return { name: value, sortName: given ? `${surname}, ${given}` : surname };
}

function toStudent(
  cells: string[],
  cols: Partial<Record<RosterField, number>>,
): RosterStudent | null {
  const at = (field: RosterField): string | undefined => {
    const i = cols[field];
    return i === undefined ? undefined : cells[i]?.trim() || undefined;
  };

  const lmsStudentId = at("lmsStudentId") ?? null;
  const email = cleanEmail(at("email"));
  let netId = cleanNetId(at("netId"));

  /*
   * A BYU address is the Net ID plus a domain, so an export with an Email
   * column but no Net ID column still identifies everyone. That matters more
   * than it looks: net_id is what makes a re-import update a student instead
   * of duplicating them.
   */
  if (!netId && email && /@(.+\.)?byu\.edu$/.test(email)) netId = email.split("@")[0];

  const last = at("lastName");
  const first = at("firstName");

  let name: string;
  let sortName: string;

  if (last && first) {
    name = collapse(`${first} ${last}`);
    sortName = collapse(`${last}, ${first}`);
  } else if (last || first) {
    // Only one half of a split name — better than nothing, and it still sorts.
    ({ name, sortName } = splitFullName((last ?? first)!));
  } else {
    const full = at("fullName");
    if (full) {
      ({ name, sortName } = splitFullName(full));
    } else if (netId) {
      // Nameless row, but a real identifier: import them under the Net ID
      // rather than dropping a student on the floor. Visibly odd beats absent.
      name = netId;
      sortName = netId;
    } else {
      return null;
    }
  }

  if (!name) return null;
  return { name, sortName, netId, lmsStudentId, email };
}

/**
 * Parse a roster CSV into students.
 *
 * Never throws; a file it cannot read comes back with `error` set and an empty
 * `students`, so the caller has something to show the person who chose it.
 */
export function parseRoster(csvText: string): RosterParseResult {
  const empty = { students: [], headers: [], columns: {}, skipped: 0, duplicates: 0 };

  // papaparse strips a UTF-8 BOM itself, but a file decoded from UTF-16
  // upstream can still carry one through.
  const text = csvText.replace(/^﻿/, "");
  if (!text.trim()) return { ...empty, error: "That file is empty." };

  /*
   * header:false on purpose. papaparse's own header mode keys rows by the
   * first line, which is wrong whenever an export puts a course title or a
   * blank line above the real header, and it turns a row with the wrong number
   * of fields into an error rather than a row. Finding the header ourselves
   * costs one pass and handles both.
   *
   * "greedy" also discards lines that are nothing but delimiters, which is
   * what trailing spreadsheet rows look like.
   */
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy" });
  const rows = parsed.data.filter((row) => row.some((cell) => cell?.trim()));

  if (rows.length === 0) {
    const why = parsed.errors[0]?.message;
    return { ...empty, error: why ? `That file has no rows to read (${why}).` : "That file has no rows to read." };
  }

  let headerIndex = -1;
  let cols: Partial<Record<RosterField, number>> = {};
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const candidate = mapHeaders(rows[i]);
    if (isHeaderRow(candidate)) {
      headerIndex = i;
      cols = candidate;
      break;
    }
  }

  if (headerIndex < 0) {
    const seen = rows[0].map((cell) => cell.trim()).filter(Boolean).join(", ");
    return {
      ...empty,
      headers: rows[0],
      error:
        `No name column found. Looked for a "Student Name", or a "Last Name" and "First Name" pair. ` +
        (seen ? `The columns in this file are: ${seen}.` : "The first row of this file is empty."),
    };
  }

  const headers = rows[headerIndex];
  const columns: Partial<Record<RosterField, string>> = {};
  for (const field of FIELDS) {
    const i = cols[field];
    if (i !== undefined) columns[field] = headers[i]?.trim();
  }

  const students: RosterStudent[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    // Some exports repeat the header once per section.
    if (isHeaderRow(mapHeaders(row))) continue;

    const student = toStudent(row, cols);
    if (!student) {
      skipped++;
      continue;
    }

    const key = student.netId ?? `name:${student.sortName.toLowerCase()}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    students.push(student);
  }

  if (students.length === 0) {
    return {
      ...empty,
      headers,
      columns,
      skipped,
      error: `Found the columns (${headers.filter(Boolean).join(", ")}) but no student rows under them.`,
    };
  }

  return { students, headers, columns, skipped, duplicates };
}

/**
 * Format a grade export row for Learning Suite bulk import.
 */
export function formatGradeExportRow(
  netId: string,
  studentName: string,
  score: number,
  feedback?: string
): LMSGradeExportRow {
  return {
    "Net ID": netId,
    "Student Name": studentName,
    "Score": String(score),
    ...(feedback ? { "Feedback": feedback } : {}),
  };
}
