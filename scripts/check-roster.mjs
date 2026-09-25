#!/usr/bin/env node
/**
 * Say what the roster importer makes of a CSV, without importing it.
 *
 * The point is to turn "the upload failed" into a specific answer: which row
 * was read as the header, which column became which field, how many students
 * came out, and what the first few look like. Run it on a file before
 * blaming the importer — and on any file that still will not import, since
 * its output is the thing worth pasting into a bug report.
 *
 *   npm run roster:check -- ~/Downloads/ExportClassRoll.csv
 *
 * It reads the same parser the app uses (src/lib/learning-suite.ts), so an
 * answer here is the answer the import dialog would give.
 */
import { readFile } from "node:fs/promises";
import { parseRoster } from "../src/lib/learning-suite.ts";
import { decodeCsv } from "../src/lib/csv.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/check-roster.mjs <file.csv>");
  process.exit(2);
}

const buffer = await readFile(path);
const bytes = new Uint8Array(buffer);
const encoding =
  bytes[0] === 0xff && bytes[1] === 0xfe
    ? "UTF-16LE (Excel)"
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? "UTF-16BE"
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? "UTF-8 with BOM"
        : "UTF-8";

const text = decodeCsv(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const result = parseRoster(text);

console.log(`file       ${path}`);
console.log(`bytes      ${buffer.byteLength}`);
console.log(`encoding   ${encoding}`);
console.log(`line ends  ${text.includes("\r\n") ? "CRLF" : "LF"}`);
console.log();

if (result.error) {
  console.log(`REFUSED    ${result.error}`);
  console.log();
  console.log("first three lines as read:");
  for (const line of text.split(/\r?\n/).slice(0, 3)) console.log(`  ${JSON.stringify(line)}`);
  process.exit(1);
}

console.log(`header     ${result.headers.filter(Boolean).join(" | ")}`);
console.log("columns    " + (Object.entries(result.columns).map(([f, h]) => `${f}=${JSON.stringify(h)}`).join("  ") || "(none)"));
console.log();
console.log(`students   ${result.students.length}`);
console.log(`skipped    ${result.skipped}`);
console.log(`duplicates ${result.duplicates}`);
console.log(`no net id  ${result.students.filter((s) => !s.netId).length}`);
console.log();

for (const s of result.students.slice(0, 5)) {
  console.log(`  ${s.sortName.padEnd(28)} ${(s.netId ?? "—").padEnd(12)} ${s.email ?? ""}`);
}
if (result.students.length > 5) console.log(`  … and ${result.students.length - 5} more`);
