import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { MAX_FILE_SIZE } from "@/lib/constants";

import { POST } from "./route";

/**
 * A body whose stream throws the instant anything tries to read it. Used to
 * prove a code path never calls request.formData() (the only thing that
 * would read the body): if it did, this would surface as a 500 from the
 * route's catch block instead of the status the check under test returns.
 */
function unreadableBody(): ReadableStream {
  return new ReadableStream({
    pull() {
      throw new Error("body must not be read");
    },
  });
}

function postRequest(token: string, opts: { contentLength?: number } = {}) {
  const body = unreadableBody();
  const headers: Record<string, string> = { "content-type": "multipart/form-data; boundary=x" };
  if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);

  const request = new NextRequest(
    `http://localhost:3000/api/upload-links/${token}`,
    {
      method: "POST",
      headers,
      body,
      // Node's fetch Request requires this when the body is a stream.
      duplex: "half",
    } as unknown as ConstructorParameters<typeof NextRequest>[1],
  );

  return POST(request, { params: Promise.resolve({ token }) });
}

describe("POST /api/upload-links/[token]", () => {
  it("413s an oversized Content-Length before reading the body or checking the token", async () => {
    const res = await postRequest("does-not-matter", { contentLength: MAX_FILE_SIZE * 3 });
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toMatch(/too large/i);
  });

  it("rejects an invalid token without reading the body", async () => {
    const res = await postRequest("this-token-does-not-exist", { contentLength: 1024 });
    expect([404, 410]).toContain(res.status);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });
});
