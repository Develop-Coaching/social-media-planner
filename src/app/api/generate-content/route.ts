import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getContextForAI } from "@/lib/memory";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ContentCounts {
  posts: number;
  reels: number;
  linkedinArticles: number;
  carousels: number;
  quotesForX: number;
  youtube: number;
}

export interface GeneratedContent {
  posts: { caption: string; imagePrompt: string }[];
  reels: { script: string; imagePrompt?: string }[];
  linkedinArticles: { title: string; body: string; imagePrompt: string }[];
  carousels: { slides: { title: string; body: string }[]; imagePrompt: string }[];
  quotesForX: { quote: string; imagePrompt: string }[];
  youtube: { title: string; script: string; thumbnailPrompt?: string }[];
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { theme, counts, companyId } = body as {
      theme: { id: string; title: string; description: string };
      counts: ContentCounts;
      companyId?: string;
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

    const context = await getContextForAI(companyId);

    const prompt = `You are a social media content writer. Based on the user's saved context and the chosen weekly theme, generate content.

Theme: ${theme.title}
Description: ${theme.description}

User's saved context (use for tone, topics, and brand voice):
${context}

Generate exactly this many items (use these exact counts):
- Posts (Instagram/LinkedIn feed): ${counts.posts}. Each needs: caption (engaging, with optional hashtags), imagePrompt (detailed description for an AI image generator).
- Reels (talking-head video scripts): ${counts.reels}. Each needs: script (a direct-to-camera script for someone to speak, approximately 30 seconds when read aloud - NO scene directions, NO B-roll instructions, just the actual words to say), optional imagePrompt for thumbnail.
- LinkedIn articles: ${counts.linkedinArticles}. Each needs: title, body (full article, 400–800 words), imagePrompt for hero image.
- Carousels: ${counts.carousels}. Each needs: slides array (each slide: title, body), one imagePrompt describing the carousel visual style.
- Quotes for X/Twitter: ${counts.quotesForX}. Each needs: quote (short, punchy), imagePrompt (quote card style).
- YouTube: ${counts.youtube}. Each needs: title, script (full video script, 3–8 min), optional thumbnailPrompt.

Respond with a single JSON object with keys: posts, reels, linkedinArticles, carousels, quotesForX, youtube. Each value is an array of objects as described. Output ONLY valid JSON, no markdown or extra text.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") || "";

    let content: GeneratedContent;
    try {
      const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
      content = JSON.parse(cleaned) as GeneratedContent;
    } catch {
      return NextResponse.json(
        { error: "Failed to parse generated content" },
        { status: 500 }
      );
    }

    return NextResponse.json(content);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate content" },
      { status: 500 }
    );
  }
}
