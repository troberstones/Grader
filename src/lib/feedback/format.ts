/** SQLite `datetime('now')` values are UTC with no zone marker. */
export function parseSqlTime(value: string): Date {
  return new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}

/** "Sep 24" this year, "Sep 24, 2025" otherwise. */
export function shortDate(value: string): string {
  const d = parseSqlTime(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Sep 24, 2026, 3:12 PM" — for tooltips, where the exact moment matters. */
export function fullDateTime(value: string): string {
  return parseSqlTime(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
