import { NextRequest, NextResponse } from "next/server";
import { getMemory, addToMemory, removeFromMemory } from "@/lib/memory";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import mammoth from "mammoth";

// File size limits in bytes
const MAX_SIZES = {
  text: 5 * 1024 * 1024,   // 5 MB
  pdf: 10 * 1024 * 1024,   // 10 MB
  image: 5 * 1024 * 1024,  // 5 MB
  word: 10 * 1024 * 1024,  // 10 MB
};

async function extractTextFromPDF(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_SIZES.pdf) {
    throw new Error(`PDF too large. Maximum: ${MAX_SIZES.pdf / (1024 * 1024)} MB`);
  }

  const anthropic = getAnthropicClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64Data,
      },
    },
    {
      type: "text",
      text: `Extract ALL text content from this PDF document. Preserve the structure as much as possible:
- Headings and subheadings
- Paragraphs
- Bullet points and numbered lists
- Tables (format as readable text)

Output only the extracted content, no commentary or summaries.`,
    },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content,
      },
    ],
  });

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (!text || text.trim().length === 0) {
    throw new Error("Could not extract text from PDF");
  }

  return text.trim();
}

async function extractTextFromWord(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_SIZES.word) {
    throw new Error(`Word document too large. Maximum: ${MAX_SIZES.word / (1024 * 1024)} MB`);
  }

  try {
    const result = await mammoth.extractRawText({ buffer });

    if (!result.value || result.value.trim().length === 0) {
      throw new Error("No text content found in Word document");
    }

    return result.value.trim();
  } catch (err) {
    console.error("Word parse error:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Word document: ${errorMsg}`);
  }
}

async function extractTextFromImage(
  base64Data: string,
  mimeType: string
): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_SIZES.image) {
    throw new Error(`Image too large. Maximum: ${MAX_SIZES.image / (1024 * 1024)} MB`);
  }

  const validMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const normalizedMime = mimeType.toLowerCase();
  if (!validMimeTypes.includes(normalizedMime)) {
    throw new Error(`Unsupported image type: ${mimeType}`);
  }

  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizedMime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64Data,
            },
          },
          {
            type: "text",
            text: `Extract ALL text content from this image. This includes:
- Any visible text, headings, paragraphs
- Text in diagrams, charts, or infographics
- Handwritten text if legible

Format the extracted text naturally, preserving structure where possible.

If there is no readable text in the image, describe the key visual elements that could be useful for content creation.

Output only the extracted/described content, no additional commentary.`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (!text || text.trim().length === 0) {
    throw new Error("Could not extract text from image");
  }

  return text.trim();
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const memory = await getMemory(userId, companyId);
    return NextResponse.json(memory);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load memory" },
      { status: 500 }
    );
  }
}

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

    if (body.fileData && body.fileType) {
      const { name, fileData, fileType, mimeType } = body as {
        name: string;
        fileData: string;
        fileType: "pdf" | "image" | "word";
        mimeType?: string;
      };

      if (!name || typeof name !== "string") {
        return NextResponse.json(
          { error: "name is required" },
          { status: 400 }
        );
      }

      if (!fileData || typeof fileData !== "string") {
        return NextResponse.json(
          { error: "fileData (base64) is required" },
          { status: 400 }
        );
      }

      let extractedText: string;
      let sourceType: string;

      try {
        if (fileType === "pdf") {
          extractedText = await extractTextFromPDF(fileData);
          sourceType = "PDF";
        } else if (fileType === "word") {
          extractedText = await extractTextFromWord(fileData);
          sourceType = "Word Document";
        } else if (fileType === "image") {
          if (!mimeType) {
            return NextResponse.json(
              { error: "mimeType is required for images" },
              { status: 400 }
            );
          }
          extractedText = await extractTextFromImage(fileData, mimeType);
          sourceType = "Image";
        } else {
          return NextResponse.json(
            { error: "Invalid fileType. Must be 'pdf', 'word', or 'image'" },
            { status: 400 }
          );
        }
      } catch (err) {
        console.error("Text extraction error:", err);
        return NextResponse.json(
          {
            error: err instanceof Error
              ? err.message
              : "Failed to extract text from file"
          },
          { status: 422 }
        );
      }

      const contentWithMetadata = `[Extracted from ${sourceType}]\n\n${extractedText}`;
      const file = await addToMemory(userId, companyId, name, contentWithMetadata);
      return NextResponse.json(file);

    } else {
      const { name, content } = body as { name?: string; content?: string };

      if (!name || typeof content !== "string") {
        return NextResponse.json(
          { error: "name and content (string) required" },
          { status: 400 }
        );
      }

      const file = await addToMemory(userId, companyId, name, content);
      return NextResponse.json(file);
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to save to memory" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const companyId = searchParams.get("companyId");

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const removed = await removeFromMemory(userId, companyId, id);

    if (!removed) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete from memory" },
      { status: 500 }
    );
  }
}
