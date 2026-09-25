import type { FeedbackModel } from "./model";

/**
 * The feedback email, as HTML and a plain-text alternative.
 *
 * Email HTML is its own dialect: no stylesheets that survive Gmail, no flexbox
 * or grid, so this is nested tables with inline styles throughout. The rubric
 * keeps the grading grid's shape — one block per criterion, its four levels
 * side by side, the chosen one highlighted — so a student sees it the way the
 * professor marked it. Light background rather than the app's dark theme:
 * mail clients re-colour dark messages unpredictably, and a light one survives
 * all of them.
 *
 * Pure: images arrive as ready-made `src` values (`cid:` for a real send,
 * `data:` for the preview dialog), so the same markup serves both.
 */

export interface EmailFrame {
  src: string;
  label: string;
  width: number;
  height: number;
}

export interface FeedbackEmailInput {
  model: FeedbackModel;
  includeRubric: boolean;
  frames: EmailFrame[] | null;
  /** Annotations were requested but some couldn't be included. */
  frameNotes: string[];
  link: { url: string; expires: Date } | null;
  instructor: { name: string; email: string };
  /** Set in test mode: the student this would have gone to. */
  testRecipient: { name: string; email: string | null } | null;
}

const ACCENT = "#e8622f";
const ACCENT_TINT = "#fff1ea";
const INK = "#1c1b1a";
const MUTED = "#6b6866";
const RULE = "#e4e1de";
const PAGE = "#f3f1ef";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function paragraphs(s: string): string {
  return esc(s).replace(/\r?\n/g, "<br>");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Denver" });
}

export function feedbackSubject(model: FeedbackModel, testRecipient: FeedbackEmailInput["testRecipient"]): string {
  const base = `Feedback: ${model.assignment.name} (${model.course.code})`;
  return testRecipient ? `[TEST → ${testRecipient.name}] ${base}` : base;
}

export function renderFeedbackEmail(input: FeedbackEmailInput): { subject: string; html: string; text: string } {
  const { model, includeRubric, frames, frameNotes, link, instructor, testRecipient } = input;
  const subject = feedbackSubject(model, testRecipient);

  const blocks: string[] = [];

  if (testRecipient) {
    blocks.push(`
      <tr><td style="padding:12px 24px;background:#fff6d6;border-bottom:1px solid #f0dc94;font-size:13px;color:#6b5400;">
        <strong>Test send.</strong> This would have gone to ${esc(testRecipient.name)}
        ${testRecipient.email ? `&lt;${esc(testRecipient.email)}&gt;` : "(no email on file)"}.
        Students receive feedback directly once <code>FEEDBACK_EMAIL_STUDENTS=1</code> is set on the server.
      </td></tr>`);
  }

  // Header + grade
  blocks.push(`
    <tr><td style="padding:28px 24px 8px 24px;">
      <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(model.course.code)} · ${esc(model.course.name)}</div>
      <div style="font-size:22px;font-weight:700;color:${INK};margin-top:4px;">${esc(model.assignment.name)}</div>
      <div style="font-size:14px;color:${MUTED};margin-top:6px;">Feedback for ${esc(model.student.name)}</div>
    </td></tr>
    <tr><td style="padding:12px 24px 4px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:${ACCENT_TINT};border:2px solid ${ACCENT};border-radius:10px;padding:10px 18px;text-align:center;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">Grade</div>
          <div style="font-size:32px;font-weight:800;color:${INK};line-height:1.15;">${esc(model.letter ?? "—")}</div>
        </td>
      </tr></table>
      ${model.status === "missing" ? `<div style="font-size:13px;color:${MUTED};margin-top:8px;">No submission was received for this assignment.</div>` : ""}
    </td></tr>`);

  if (link) {
    blocks.push(`
      <tr><td style="padding:16px 24px 4px 24px;">
        <a href="${esc(link.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">View your feedback and annotations</a>
        <div style="font-size:12px;color:${MUTED};margin-top:8px;">This link is just for you — please don't share it. It works until ${formatDate(link.expires)}.</div>
      </td></tr>`);
  }

  if (includeRubric && model.criteria.length > 0) {
    blocks.push(sectionHeading("Rubric"));
    for (const c of model.criteria) blocks.push(criterionBlock(c));
  }

  if (includeRubric && model.feedback) {
    blocks.push(sectionHeading("Comments"));
    blocks.push(`
      <tr><td style="padding:0 24px 8px 24px;">
        <div style="background:${PAGE};border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.6;color:${INK};">${paragraphs(model.feedback)}</div>
      </td></tr>`);
  }

  if (frames) {
    blocks.push(sectionHeading("Annotated frames"));
    if (frames.length === 0) {
      blocks.push(`<tr><td style="padding:0 24px 8px 24px;font-size:14px;color:${MUTED};">There are no annotations on this submission.</td></tr>`);
    }
    for (const fr of frames) {
      const w = Math.min(592, fr.width);
      const h = Math.round((fr.height / fr.width) * w);
      blocks.push(`
        <tr><td style="padding:0 24px 18px 24px;">
          <img src="${esc(fr.src)}" width="${w}" height="${h}" alt="${esc(fr.label)}" style="display:block;width:100%;max-width:${w}px;height:auto;border-radius:6px;border:1px solid ${RULE};">
          <div style="font-size:12px;color:${MUTED};margin-top:6px;">${esc(fr.label)}</div>
        </td></tr>`);
    }
    for (const note of frameNotes) {
      blocks.push(`<tr><td style="padding:0 24px 8px 24px;font-size:12px;color:${MUTED};">${esc(note)}</td></tr>`);
    }
  }

  blocks.push(`
    <tr><td style="padding:20px 24px 26px 24px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED};line-height:1.6;">
      Sent by ${esc(instructor.name)} from Grader. Reply to this email to reach ${esc(instructor.name)} directly.
    </td></tr>`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};"><tr><td align="center" style="padding:20px 8px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
${blocks.join("\n")}
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text: renderText(input) };
}

