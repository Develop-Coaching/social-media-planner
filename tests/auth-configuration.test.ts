import { describe, expect, it } from "vitest";
import { authConfiguration } from "../src/lib/auth";

describe("authConfiguration", () => {
  it("fails closed unless both credentials are present", () => {
    expect(authConfiguration({})).toEqual({
      configured: false,
      missing: ["ADMIN_PASSWORD", "AUTH_SECRET"],
      invalid: [],
    });
    expect(authConfiguration({ ADMIN_PASSWORD: "password" })).toEqual({
      configured: false,
      missing: ["AUTH_SECRET"],
      invalid: ["ADMIN_PASSWORD"],
    });
    expect(authConfiguration({ AUTH_SECRET: "secret" })).toEqual({
      configured: false,
      missing: ["ADMIN_PASSWORD"],
      invalid: ["AUTH_SECRET"],
    });
  });

  it("rejects blank, default, low-diversity, and short credentials", () => {
    expect(authConfiguration({ ADMIN_PASSWORD: "  ", AUTH_SECRET: "secret" }).configured).toBe(false);
    expect(authConfiguration({ ADMIN_PASSWORD: "Password123!", AUTH_SECRET: "postpilot-default-secret-change-me" }).configured).toBe(false);
    expect(authConfiguration({ ADMIN_PASSWORD: "LongButOnlyLetters", AUTH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }).configured).toBe(false);
  });

  it("accepts a strong setup credential and 32-byte high-diversity secret", () => {
    expect(authConfiguration({
      ADMIN_PASSWORD: "Setup-Access-2026!Strong",
      AUTH_SECRET: "f8M!2qZ#7vL@9xR$4nT%6kP&3sW*5yC+",
    }).configured).toBe(true);
  });
});
