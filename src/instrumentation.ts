/**
 * Next's server-startup hook. `register()` runs once when a new server
 * instance is created and must finish before it serves requests — including
 * under server.mjs's custom server, since `app.prepare()` there still calls
 * NextServer's prepareImpl(), which runs this the same way `next start`
 * would. See
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 * and .../01-app/02-guides/instrumentation.md.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { runPreflightChecks } = await import("./lib/preflight");
  runPreflightChecks();
}
