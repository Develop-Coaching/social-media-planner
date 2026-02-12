// Pricing configuration for AI model usage
// Costs are in cents

// Claude Sonnet 4: $3/M input, $15/M output
const CLAUDE_SONNET_INPUT_PER_M = 300;  // cents per 1M input tokens
const CLAUDE_SONNET_OUTPUT_PER_M = 1500; // cents per 1M output tokens

// Gemini image generation: flat rate estimate per image
const GEMINI_IMAGE_COST_CENTS = 4; // ~$0.04 per image

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  if (model.startsWith("claude-sonnet") || model.startsWith("claude-sonnet-4")) {
    const inputCost = (inputTokens / 1_000_000) * CLAUDE_SONNET_INPUT_PER_M;
    const outputCost = (outputTokens / 1_000_000) * CLAUDE_SONNET_OUTPUT_PER_M;
    return Math.ceil(inputCost + outputCost);
  }

  if (model.startsWith("gemini")) {
    return GEMINI_IMAGE_COST_CENTS;
  }

  // Fallback: rough estimate
  return Math.ceil(((inputTokens + outputTokens) / 1_000_000) * 500);
}

export function isCreditsEnabled(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY);
}

export const CREDIT_PACKAGES = [
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
  { label: "$100", cents: 10000 },
] as const;
