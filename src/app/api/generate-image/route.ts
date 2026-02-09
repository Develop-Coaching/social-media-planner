import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

const IMAGE_MODEL = "imagen-4.0-generate-001";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const body = await request.json();
    const { prompt, aspectRatio = "1:1" } = body as {
      prompt: string;
      aspectRatio?: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt (string) required" },
        { status: 400 }
      );
    }

    const response = await ai.models.generateImages({
      model: IMAGE_MODEL,
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio,
      },
    });

    const generatedImage = response.generatedImages?.[0];
    if (generatedImage?.image?.imageBytes) {
      return NextResponse.json({
        imageBase64: generatedImage.image.imageBytes,
        mimeType: "image/png",
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
