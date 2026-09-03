import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260903061000_create_hermes_social_bridge.sql", import.meta.url),
  "utf8",
);

describe("Hermes migration safety contract", () => {
  it("hard-denies the protected production schedule without using it as a database fixture", () => {
    expect(migration).toContain("367259e6-69af-461d-8510-09bd7eb6aea7");
    expect(migration).toContain("protected schedule cannot be used by the Hermes bridge");
  });

  it("does not adopt terminal failures or cleared historical dispatch ambiguity", () => {
    expect(migration).toContain("d.state not in ('pending', 'retryable', 'succeeded')");
    expect(migration).toContain("a.dispatch_started_at is not null");
    expect(migration).toContain("legacy item has historical dispatch ambiguity");
  });

  it("only cancels retry-safe states and only restores bridge-cancelled states", () => {
    expect(migration).toMatch(/set state = 'cancelled'[\s\S]*state in \('pending', 'retryable'\)/);
    expect(migration).toMatch(/set state = 'pending'[\s\S]*state = 'cancelled'/);
    expect(migration).toContain("schedule has no cancellable deliveries");
    expect(migration).toContain("schedule has no restorable deliveries");
  });

  it("keeps bridge tables and RPCs service-role-only", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).toContain("to service_role");
    expect(migration).not.toMatch(/grant (?:select|insert|update|delete|execute)[^;]+ to (?:anon|authenticated)/i);
  });
});
