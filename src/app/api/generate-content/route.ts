import { NextRequest, NextResponse } from "next/server";
import { getContextForAI } from "@/lib/memory";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAnthropicClient } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export interface ContentCounts {
  posts: number;
  reels: number;
  linkedinArticles: number;
  carousels: number;
  quotesForX: number;
  youtube: number;
}

export interface GeneratedContent {
  posts: { title: string; caption: string; imagePrompt: string }[];
  reels: { script: string; caption: string }[];
  linkedinArticles: { title: string; caption: string; body: string; imagePrompt: string }[];
  carousels: { slides: { title: string; body: string }[]; caption: string; imagePrompt: string }[];
  quotesForX: { quote: string; imagePrompt: string }[];
  youtube: { title: string; script: string; thumbnailPrompt?: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { theme, counts, companyId, tone, language } = body as {
      theme: { id: string; title: string; description: string };
      counts: ContentCounts;
      companyId?: string;
      tone?: { id: string; label: string; prompt: string };
      language?: { id: string; prompt: string };
    };

    if (!theme || !counts) {
      return NextResponse.json(
        { error: "theme and counts required" },
        { status: 400 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const context = await getContextForAI(userId, companyId);

    const toneInstruction = tone?.prompt ? `\n\nTONE & STYLE: ${tone.prompt}` : "";
    const languageInstruction = language?.prompt ? `\n\nLANGUAGE: ${language.prompt}` : "";

    const prompt = `You are a social media content writer. Generate content that is DIRECTLY tied to and inspired by the weekly theme below. Every piece of content must clearly relate to and explore an aspect of this theme.${toneInstruction}${languageInstruction}

WEEKLY THEME: ${theme.title}
Theme Description: ${theme.description}

IMPORTANT: All content must be specifically about this theme. Each post, article, reel, etc. should explore a different angle, tip, insight, or story related to "${theme.title}". Do not generate generic content - make it obvious how each piece connects to the theme.

User's saved context (use for tone, topics, and brand voice):
${context}

Generate exactly this many items (use these exact counts):
- Posts (Instagram/LinkedIn feed): ${counts.posts}. Each needs: title (short 3-8 word summary of the post), caption (engaging, with optional hashtags), imagePrompt (detailed description for an AI image generator).
- Reels (talking-head video scripts): ${counts.reels}. Each needs: script (a direct-to-camera script for someone to speak, approximately 30 seconds when read aloud - NO scene directions, NO B-roll instructions, just the actual words to say, must address an aspect of the theme), caption (engaging social media caption with hashtags to post alongside the reel).
- LinkedIn articles: ${counts.linkedinArticles}. Each needs: title (article headline related to theme), caption (a short 1-2 sentence teaser/hook for the LinkedIn post that links to the article), body (full article, 400-800 words, exploring the theme in depth), imagePrompt for hero image.
- Carousels: ${counts.carousels}. Each needs: slides array (each slide: title, body - all slides should build on the theme), caption (an engaging social media caption that summarises the carousel content and includes a call-to-action — this is the post description that accompanies the carousel, with optional hashtags), one imagePrompt describing the carousel visual style.
- Quotes for X/Twitter: ${counts.quotesForX}. Each needs: quote (short, punchy insight related to the theme), imagePrompt (quote card style).
- YouTube: ${counts.youtube}. Each needs: title, script (full video script, 3-8 min, deep-diving into the theme), optional thumbnailPrompt.

Respond with a single JSON object with keys: posts, reels, linkedinArticles, carousels, quotesForX, youtube. Each value is an array of objects as described. Output ONLY valid JSON, no markdown or extra text.`;

    const anthropic = getAnthropicClient();

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
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
      { error: e instanceof Error ? e.message : "Failed to generate content" },
      { status: 500 }
    );
  }
}
