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

/**
 * Read a chosen file as text, honouring the byte order mark.
 *
 * Excel on both platforms will save a "CSV" as UTF-16 without saying so.
 * Decoded as UTF-8 that becomes mojibake with a NUL between every letter, so
 * no column name matches anything and the import reports a file with no
 * readable columns — which is true, and useless. Sniff the mark instead.
 *
 * TextDecoder's ignoreBOM defaults to false, so the UTF-8 case eats a UTF-8
 * mark here rather than leaving it glued to the first column name.
 */
export function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  return new TextDecoder("utf-8").decode(buffer);
}
