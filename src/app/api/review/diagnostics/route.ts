import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * Park a diagnostic dump from a client onto this machine's disk.
 *
 * The reason this exists: the device with the bug is an iPad. Over plain http
 * on a LAN address the clipboard API does not exist, and a downloaded file has
 * to be dug out of Files and retyped before anyone can read it. One tap that
 * lands the text next to the source is worth the twenty lines.
 *
 * Development only — it writes files, and nothing outside a dev loop should.
 */

const DIR = path.join(process.cwd(), "storage", "diagnostics");
const MAX_BYTES = 512 * 1024;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { name?: string; text?: string } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  // The client's name is a hint, never a path: strip it to a safe stem and
  // rebuild the filename here. A caller must not be able to choose where on
  // this disk its bytes land.
  const stem =
    (body?.name ?? "").replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+/, "").slice(0, 80) ||
    "diagnostic";
  const name = stem.endsWith(".txt") ? stem : `${stem}.txt`;

  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, name), text, "utf8");

  return NextResponse.json({ path: `storage/diagnostics/${name}` });
}
