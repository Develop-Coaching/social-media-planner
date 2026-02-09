import { NextRequest, NextResponse } from "next/server";
import { getContextForAI } from "@/lib/memory";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAnthropicClient } from "@/lib/anthropic";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId } = body as { companyId?: string };

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const context = await getContextForAI(userId, companyId);

    const anthropic = getAnthropicClient();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a creative social media strategist. Based on the following saved context (files the user has added to memory), suggest 5 distinct content theme ideas. These are general themes (NOT tied to specific days like Monday/Tuesday) that can be used to create unlimited content throughout the week - posts, reels, LinkedIn articles, carousels, and quotes.

Each theme should be:
- Broad enough to generate many pieces of content
- Directly relevant to the user's brand/context
- Engaging and valuable to their audience

Context from the user's saved files:
${context}

Respond with a JSON array of exactly 5 theme objects. Each object must have:
- "id": a short kebab-case id (e.g. "overcoming-obstacles", "client-wins")
- "title": a catchy theme title (e.g. "Overcoming Obstacles", "Client Success Stories")
- "description": one sentence describing the theme and the types of content it could inspire

Output ONLY the JSON array, no other text. Example format:
[{"id":"theme-1","title":"Theme One","description":"..."}, ...]`,
        },
      ],
    });

    const text =
      message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") || "";

    let themes: { id: string; title: string; description: string }[];
    try {
      const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(cleaned);
      themes = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      themes = [];
    }

    return NextResponse.json({ themes });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate themes" },
      { status: 500 }
    );
  }
}
