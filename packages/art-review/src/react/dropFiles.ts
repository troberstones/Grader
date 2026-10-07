import { isTypingTarget } from "./keymap";

/** Flattens a native drop, including whole folders, into a plain file list. */
export async function readDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  if (!items || items.length === 0 || typeof items[0]?.webkitGetAsEntry !== "function") {
    return Array.from(dt.files);
  }
  const entries = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files);

  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject)
      );
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      for (let batch = await readBatch(); batch.length > 0; batch = await readBatch()) {
        for (const child of batch) await walk(child);
      }
    }
  }
  await Promise.all(entries.map(walk));
  return files;
}

/**
 * The files a paste is carrying — a screenshot on the clipboard, an image
 * copied out of another app, or files copied in Finder — or none when the
 * paste is text meant for the field that has focus.
 *
 * Every browser hands a clipboard bitmap over as "image.png", which says
 * nothing in a playlist and collides with the next paste, so those are given
 * a name of their own.
 */
export function readPastedFiles(e: ClipboardEvent, now: Date = new Date()): File[] {
  const dt = e.clipboardData;
  if (!dt || dt.files.length === 0) return [];
  if (isTypingTarget(e.target) && dt.types.includes("text/plain")) return [];

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ` +
    `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;

  let unnamed = 0;
  return Array.from(dt.files).map((file) => {
    const generic = file.name.match(/^image(\.\w+)$/i);
    if (!generic) return file;
    unnamed += 1;
    const name = `Pasted ${stamp}${unnamed > 1 ? ` ${unnamed}` : ""}${generic[1].toLowerCase()}`;
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  });
}