function sectionHeading(title: string): string {
  return `<tr><td style="padding:22px 24px 10px 24px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(title)}</td></tr>`;
}

function criterionBlock(c: FeedbackModel["criteria"][number]): string {
  const cellWidth = `${Math.floor(100 / Math.max(1, c.levels.length))}%`;
  const cells = c.levels
    .map((level, i) => {
      const on = c.selected === i;
      return `<td valign="top" width="${cellWidth}" style="padding:3px;">
        <div style="border:${on ? `2px solid ${ACCENT}` : `1px solid ${RULE}`};background:${on ? ACCENT_TINT : "#ffffff"};border-radius:8px;padding:${on ? "7px" : "8px"};min-height:56px;">
          <div style="font-size:12px;font-weight:${on ? 700 : 600};color:${on ? INK : MUTED};">${on ? "✓ " : ""}${esc(level.label)}</div>
          <div style="font-size:11px;line-height:1.45;color:${on ? INK : MUTED};margin-top:3px;">${esc(level.description || "")}</div>
        </div>
      </td>`;
    })
    .join("");

  return `
    <tr><td style="padding:0 24px 14px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:10px;">
        <tr><td style="padding:10px 10px 4px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:14px;font-weight:600;color:${INK};">${esc(c.name)}</td>
            <td align="right" style="font-size:14px;font-weight:700;color:${INK};white-space:nowrap;">${c.letter ? esc(c.letter) : `<span style="color:${MUTED};font-weight:400;">Not scored</span>`}</td>
          </tr></table>
          ${c.description ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${esc(c.description)}</div>` : ""}
        </td></tr>
        <tr><td style="padding:4px 7px 7px 7px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${cells}</tr></table>
        </td></tr>
        ${c.comment ? `<tr><td style="padding:0 10px 10px 10px;font-size:13px;line-height:1.55;color:${INK};"><em>${paragraphs(c.comment)}</em></td></tr>` : ""}
      </table>
    </td></tr>`;
}

function renderText(input: FeedbackEmailInput): string {
  const { model, includeRubric, frames, frameNotes, link, instructor, testRecipient } = input;
  const lines: string[] = [];
  if (testRecipient) {
    lines.push(`[TEST SEND — would have gone to ${testRecipient.name} ${testRecipient.email ? `<${testRecipient.email}>` : "(no email on file)"}]`, "");
  }
  lines.push(`${model.course.code} · ${model.course.name}`, model.assignment.name, `Feedback for ${model.student.name}`, "");
  lines.push(`Grade: ${model.letter ?? "—"}`);
  if (model.status === "missing") lines.push("No submission was received for this assignment.");
  lines.push("");
  if (link) {
    lines.push(`View your feedback and annotations: ${link.url}`, `(Just for you — works until ${formatDate(link.expires)}.)`, "");
  }
  if (includeRubric && model.criteria.length > 0) {
    lines.push("RUBRIC");
    for (const c of model.criteria) {
      const level = c.selected != null ? c.levels[c.selected] : null;
      lines.push(`- ${c.name}: ${level ? `${level.label} (${c.letter ?? "—"})` : "Not scored"}`);
      if (level?.description) lines.push(`    ${level.description}`);
      if (c.comment) lines.push(`    Comment: ${c.comment}`);
    }
    lines.push("");
  }
  if (includeRubric && model.feedback) lines.push("COMMENTS", model.feedback, "");
  if (frames) {
    lines.push(frames.length ? `${frames.length} annotated frame${frames.length === 1 ? " is" : "s are"} included as images in the HTML version of this email.` : "There are no annotations on this submission.");
    for (const note of frameNotes) lines.push(note);
    lines.push("");
  }
  lines.push(`Sent by ${instructor.name} from Grader. Reply to this email to reach them directly.`);
  return lines.join("\n");
}
