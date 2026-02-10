import { NextRequest, NextResponse } from "next/server";
import { getContextForAI } from "@/lib/memory";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAnthropicClient } from "@/lib/anthropic";

type ContentType = "post" | "reel" | "linkedinArticle" | "carousel" | "quoteForX" | "youtube";

const typePrompts: Record<ContentType, string> = {
  post: `Generate 1 Instagram/LinkedIn feed post. Return a JSON object with: title (short 3-8 word summary), caption (engaging, with optional hashtags), imagePrompt (detailed description for an AI image generator).`,
  reel: `Generate 1 talking-head reel script. Return a JSON object with: script (a direct-to-camera script for someone to speak, approximately 30 seconds when read aloud - NO scene directions, NO B-roll instructions, just the actual words to say), caption (engaging social media caption with hashtags to post alongside the reel).`,
  linkedinArticle: `Generate 1 LinkedIn article. Return a JSON object with: title (article headline), caption (a short 1-2 sentence teaser/hook for the LinkedIn post), body (full article, 400-800 words), imagePrompt (hero image description).`,
  carousel: `Generate 1 carousel. Return a JSON object with: slides (array of objects, each with title and body - all slides should build on the theme), caption (an engaging social media caption that summarises the carousel content and includes a call-to-action — this is the post description that accompanies the carousel, with optional hashtags), imagePrompt (describing the carousel visual style).`,
  quoteForX: `Generate 1 quote for X/Twitter. Return a JSON object with: quote (short, punchy insight related to the theme), imagePrompt (quote card style description).`,
  youtube: `Generate 1 YouTube video. Return a JSON object with: title, script (full video script, 3-8 min, deep-diving into the theme), thumbnailPrompt (thumbnail description).`,
};

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, theme, contentType, currentItem, tone, language } = body as {
      companyId: string;
      theme: { title: string; description: string };
      contentType: ContentType;
      currentItem: unknown;
      tone?: { id: string; label: string; prompt: string };
      language?: { id: string; prompt: string };
    };

    if (!companyId || !theme || !contentType) {
      return NextResponse.json({ error: "companyId, theme, and contentType are required" }, { status: 400 });
    }

    if (!typePrompts[contentType]) {
      return NextResponse.json({ error: "Invalid contentType" }, { status: 400 });
    }

    const context = await getContextForAI(userId, companyId);

    const toneInstruction = tone?.prompt ? `\n\nTONE & STYLE: ${tone.prompt}` : "";
    const languageInstruction = language?.prompt ? `\n\nLANGUAGE: ${language.prompt}` : "";

    const prompt = `You are a social media content writer. Generate a SINGLE piece of content that is DIRECTLY tied to the weekly theme below.${toneInstruction}${languageInstruction}

WEEKLY THEME: ${theme.title}
Theme Description: ${theme.description}

The content must be specifically about this theme, exploring a different angle than what already exists.

User's saved context (use for tone, topics, and brand voice):
${context}

${currentItem ? `Here is the current version that needs to be regenerated with a FRESH take (do NOT repeat the same ideas, find a new angle):\n${JSON.stringify(currentItem)}\n` : ""}
${typePrompts[contentType]}

Output ONLY valid JSON, no markdown or extra text.`;

    const anthropic = getAnthropicClient();

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to regenerate content" },
      { status: 500 }
    );
  }
}
