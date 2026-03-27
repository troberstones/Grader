import Papa from "papaparse";

export function parseCSV<T>(csvText: string): { data: T[]; errors: Papa.ParseError[] } {
  const result = Papa.parse<T>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  return { data: result.data, errors: result.errors };
}

export function generateCSV<T extends Record<string, unknown>>(data: T[], columns?: string[]): string {
  return Papa.unparse(data, {
    columns,
  });
}
