import nodemailer from "nodemailer";

/**
 * Best-effort delivery through the deploy host's own local mail transport
 * (sendmail/postfix/exim) — no SMTP credentials, no third-party account.
 * This is strictly additive: inviteUser()/resetPassword() still return the
 * copy-link URL regardless of what happens here, and that link is the real
 * mechanism. A send failure must never block issuing an invite or reset.
 */

const FROM_ADDRESS = process.env.MAIL_FROM || "grader@localhost";
// Unset means the deploy host isn't configured with a public URL yet — a
// relative `/invite/{token}` link would be meaningless in an email client
// (the existing copy-link UI resolves it against window.location instead),
// so sending is skipped entirely rather than emailing a broken link.
const APP_BASE_URL = process.env.APP_BASE_URL;
const SEND_TIMEOUT_MS = 5000;

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      sendmail: true,
      newline: "unix",
      path: process.env.SENDMAIL_PATH || "/usr/sbin/sendmail",
    });
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
