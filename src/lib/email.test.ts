import { afterEach, describe, expect, it } from "vitest";

import { mailTransportProblem, sendRichMail } from "./email";

const saved = { SMTP_HOST: process.env.SMTP_HOST, SENDMAIL_PATH: process.env.SENDMAIL_PATH };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("mail transport", () => {
  it("names the problem instead of spawning a sendmail that isn't there", async () => {
    delete process.env.SMTP_HOST;
    process.env.SENDMAIL_PATH = "/nonexistent/sendmail";
    expect(mailTransportProblem()).toMatch(/no \/nonexistent\/sendmail, and SMTP_HOST isn't set/);
    const sent = await sendRichMail({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" });
    expect(sent).toEqual({ ok: false, error: expect.stringMatching(/no way to send mail/) });
  });

  it("is satisfied by SMTP even with no sendmail binary", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SENDMAIL_PATH = "/nonexistent/sendmail";
    expect(mailTransportProblem()).toBeNull();
  });
});
