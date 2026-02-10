import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { supabase } from "@/lib/supabase";

const BUCKET = "content-images";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { fileName } = await request.json();

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }

    const path = `temp-uploads/${userId}/${crypto.randomUUID()}-${fileName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error) throw error;

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      storagePath: path,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Upload URL error:", e);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
