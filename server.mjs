/**
 * The app, served over HTTP and — when a certificate is present — HTTPS,
 * both on the same port.
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
 * and here that is the whole point.
 *
 * One Next instance, always. Several modules keep their state in module scope —
 * the ingest-progress registry, the review channel's listener sets — so a
 * second process would give a tab connected over HTTPS a different set of
 * listeners than a tab connected over HTTP, and sync between them would
 * silently stop.
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
 * ## Why both protocols share one port
 *
 * The obvious shape is HTTP on 3000 and HTTPS on 3443. It does not work here:
 * the department firewall in front of cs-1017245 permits exactly one port.
 * 3001, 3002, 3443, 8000, 8080, 8443 and 9000 were all bound successfully on
 * the host and all refused connection from off-box; only 3000 answers.
 *
 * So this multiplexes. A TLS connection opens with a handshake record, whose
 * first byte is 0x16, and no HTTP method starts with that byte — so peeking at
 * one byte says which protocol arrived, and the socket is handed to the
 * matching server with the byte pushed back. Both of these then work, on the
 * same bookmarkable port, with no firewall exception to wait on:
 *
 *     http://cs-1017245.cs.byu.edu:3000     (no frame cache)
 *     https://cs-1017245.cs.byu.edu:3000    (frame cache, WebCodecs)
 *
 * ## The fallback, which is the part that must not be clever
 *
 * Grading happens in front of a class, so nothing here may take the app down
 * to gain TLS:
 *
 *  - HTTP keeps serving the whole app. It is not a redirect to HTTPS. A device
 *    that will not accept the certificate — an unenrolled iPad, a visitor's
 *    laptop — keeps working exactly as it does today, just without the frame
 *    cache. Every existing bookmark stays valid, unchanged.
 *  - A missing, unreadable or malformed certificate is reported and then
 *    ignored, and the port goes back to being a plain HTTP listener with no
 *    multiplexer in front of it at all. A cert that expires over the break
 *    must not be the reason a Tuesday class has no critique.
 *
 * Deliberately absent: HSTS. Sending it would teach every browser that has
 * ever reached the HTTPS origin to refuse the HTTP one, which would convert
 * "the certificate is not trusted here" from an inconvenience into a machine
 * that cannot open grader at all until the header's max-age expires. The
 * fallback has to stay reachable to be a fallback.
 *
 * Session cookies stay non-Secure (see SECURE_COOKIES in lib/auth/session.ts)
 * for the same reason: a Secure cookie is not sent over HTTP, so setting it
 * would sign out every device using the fallback. Same host and port for both
 * schemes means one sign-in covers them either way.
 */

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const keyPath = resolve(process.env.TLS_KEY || "certs/server.key");
const certPath = resolve(process.env.TLS_CERT || "certs/server.crt");

/** First byte of a TLS record of type handshake. No HTTP verb begins with it. */
const TLS_HANDSHAKE = 0x16;

/** How long an opened connection may stay silent before we classify it. */
const PROTOCOL_TIMEOUT_MS = 30_000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/** An https server for the multiplexer to hand sockets to, or null with why. */
function tlsServer() {
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
  // fails here rather than on the first request — which is what we want, since
  // a first-request failure would present as the app being down.
  try {
    return createHttpsServer({ key, cert }, handle);
  } catch (err) {
    console.error("> Certificate is unusable — serving HTTP only.", err.message);
    return null;
  }
}

/**
 * Route one connection to the server that speaks its protocol.
 *
 * Pausing before unshift matters: `once("data")` has put the socket in flowing
 * mode, and without the pause the pushed-back byte can be re-emitted before
 * the receiving server has attached its own handlers, which loses the first
 * bytes of the request. Resume on the next tick, once it has.
 */
function multiplex(http, https) {
  return (socket) => {
    const giveUp = setTimeout(() => socket.destroy(), PROTOCOL_TIMEOUT_MS);
    giveUp.unref();
    socket.once("data", (first) => {
      clearTimeout(giveUp);
      socket.pause();
      socket.unshift(first);
      (first[0] === TLS_HANDSHAKE ? https : http).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
    // A client that connects and disappears is routine (health checks, port
    // scans, a browser opening speculative sockets); it must not be noise.
    socket.on("error", () => socket.destroy());
  };
}

function listen(server) {
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(port, hostname, res);
  });
}

await app.prepare();

const http = createHttpServer(handle);
const https = tlsServer();

/*
 * With no certificate there is nothing to disambiguate, so the HTTP server
 * takes the port directly. The multiplexer is not a permanent fixture the
 * fallback has to route through — it is only present when it has a job.
 */
const front = https ? createTcpServer(multiplex(http, https)) : http;
await listen(front);

console.log(
  https
    ? `> Ready on http://${hostname}:${port} and https://${hostname}:${port}  (WebCodecs enabled)`
    : `> Ready on http://${hostname}:${port}`,
);

/*
 * Next only installs signal handlers inside startServer(), which this file
 * does not use, so without this a SIGTERM would kill the process outright
 * mid-response. Close the socket, let `after()` work drain, and cap the wait:
 * an ffmpeg transcode kicked off by an upload can run for minutes, and a
 * deploy must not sit through one before the new build starts.
 */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const code = signal === "SIGINT" ? 130 : 143;
    const forceExit = setTimeout(() => process.exit(code), 10_000);
    forceExit.unref();
    Promise.allSettled([
      new Promise((res) => front.close(res)),
      app.close?.(),
    ]).then(() => process.exit(code));
  });
}
