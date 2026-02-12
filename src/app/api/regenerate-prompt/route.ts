import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    // Credit check
    if (isCreditsEnabled()) {
      const balance = await getBalance(userId);
      if (balance.balanceCents <= 0) {
        return NextResponse.json({ error: "Insufficient credits. Please top up to continue generating." }, { status: 402 });
      }
    }

    const { contentType, contentText, theme } = (await request.json()) as {
      contentType: string;
      contentText: string;
      theme?: { title: string; description: string };
    };

    if (!contentType || !contentText) {
      return NextResponse.json({ error: "contentType and contentText required" }, { status: 400 });
    }

    const themeContext = theme ? `\nWeekly theme: "${theme.title}" — ${theme.description}` : "";

    const prompt = `You are an expert at writing image generation prompts. Given the following ${contentType} content, write a detailed, vivid image prompt that would create a compelling visual to accompany it. The prompt should describe the scene, style, composition, colors, and mood — suitable for an AI image generator.${themeContext}

Content:
${contentText}

Respond with ONLY the image prompt text, nothing else. No quotes, no labels, no markdown.`;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    if (isCreditsEnabled() && response.usage) {
      const cost = calculateCost("claude-sonnet-4", response.usage.input_tokens, response.usage.output_tokens);
      await logUsage(userId, "/api/regenerate-prompt", "claude-sonnet-4-20250514", response.usage.input_tokens, response.usage.output_tokens, cost);
      await deductCredits(userId, cost);
    }

    return NextResponse.json({ prompt: text.trim() });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to regenerate prompt" },
      { status: 500 }
    );
  }
}
