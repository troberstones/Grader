/**
 * Startup preflight — logs clear, non-fatal warnings for optional
 * configuration that's easy to forget on a fresh install or a re-imaged
 * host, so a missing piece shows up in `journalctl --user -u grader` at
 * boot instead of silently as "why didn't that email/video/upload work"
 * days later. Nothing here may throw: a warning must never stop the app
 * from serving the rest of the class.
 *
 * Invoked once per server instance from src/instrumentation.ts's
 * `register()`, which Next.js calls during `app.prepare()` — including
 * under the custom server in server.mjs, since that still goes through
 * NextServer's prepareImpl(). See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { mailTransportProblem } from "./email";

const CERT_EXPIRY_WARNING_DAYS = 30;

function warn(message: string): void {
  console.warn(`[preflight] ${message}`);
}

function checkAppBaseUrl(): void {
  if (!process.env.APP_BASE_URL) {
    warn(
      "APP_BASE_URL is not set — invite, password-reset, upload-link, and " +
        '"view online" feedback emails will all be skipped (the copy-link UI ' +
        "still works). See .env.example.",
    );
  }
}

function checkMailTransport(): void {
  const problem = mailTransportProblem();
  if (problem) warn(problem);
}

/** True if `bin` runs as a command (found on PATH or an absolute path that exists and executes). */
function binaryWorks(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkFfmpeg(): void {
  const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
  if (!binaryWorks(ffmpegBin)) {
    warn(
      `ffmpeg not found (looked for "${ffmpegBin}" — set FFMPEG_PATH if it's ` +
        "installed somewhere else) — feedback emails will be sent without " +
        "annotated video frames.",
    );
  }

  // Every distribution that ships ffmpeg ships ffprobe alongside it, so this
  // app has no separate FFPROBE_PATH — it's derived from FFMPEG_PATH when set.
  const ffprobeBin = process.env.FFMPEG_PATH ? path.join(path.dirname(process.env.FFMPEG_PATH), "ffprobe") : "ffprobe";
  if (!binaryWorks(ffprobeBin)) {
    warn(`ffprobe not found (looked for "${ffprobeBin}") — video ingest may fail to read clip metadata.`);
  }
}

function checkExtensionOrigins(): void {
  if (!process.env.ALLOWED_EXTENSION_ORIGINS) {
    warn(
      "ALLOWED_EXTENSION_ORIGINS is not set — the LS Bridge extension's " +
        "background service worker cannot post uploads if it's installed on " +
        "any device. See .env.example.",
    );
  }
}

function checkCertificates(): void {
  const keyPath = path.resolve(process.env.TLS_KEY || "certs/server.key");
  const certPath = path.resolve(process.env.TLS_CERT || "certs/server.crt");

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    warn(`No TLS certificate at ${certPath} — serving HTTP only (run scripts/make-cert.sh to generate one).`);
    return;
  }

  try {
    const cert = new X509Certificate(readFileSync(certPath));
    const daysLeft = Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
    if (daysLeft < 0) {
      warn(`TLS certificate at ${certPath} expired ${-daysLeft} day(s) ago — run scripts/make-cert.sh --force.`);
    } else if (daysLeft < CERT_EXPIRY_WARNING_DAYS) {
      warn(`TLS certificate at ${certPath} expires in ${daysLeft} day(s) — run scripts/make-cert.sh --force before then.`);
    }
  } catch (err) {
    warn(`Could not read TLS certificate at ${certPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Runs every startup check, logging a warning for each problem found. Never throws. */
export function runPreflightChecks(): void {
  for (const check of [checkAppBaseUrl, checkMailTransport, checkFfmpeg, checkExtensionOrigins, checkCertificates]) {
    try {
      check();
    } catch (err) {
      warn(`a startup check failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
