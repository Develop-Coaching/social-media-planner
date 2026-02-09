import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400 }
      );
    }

    const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid Google Docs URL. Expected a URL like https://docs.google.com/document/d/..." },
        { status: 400 }
      );
    }

    const docId = match[1];
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

    const res = await fetch(exportUrl);

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json(
          { error: "Document not found. Check the URL is correct." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Could not fetch document. Make sure it is set to 'Anyone with the link can view'." },
        { status: 403 }
      );
    }

    const text = await res.text();
    return NextResponse.json({ text });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch Google Doc" },
      { status: 500 }
    );
  }
}
