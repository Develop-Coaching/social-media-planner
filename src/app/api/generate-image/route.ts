import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGE_MODEL = "gemini-3-pro-image-preview";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not set" },
      { status: 500 }
    );
  }

  let userId: string;
  try {
    const auth = await requireAuth();
    userId = auth.userId;
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }

  // Credit check
  if (isCreditsEnabled()) {
    const balance = await getBalance(userId);
    if (balance.balanceCents <= 0) {
      return NextResponse.json({ error: "Insufficient credits. Please top up to continue generating." }, { status: 402 });
    }
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const body = await request.json();
    const { prompt, aspectRatio = "1:1", referenceImage, characterReferenceImages } = body as {
      prompt: string;
      aspectRatio?: string;
      referenceImage?: string; // base64 data (no data URL prefix)
      characterReferenceImages?: { base64: string; mimeType: string }[];
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt (string) required" },
        { status: 400 }
      );
    }

    // Build contents: text-only or multimodal (reference images + text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contents: any = prompt;

    const hasCharImages = characterReferenceImages && characterReferenceImages.length > 0;

    if (referenceImage || hasCharImages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = [];

      // Add character reference images first
      if (hasCharImages) {
        for (const img of characterReferenceImages) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        }
      }

      // Add style reference image
      if (referenceImage) {
        parts.push({ inlineData: { mimeType: "image/png", data: referenceImage } });
      }

      // Build text instruction
      let textPrompt = "";
      if (hasCharImages) {
        textPrompt += "The reference images show the characters that should appear. Match their appearance closely. ";
      }
      if (referenceImage) {
        textPrompt += "Match the exact visual style, color palette, illustration style, layout, and typography of the style reference image. ";
      }
      textPrompt += prompt;

      parts.push({ text: textPrompt });
      contents = parts;
    }

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio,
        },
      },
    });

    // Find the image part in the response
    const parts = response.candidates?.[0]?.content?.parts;
    const imagePart = parts?.find((p) => p.inlineData);

    if (imagePart?.inlineData?.data) {
      // Log image generation usage
      if (isCreditsEnabled()) {
        const cost = calculateCost("gemini", 0, 0);
        await logUsage(userId, "/api/generate-image", "gemini-3-pro-image-preview", 0, 0, cost);
        await deductCredits(userId, cost);
      }

      return NextResponse.json({
        imageBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType || "image/png",
      });
    }

    return NextResponse.json(
      { error: "No image in response" },
      { status: 502 }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 500 }
    );
  }
}
