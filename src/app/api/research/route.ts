import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { getAnthropicClient } from "@/lib/anthropic";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // web search rounds take a while

const MODEL = "claude-sonnet-4-20250514";

export interface ResearchedItem {
  type: "trend" | "format";
  title: string;
  summary: string;
  whyItWorks: string;
  formatBreakdown: { hook: string; structure: string; cta: string };
  exampleHook: string;
  sources: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { companyId, niche, focus } = body as {
      companyId?: string;
      niche?: string;
      focus?: string;
    };

    if (!companyId || !niche?.trim()) {
      return NextResponse.json({ error: "companyId and niche are required" }, { status: 400 });
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

    const prompt = `You are a social media trend researcher. Use web search to research what is CURRENTLY trending and working in this niche:

NICHE: ${niche}${focus ? `\nSPECIFIC FOCUS: ${focus}` : ""}

Research two things using multiple web searches:
1. TRENDS: 4-6 currently trending topics, conversations, news angles, or pain points in or adjacent to this niche that a content creator could ride. Prefer recent (last few weeks/months) over evergreen.
2. FORMATS: 3-5 post formats / hook styles that are currently getting strong engagement on LinkedIn and Instagram for business audiences (e.g. specific hook patterns, story structures, carousel formats, contrarian takes).

After researching, respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "items": [
    {
      "type": "trend" | "format",
      "title": "short name",
      "summary": "2-3 sentence summary of the trend/format",
      "whyItWorks": "1-2 sentences on why it's getting traction right now",
      "formatBreakdown": {
        "hook": "the hook pattern to open with",
        "structure": "how the body is structured",
        "cta": "the call-to-action pattern"
      },
      "exampleHook": "one example opening line written for this niche",
      "sources": ["url1", "url2"]
    }
  ]
}`;

    const anthropic = getAnthropicClient();

    // Server-side web search tool — SDK 0.32.x types predate server tools,
    // so the tools array needs a cast; the API accepts it verbatim.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any = [
      { type: "web_search_20250305", name: "web_search", max_uses: 8 },
    ];

    let messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: prompt },
    ];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: any = null;

    // Server-side tool loops can pause (stop_reason "pause_turn") — resume up to 3 times
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        tools,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;
      if (response.stop_reason !== "pause_turn") break;
      messages = [
        { role: "user", content: prompt },
        { role: "assistant", content: response.content },
      ];
    }

    if (isCreditsEnabled()) {
      const cost = calculateCost("claude-sonnet-4", totalInputTokens, totalOutputTokens);
      await logUsage(userId, "/api/research", MODEL, totalInputTokens, totalOutputTokens, cost);
      await deductCredits(userId, cost);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (response?.content ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text)
      .join("");

    let parsed: { items?: ResearchedItem[] };
    try {
      parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {
      console.error("research: failed to parse response:", text.slice(0, 500));
      return NextResponse.json(
        { error: "Research completed but the results could not be parsed. Try again." },
        { status: 502 }
      );
    }

    if (!parsed.items?.length) {
      return NextResponse.json(
        { error: "No research results returned. Try a more specific niche." },
        { status: 502 }
      );
    }

    return NextResponse.json({ items: parsed.items });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("research error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Research failed" },
      { status: 500 }
    );
  }
}
