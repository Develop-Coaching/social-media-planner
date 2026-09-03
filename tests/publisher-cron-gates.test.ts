import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { publisherCronAuthorized, publisherDispatchEnabled } from "@/lib/publisher/cron-gates";

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

describe("publisher cron gates", () => {
  it("fails authorization closed when CRON_SECRET is missing", () => {
    delete process.env.CRON_SECRET;
    expect(publisherCronAuthorized(new NextRequest("http://localhost/api/cron/publisher-tick"))).toBe(false);
  });

  it("requires an exact bearer secret", () => {
    process.env.CRON_SECRET = "cron-secret";
    expect(publisherCronAuthorized(new NextRequest("http://localhost/api/cron/publisher-tick", { headers: { authorization: "Bearer wrong" } }))).toBe(false);
    expect(publisherCronAuthorized(new NextRequest("http://localhost/api/cron/publisher-tick", { headers: { authorization: "Bearer cron-secret" } }))).toBe(true);
  });

  it("enables dispatch only for the exact value true", () => {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      if (value === undefined) delete process.env.PUBLISHER_DISPATCH_ENABLED;
      else process.env.PUBLISHER_DISPATCH_ENABLED = value;
      expect(publisherDispatchEnabled()).toBe(false);
    }
    process.env.PUBLISHER_DISPATCH_ENABLED = "true";
    expect(publisherDispatchEnabled()).toBe(true);
  });
});
