/**
 * Where feedback email actually goes.
 *
 * Until FEEDBACK_EMAIL_STUDENTS=1 is set, every feedback email is redirected
 * to the instructor who sent it, with the intended student named in the
 * subject and a banner at the top. That is the safe default while the email
 * layout and the annotated frames are still being checked: nothing reaches a
 * student by accident, and the whole send flow can still be exercised end to
 * end against a real inbox.
 *
 * Test sends are recorded, but kept apart from real ones (feedback_sends
 * .test_mode), so switching this on later starts from a clean slate rather
 * than skipping every student who was "already sent" during testing.
 */
export function feedbackTestMode(): boolean {
  return process.env.FEEDBACK_EMAIL_STUDENTS !== "1";
}

/** Absolute base for links in email. Unset means no link can be offered. */
export function appBaseUrl(): string | null {
  return process.env.APP_BASE_URL || null;
}
