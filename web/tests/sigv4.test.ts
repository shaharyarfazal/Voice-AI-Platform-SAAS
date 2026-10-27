import assert from "node:assert/strict";
import { test } from "node:test";
import { presignUrl } from "../lib/sigv4.ts";

// The worked example from AWS's "Authenticating Requests: Using Query Parameters (SigV4)".
test("presigned URL matches AWS's published example", () => {
  const url = presignUrl({
    method: "GET",
    protocol: "https:",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expiresSeconds: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(new URL(url).searchParams.get("X-Amz-Signature"), "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  assert.ok(url.includes("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"));
});
