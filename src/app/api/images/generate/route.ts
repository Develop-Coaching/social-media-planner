import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getBalance, deductCredits, logUsage } from "@/lib/credits";
import { calculateCost, isCreditsEnabled } from "@/lib/pricing";
import { getImageSkill } from "@/lib/image-skills";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Generates ONE image per call. Carousels loop client-side, passing
// imageIndex/slideCount and the first slide's base64 as a style anchor.
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

  if (isCreditsEnabled()) {
    const balance = await getBalance(userId);
    if (balance.balanceCents <= 0) {
      return NextResponse.json(
        { error: "Insufficient credits. Please top up to continue generating." },
        { status: 402 }
      );
    }
  }

  try {
    const body = await request.json();
    const { skill: skillId, inputs, imageIndex, slideCount, firstImageBase64 } = body as {
      skill?: string;
      inputs?: Record<string, string | number>;
      imageIndex?: number;
      slideCount?: number;
      firstImageBase64?: string;
    };

    const skill = skillId ? getImageSkill(skillId) : undefined;
    if (!skill) {
      return NextResponse.json({ error: "Unknown skill" }, { status: 400 });
    }
    if (!inputs) {
      return NextResponse.json({ error: "inputs required" }, { status: 400 });
    }
    for (const spec of skill.inputs) {
      if (spec.required && !String(inputs[spec.id] ?? "").trim()) {
        return NextResponse.json({ error: `${spec.label} is required` }, { status: 400 });
      }
    }

    const prompt = skill.buildPrompt(inputs, {
      slideIndex: imageIndex ?? 0,
      slideCount: slideCount ?? (skill.multiImage ? Number(inputs.slides) || 1 : 1),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [{ text: prompt }];

    // Attach the skill's reference images (style anchors)
    for (const ref of skill.referenceImages) {
      const filePath = path.join(process.cwd(), "public", ref);
      const data = await fs.readFile(filePath);
      parts.push({
        inlineData: {
          mimeType: ref.endsWith(".png") ? "image/png" : "image/jpeg",
          data: data.toString("base64"),
        },
      });
    }

    // For carousels: anchor later slides to the first generated slide
    if (skill.chainFirstImage && firstImageBase64 && (imageIndex ?? 0) > 0) {
      parts.push({ inlineData: { mimeType: "image/png", data: firstImageBase64 } });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: skill.model,
      contents: parts,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      },
    });

    const responseParts = response.candidates?.[0]?.content?.parts;
    const imagePart = responseParts?.find((p) => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      console.error("images/generate: no image in response:", JSON.stringify(responseParts).slice(0, 500));
      return NextResponse.json({ error: "Image generation returned no image" }, { status: 502 });
    }

    if (isCreditsEnabled()) {
      const cost = calculateCost("gemini", 0, 0);
      await logUsage(userId, "/api/images/generate", skill.model, 0, 0, cost);
      await deductCredits(userId, cost);
    }

    return NextResponse.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png",
      postProcess: skill.postProcess,
    });
  } catch (e) {
    console.error("images/generate error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 500 }
    );
  }
}
