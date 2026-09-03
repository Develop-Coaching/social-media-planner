import { sendSlackNotification } from "@/lib/slack";
import type { TickResult } from "./runtime-types";

export async function notifyPublisherTransitions(result: TickResult): Promise<void> {
  const reapedVerification = result.reaped.filter((item) => item.new_state === "verification_required").length;
  const reapedDeadLetter = result.reaped.filter((item) => item.new_state === "dead_letter").length;
  const verificationCount = result.verificationRequired.length + reapedVerification;
  const deadLetterCount = result.deadLetter.length + reapedDeadLetter;
  if (deadLetterCount === 0 && verificationCount === 0) return;
  const text = [
    ":rotating_light: *Publisher action required*",
    verificationCount ? `${verificationCount} delivery(s) require provider verification; automatic retry is blocked.` : "",
    deadLetterCount ? `${deadLetterCount} delivery(s) reached dead-letter.` : "",
  ].filter(Boolean).join("\n");
  const sent = await sendSlackNotification({ text });
  if (!sent.ok) console.error("publisher notification failed:", sent.error);
}

export async function notifyPublisherTransitionsSafely(
  result: TickResult,
  notify: (result: TickResult) => Promise<void> = notifyPublisherTransitions,
): Promise<boolean> {
  try {
    await notify(result);
    return true;
  } catch (error) {
    console.error("publisher notification threw after database outcome committed:", error);
    return false;
  }
}
