import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, downloadImage } from "@/lib/drive";
import { saveImage } from "@/lib/images";

export const dynamic = "force-dynamic";

interface DownloadBody {
  companyId: string;
  files: { driveFileId: string; targetKey: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const drive = await getDriveClient(userId);

    const body = (await request.json()) as DownloadBody;

    if (!body.companyId || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let imported = 0;
    const images: Record<string, string> = {};
    const errors: string[] = [];

    for (const file of body.files) {
      const result = await downloadImage(drive, file.driveFileId);
      if (result.ok && result.dataUrl) {
        await saveImage(userId, body.companyId, file.targetKey, result.dataUrl);
        images[file.targetKey] = result.dataUrl;
        imported++;
      } else {
        errors.push(`Failed to download "${file.driveFileId}": ${result.error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      images,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Drive download error:", e);
    return NextResponse.json(
      { error: "Failed to download from Google Drive" },
      { status: 500 }
    );
  }
}
