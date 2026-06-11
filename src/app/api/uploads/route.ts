import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "content-images";
const MAX_BYTES = 200 * 1024 * 1024; // 200MB

// Receives an uploaded image/video, stores it in Supabase Storage, and returns
// the storage path. The path is signed into a temporary URL at publish time.
export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const form = await request.formData();
    const file = form.get("file");
    const companyId = form.get("companyId");

    if (!(file instanceof File) || typeof companyId !== "string") {
      return NextResponse.json({ error: "file and companyId are required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 200MB)" }, { status: 413 });
    }
    await resolveCompanyAccess(userId, role, companyId);

    const type = file.type || "application/octet-stream";
    const isVideo = type.startsWith("video");
    const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "png")).toLowerCase().replace(/[^a-z0-9]/g, "");
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `uploads/${companyId}/${Date.now()}-${rand}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: type,
      upsert: false,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ path, isVideo });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("uploads error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
