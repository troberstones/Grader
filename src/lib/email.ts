import { existsSync } from "node:fs";
import nodemailer from "nodemailer";

/**
 * Mail goes out one of two ways, chosen by environment:
 *
 * - SMTP, when SMTP_HOST is set — an authenticated account on a real mail
 *   provider (Gmail, iCloud, Office 365) over the submission port. This is the
 *   one that works on the deploy host: it has no local MTA and no root to
 *   install one, but outbound 587/465 are open.
 * - Otherwise the host's own local transport (sendmail/postfix/exim), with no
 *   credentials at all — the original design, still right on a host that has
 *   one.
 *
 * Invite/reset mail is strictly additive: inviteUser()/resetPassword() still
 * return the copy-link URL regardless of what happens here, and that link is
 * the real mechanism. A send failure must never block issuing an invite or
 * reset.
 */

// Most providers reject a From: that isn't the account being logged in as,
// so under SMTP the account itself is the natural default.
const FROM_ADDRESS = process.env.MAIL_FROM || process.env.SMTP_USER || "grader@localhost";
// Unset means the deploy host isn't configured with a public URL yet — a
// relative `/invite/{token}` link would be meaningless in an email client
// (the existing copy-link UI resolves it against window.location instead),
// so sending is skipped entirely rather than emailing a broken link.
const APP_BASE_URL = process.env.APP_BASE_URL;
const SEND_TIMEOUT_MS = 5000;

/** Why no mail can be sent at all, in words for the professor — or null when a transport is configured. */
export function mailTransportProblem(): string | null {
  if (process.env.SMTP_HOST) return null;
  const path = process.env.SENDMAIL_PATH || "/usr/sbin/sendmail";
  if (existsSync(path)) return null;
  return `this server has no way to send mail yet (no ${path}, and SMTP_HOST isn't set) — see "Mail" in .env.example`;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (!transporter) {
    const host = process.env.SMTP_HOST;
    if (host) {
      const port = Number(process.env.SMTP_PORT || 587);
      transporter = nodemailer.createTransport({
        host,
        port,
        // 465 is TLS from the first byte; 587 starts plain and must upgrade.
        secure: port === 465,
        requireTLS: port !== 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      });
    } else {
      transporter = nodemailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: process.env.SENDMAIL_PATH || "/usr/sbin/sendmail",
      });
    }
  }
  return transporter;
}

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), SEND_TIMEOUT_MS))]);
}

/** Never throws — bounded by a timeout so a stuck local MTA can't hang the caller. */
async function sendMailBestEffort(to: string, subject: string, text: string): Promise<boolean> {
  try {
    return await withTimeout(
      getTransporter()
        .sendMail({ from: FROM_ADDRESS, to, subject, text })
        .then(() => true),
      false,
    );
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * `relativeUrl` is the `/invite/{token}` path inviteUser()/resetPassword()
 * already produce for the copy-link UI. The `From:` address is a fixed,
 * configured value — never templated with admin/invitee-supplied text — so
 * every header field stays free of user input.
 */
export async function sendInviteEmail(
  to: string,
  name: string,
  relativeUrl: string,
  isReset: boolean,
): Promise<boolean> {
  if (!APP_BASE_URL) return false;
  const url = new URL(relativeUrl, APP_BASE_URL).toString();
  const subject = isReset ? "Grader password reset" : "You've been invited to Grader";
  const text = isReset
    ? `Hi ${name},\n\nUse this link to set a new password for your Grader account:\n${url}\n\nThis link works once and expires in 7 days.\n`
    : `Hi ${name},\n\nYou've been invited to Grader. Use this link to set your password and sign in:\n${url}\n\nThis link works once and expires in 7 days.\n`;
  return sendMailBestEffort(to, subject, text);
}

/**
 * Same shape as sendInviteEmail(), for an upload-link URL instead of an
 * invite/reset one. `expiresAt` is shown as a plain date, not relative time,
 * since the email itself may be read long after it was sent.
 */
export async function sendUploadLinkEmail(
  to: string,
  studentName: string,
  assignmentName: string,
  relativeUrl: string,
  expiresAt: string,
): Promise<boolean> {
  if (!APP_BASE_URL) return false;
  const url = new URL(relativeUrl, APP_BASE_URL).toString();
  const expiry = new Date(expiresAt.replace(" ", "T") + "Z").toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subject = `Upload link for ${assignmentName}`;
  const text = `Hi ${studentName},\n\nUse this link to upload your submission for "${assignmentName}":\n${url}\n\nThis link expires on ${expiry}.\n`;
  return sendMailBestEffort(to, subject, text);
}

export interface InlineImage {
  /** Referenced from the HTML as `cid:{cid}`. */
  cid: string;
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface RichMail {
  to: string;
  replyTo?: { name: string; address: string };
  subject: string;
  html: string;
  text: string;
  images?: InlineImage[];
}

// A feedback email can carry several megabytes of frames, which a local MTA
// takes longer to accept than a two-line invite.
const RICH_SEND_TIMEOUT_MS = 60_000;

/**
 * HTML mail with inline images, for feedback. Unlike sendMailBestEffort this
 * reports *why* a send failed, because the caller records it where the
 * professor can see it. Still never throws.
 *
 * Images travel as `cid:` attachments rather than data: URIs — Gmail, which
 * is where BYU student mail lands, strips data: images from message bodies.
 */
export async function sendRichMail(mail: RichMail): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = mailTransportProblem();
  if (problem) return { ok: false, error: problem };
  try {
    const send = getTransporter()
      .sendMail({
        from: FROM_ADDRESS,
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        attachments: (mail.images ?? []).map((img) => ({
          cid: img.cid,
          filename: img.filename,
          content: img.content,
          contentType: img.contentType,
          contentDisposition: "inline" as const,
        })),
      })
      .then(() => ({ ok: true as const }));
    const timeout = new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "mail transport timed out" }), RICH_SEND_TIMEOUT_MS),
    );
    return await Promise.race([send, timeout]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] rich send failed:", message);
    return { ok: false, error: message };
  }
}
