import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import mammoth from "mammoth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: "File must be under 5MB" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let text = "";

    if (name.endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (name.endsWith(".doc")) {
      // .doc (legacy format) — try mammoth, it handles some .doc files
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } catch {
        return NextResponse.json(
          { error: "Could not read .doc file. Try saving it as .docx or .txt first." },
          { status: 400 }
        );
      }
    } else if (name.endsWith(".pdf")) {
      // Basic PDF text extraction — look for text streams
      const raw = buffer.toString("latin1");
      const textParts: string[] = [];
      // Extract text between BT and ET operators (basic but works for most text PDFs)
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        // Extract strings in parentheses (Tj/TJ operators)
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(block)) !== null) {
          textParts.push(strMatch[1]);
        }
      }
      text = textParts.join(" ").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
      if (!text) {
        return NextResponse.json(
          { error: "Could not extract text from this PDF. Try a .docx or .txt file instead." },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a .txt, .docx, or .pdf file." },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "The file appears to be empty or contains no readable text." },
        { status: 400 }
      );
    }

    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("extract-text error:", e);
    return NextResponse.json({ error: "Failed to extract text from file" }, { status: 500 });
  }
}
