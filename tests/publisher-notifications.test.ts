import { describe, expect, it, vi } from "vitest";
import { notifyPublisherTransitionsSafely } from "@/lib/publisher/notifications";

describe("publisher notifications", () => {
  it("does not turn a committed database outcome into a failed tick when notification throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = await notifyPublisherTransitionsSafely({
      dispatchEnabled: true, claimed: 1, succeeded: ["delivery"], retryable: [], deadLetter: [],
      verificationRequired: [], reaped: [],
    }, async () => { throw new Error("Slack unavailable"); });
    expect(sent).toBe(false);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
