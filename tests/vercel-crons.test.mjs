import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production schedules only the replacement publisher cron", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const paths = config.crons.map((cron) => cron.path);

  assert.deepEqual(paths, [
    "/api/cron/publisher-tick",
    "/api/analytics/sync",
    "/api/cron/token-health",
  ]);
  assert.equal(paths.includes("/api/cron/publish-tick"), false);
});
