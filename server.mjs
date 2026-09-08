/**
 * The app, served over HTTP and — when a certificate is present — HTTPS.
 *
 * ## Why this file exists at all
 *
 * `next start` cannot serve TLS: it throws "Using a self signed certificate is
 * only supported with `next dev`" for any certificate at all, self-signed or
 * not (next/dist/server/lib/start-server.js). Serving HTTPS from Node therefore
 * means driving Next programmatically, which is what this does.
 *
 * This is not the "eject to a custom server" that Next's guide warns about.
 * `import next from "next"` returns NextCustomServer, whose prepare() calls the
 * same getRequestHandlers() from lib/start-server that `next start` itself
 * calls — same router-server, same proxy.ts execution, same static handling,
 * same caching. The only thing that differs is who owns the listening socket,
 * and here that is the whole point: one Next instance, two sockets.
 *
 * One instance matters. Several modules keep their state in module scope — the
 * ingest-progress registry, the review channel's listener sets — so a second
 * process would give a tab connected over HTTPS a different set of listeners
 * than a tab connected over HTTP, and sync between them would silently stop.
 *
 * ## Why HTTPS is worth this
 *
 * WebCodecs (VideoDecoder) is gated on a secure context. Served over plain
 * HTTP, `isSecureContext` is false, `VideoDecoder` is undefined, and every
 * video silently takes the `<video>` fallback path — which means the frame
 * cache, the memory budget selector and frame-exact scrubbing have never once
 * run on the deployed site. They are not broken; they were never reachable.
 * A certificate turns them on with no change to the application code.
 *
 * ## The fallback, which is the part that must not be clever
 *
 * Grading happens in front of a class, so nothing here may take the app down
 * to gain TLS:
 *
 *  - HTTP keeps serving the whole app on PORT. It is not a redirect to HTTPS.
 *    A device that will not accept the certificate — an unenrolled iPad, a
 *    visitor's laptop — keeps working exactly as it does today, just without
 *    the frame cache. Every existing bookmark stays valid.
 *  - A missing, unreadable or malformed certificate is reported and then
 *    ignored. The server still comes up on HTTP. A cert that expires over the
 *    break must not be the reason a Tuesday class has no critique.
 *  - HTTPS failing to bind (port already taken, permission denied) is likewise
 *    logged and survived, rather than exiting into systemd's restart loop.
 *
 * Deliberately absent: HSTS. Sending it would teach every browser that has
 * ever reached the HTTPS origin to refuse the HTTP one, which would convert
 * "the certificate is not trusted here" from an inconvenience into a machine
 * that cannot open grader at all until the header's max-age expires. The
 * fallback has to stay reachable to be a fallback.
 *
 * Session cookies stay non-Secure (see SECURE_COOKIES in lib/auth/session.ts)
 * for the same reason: a Secure cookie is not sent over HTTP, so setting it
 * would sign out every device using the fallback. Cookies ignore port, so one
 * sign-in covers both origins.
 */

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const httpPort = Number(process.env.PORT ?? 3000);
const httpsPort = Number(process.env.HTTPS_PORT ?? 3443);
const keyPath = resolve(process.env.TLS_KEY || "certs/server.key");
const certPath = resolve(process.env.TLS_CERT || "certs/server.crt");

/** Read the key/cert pair, or explain why we are staying on HTTP. */
function loadCredentials() {
  let key;
  let cert;
  try {
    key = readFileSync(keyPath);
    cert = readFileSync(certPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(
        `> No certificate at ${certPath} — serving HTTP only.\n` +
          "> Run scripts/make-cert.sh to generate one, then restart.",
      );
    } else {
      console.error(`> Cannot read certificate (${err.code}) — serving HTTP only.`, err.message);
    }
    return null;
  }
  // createServer() parses the PEM eagerly, so a malformed or mismatched pair
  // throws here rather than on the first request — which is what we want, as
  // a first-request failure would look like the app being down.
  try {
    return createHttpsServer({ key, cert }, handle);
  } catch (err) {
    console.error("> Certificate is unusable — serving HTTP only.", err.message);
    return null;
  }
}

/**
 * Bind, resolving false instead of throwing when the listener is optional.
 * The HTTP listener is required: if it cannot bind, the app is not serving and
 * exiting is honest. The HTTPS one is a bonus and must never be fatal.
 */
function listen(server, port, { required }) {
  return new Promise((res, rej) => {
    const onError = (err) => {
      if (required) return rej(err);
      console.error(`> HTTPS could not bind :${port} (${err.code}) — HTTP only.`);
      res(false);
    };
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.removeListener("error", onError);
      res(true);
    });
  });
}

const app = next({ dev, hostname, port: httpPort });
const handle = app.getRequestHandler();

await app.prepare();

const servers = [];

const http = createHttpServer(handle);
await listen(http, httpPort, { required: true });
servers.push(http);
console.log(`> HTTP  ready on http://${hostname}:${httpPort}`);

const https = loadCredentials();
if (https && (await listen(https, httpsPort, { required: false }))) {
  servers.push(https);
  console.log(`> HTTPS ready on https://${hostname}:${httpsPort}  (WebCodecs enabled)`);
}

/*
 * Websocket upgrades are left to NextCustomServer's own lazy setup, which
 * attaches to whichever server sees the first request. Production has no
 * upgrades — the sync buses are SSE, which is ordinary HTTP — and dev is
 * `next dev`, not this file, so there is no HMR socket to strand. Attaching
 * one by hand here would double up with Next's and hand the same socket to
 * the upgrade handler twice.
 */

/*
 * Next only installs signal handlers inside startServer(), which this file
 * does not use, so without this a SIGTERM would kill the process outright
 * mid-response. Close the sockets, let `after()` work drain, and cap the wait:
 * an ffmpeg transcode kicked off by an upload can run for minutes, and a
 * deploy must not sit through one before the new build starts.
 */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), 10_000);
    forceExit.unref();
    Promise.allSettled([
      ...servers.map((s) => new Promise((res) => s.close(res))),
      app.close?.(),
    ]).then(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}
