import { describe, expect, it } from "vitest";
import { authConfiguration } from "../src/lib/auth";

describe("authConfiguration", () => {
  it("fails closed unless both credentials are present", () => {
    expect(authConfiguration({})).toEqual({
      configured: false,
      missing: ["ADMIN_PASSWORD", "AUTH_SECRET"],
    });
    expect(authConfiguration({ ADMIN_PASSWORD: "password" })).toEqual({
      configured: false,
      missing: ["AUTH_SECRET"],
    });
    expect(authConfiguration({ AUTH_SECRET: "secret" })).toEqual({
      configured: false,
      missing: ["ADMIN_PASSWORD"],
    });
  });

  it("accepts only non-blank credentials", () => {
    expect(authConfiguration({ ADMIN_PASSWORD: "  ", AUTH_SECRET: "secret" }).configured).toBe(false);
    expect(authConfiguration({ ADMIN_PASSWORD: "password", AUTH_SECRET: "secret" }).configured).toBe(true);
  });
});
