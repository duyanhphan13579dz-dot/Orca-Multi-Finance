import test from "node:test";
import assert from "node:assert/strict";

const setEnv = (k: string, v: string | undefined) => {
  if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
  else (process.env as Record<string, string | undefined>)[k] = v;
};

test("cronUnauthorized: production thiếu CRON_SECRET → 503", async () => {
  const { cronUnauthorized } = await import("../cron-auth");
  setEnv("NODE_ENV", "production");
  setEnv("CRON_SECRET", undefined);
  const res = cronUnauthorized(new Request("https://x.test/api/v1/cron/a"));
  assert.equal(res?.status, 503);
});

test("cronUnauthorized: sai secret → 401, đúng secret (Bearer hoặc ?secret=) → cho qua", async () => {
  const { cronUnauthorized } = await import("../cron-auth");
  setEnv("NODE_ENV", "production");
  setEnv("CRON_SECRET", "s3cret-value");
  assert.equal(cronUnauthorized(new Request("https://x.test/c?secret=bad"))?.status, 401);
  assert.equal(cronUnauthorized(new Request("https://x.test/c"))?.status, 401);
  assert.equal(cronUnauthorized(new Request("https://x.test/c", { headers: { authorization: "Bearer s3cret-value" } })), null);
  assert.equal(cronUnauthorized(new Request("https://x.test/c?secret=s3cret-value")), null);
});
