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
