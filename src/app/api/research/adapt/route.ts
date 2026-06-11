import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { getAnthropicClient } from "@/lib/anthropic";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";
import { getBrainPromptSection } from "@/lib/brain-connector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-20250514";

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { companyId, niche, item } = body as {
      companyId?: string;
      niche?: string;
      item?: {
        type: string;
        title: string;
        summary: string;
        whyItWorks?: string;
        formatBreakdown?: { hook: string; structure: string; cta: string };
        exampleHook?: string;
      };
    };

    if (!companyId || !niche?.trim() || !item) {
      return NextResponse.json(
        { error: "companyId, niche and item are required" },
        { status: 400 }
      );
    }
    await resolveCompanyAccess(userId, role, companyId);

    if (isCreditsEnabled()) {
      const balance = await getBalance(userId);
      if (balance.balanceCents <= 0) {
        return NextResponse.json(
          { error: "Insufficient credits. Please top up to continue." },
          { status: 402 }
        );
      }
    }

    // Develop Coaching only: ground the adapted draft in Greg's content RAG (fails open)
    const brainSection = await getBrainPromptSection(
      companyId,
      `${item.title}. ${item.summary}. ${niche}`
    );

    const prompt = `You are a social media content writer. Take the trending topic/format below and write a ready-to-post draft adapted to this niche.

NICHE: ${niche}

${item.type === "trend" ? "TRENDING TOPIC" : "POST FORMAT"}: ${item.title}
Summary: ${item.summary}
${item.whyItWorks ? `Why it works: ${item.whyItWorks}` : ""}
${item.formatBreakdown ? `Format breakdown — Hook: ${item.formatBreakdown.hook} | Structure: ${item.formatBreakdown.structure} | CTA: ${item.formatBreakdown.cta}` : ""}
${item.exampleHook ? `Example hook: ${item.exampleHook}` : ""}${brainSection}

Write the post following the format breakdown closely but making the content specific and credible for the niche. Aim for LinkedIn/Instagram length (120-250 words).

Respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "hook": "the opening line(s)",
  "body": "the main body of the post",
  "cta": "the closing call-to-action",
  "imageIdea": "one sentence describing an image that would pair well with this post"
}`;

    const anthropic = getAnthropicClient();
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    if (isCreditsEnabled() && message.usage) {
      const cost = calculateCost("claude-sonnet-4", message.usage.input_tokens, message.usage.output_tokens);
      await logUsage(userId, "/api/research/adapt", MODEL, message.usage.input_tokens, message.usage.output_tokens, cost);
      await deductCredits(userId, cost);
    }

    const text = message.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed: { hook?: string; body?: string; cta?: string; imageIdea?: string };
    try {
      parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {
      return NextResponse.json({ error: "Failed to parse the draft" }, { status: 502 });
    }
    if (!parsed.body) {
      return NextResponse.json({ error: "No draft returned" }, { status: 502 });
    }

    return NextResponse.json({ draft: parsed });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("research/adapt error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Adapt failed" },
      { status: 500 }
    );
  }
}
