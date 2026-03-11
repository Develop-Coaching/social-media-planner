import { NextRequest, NextResponse } from "next/server";
import { getContextForAI } from "@/lib/memory";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { getAnthropicClient } from "@/lib/anthropic";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  reels: { title: string; script: string; caption: string }[];
  linkedinArticles: { title: string; caption: string; body: string; imagePrompt: string }[];
  carousels: { slides: { title: string; body: string }[]; caption: string; imagePrompt: string }[];
  quotesForX: { quote: string; imagePrompt: string }[];
  youtube: { title: string; script: string; thumbnailPrompt?: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { theme, counts, companyId, tone, language } = body as {
      theme: { id: string; title: string; description: string; referenceDoc?: string };
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

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);

    // Credit check
    if (isCreditsEnabled()) {
      const balance = await getBalance(userId);
      if (balance.balanceCents <= 0) {
        return NextResponse.json({ error: "Insufficient credits. Please top up to continue generating." }, { status: 402 });
      }
    }

    const context = await getContextForAI(effectiveUserId, companyId);

    const toneInstruction = tone?.prompt ? `\n\nTONE & STYLE: ${tone.prompt}` : "";
    const languageInstruction = language?.prompt ? `\n\nLANGUAGE: ${language.prompt}` : "";
    const referenceDocSection = theme.referenceDoc ? `\n\nREFERENCE DOCUMENT (use this as key context and inspiration for this theme — draw specific facts, examples, and talking points from it):\n${theme.referenceDoc}` : "";

    const prompt = `You are a social media content writer. Generate content that is DIRECTLY tied to and inspired by the weekly theme below. Every piece of content must clearly relate to and explore an aspect of this theme.${toneInstruction}${languageInstruction}

WEEKLY THEME: ${theme.title}
Theme Description: ${theme.description}${referenceDocSection}

IMPORTANT: All content must be specifically about this theme. Each post, article, reel, etc. should explore a different angle, tip, insight, or story related to "${theme.title}". Do not generate generic content - make it obvious how each piece connects to the theme.

User's saved context (use for tone, topics, and brand voice):
${context}

Generate exactly this many items (use these exact counts — do NOT skip any type that has a count above 0):
${[
  counts.posts > 0 ? `- Posts (Instagram/LinkedIn feed): ${counts.posts}. Each needs: title (short 3-8 word summary of the post), caption (engaging, with optional hashtags), imagePrompt (detailed description for an AI image generator).` : "",
  counts.reels > 0 ? `- Reels (talking-head video scripts): ${counts.reels}. Each needs: title (short 3-8 word summary describing what the reel is about), script (a direct-to-camera script for someone to speak, approximately 30 seconds when read aloud - NO scene directions, NO B-roll instructions, just the actual words to say, must address an aspect of the theme), caption (engaging social media caption with hashtags to post alongside the reel).` : "",
  counts.linkedinArticles > 0 ? `- LinkedIn articles: ${counts.linkedinArticles}. Each needs: title (article headline related to theme), caption (a short 1-2 sentence teaser/hook for the LinkedIn post that links to the article), body (full article, 400-800 words, exploring the theme in depth), imagePrompt for hero image.` : "",
  counts.carousels > 0 ? `- Carousels: ${counts.carousels}. Each needs: slides array (each slide: title, body - all slides should build on the theme), caption (an engaging social media caption that summarises the carousel content and includes a call-to-action — this is the post description that accompanies the carousel, with optional hashtags), one imagePrompt describing the carousel visual style.` : "",
  counts.quotesForX > 0 ? `- Quotes for X/Twitter: ${counts.quotesForX}. Each needs: quote (short, punchy insight related to the theme), imagePrompt (quote card style).` : "",
  counts.youtube > 0 ? `- YouTube: ${counts.youtube}. Each needs: title, script (full video script, 3-8 min, deep-diving into the theme), optional thumbnailPrompt.` : "",
].filter(Boolean).join("\n")}

Respond with a single JSON object with keys: posts, reels, linkedinArticles, carousels, quotesForX, youtube. Each value is an array of objects as described (use empty arrays [] for types not listed above). Output ONLY valid JSON, no markdown or extra text.`;

    const anthropic = getAnthropicClient();
    const useStreaming = request.nextUrl.searchParams.get("stream") !== "false";

    // Dynamically size max_tokens based on estimated output
    const tokenEstimate =
      counts.posts * 300 +
      counts.reels * 700 +
      counts.carousels * 800 +
      counts.quotesForX * 200 +
      counts.linkedinArticles * 1500 +
      counts.youtube * 3000;
    const maxTokens = Math.min(Math.max(Math.round(tokenEstimate * 2) + 2048, 8192), 65536);

    if (!useStreaming) {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      // Log usage and deduct credits
      if (isCreditsEnabled() && message.usage) {
        const cost = calculateCost("claude-sonnet-4", message.usage.input_tokens, message.usage.output_tokens);
        await logUsage(userId, "/api/generate-content", "claude-sonnet-4-20250514", message.usage.input_tokens, message.usage.output_tokens, cost);
        await deductCredits(userId, cost);
      }

      return new Response(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
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

          // Log usage after stream completes
          if (isCreditsEnabled()) {
            try {
              const finalMessage = await stream.finalMessage();
              if (finalMessage.usage) {
                const cost = calculateCost("claude-sonnet-4", finalMessage.usage.input_tokens, finalMessage.usage.output_tokens);
                await logUsage(userId, "/api/generate-content", "claude-sonnet-4-20250514", finalMessage.usage.input_tokens, finalMessage.usage.output_tokens, cost);
                await deductCredits(userId, cost);
              }
            } catch {
              // Usage logging failure shouldn't break the response
            }
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("generate-content error:", errMsg, e);
    // Pass through Anthropic API errors (model not found, rate limit, etc.)
    const status = (e as { status?: number })?.status || 500;
    return NextResponse.json(
      { error: errMsg || "Failed to generate content" },
      { status }
    );
  }
}
