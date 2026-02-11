import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, ensureFolder, uploadFile } from "@/lib/drive";

export const dynamic = "force-dynamic";

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const drive = await getDriveClient(userId);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyName = formData.get("companyName") as string | null;
    const folderName = formData.get("folderName") as string | null;
    const explicitFolderId = formData.get("targetFolderId") as string | null;

    if (!file || !companyName) {
      return NextResponse.json({ error: "Missing file or companyName" }, { status: 400 });
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json({ error: "File must be a video" }, { status: 400 });
    }

    if (file.size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB, max 500MB)` },
        { status: 400 }
      );
    }

    // Use explicit folder ID if provided, otherwise auto-create structure
    let targetFolderId: string;
    if (explicitFolderId) {
      targetFolderId = explicitFolderId;
    } else {
      const companyFolderId = await ensureFolder(drive, "root", companyName);
      targetFolderId = folderName
        ? await ensureFolder(drive, companyFolderId, folderName)
        : companyFolderId;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(drive, targetFolderId, file.name, buffer, file.type);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      fileId: result.fileId,
      webViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.fileId}/view`,
      name: file.name,
    });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: (e as AuthError & { status: number }).status });
    }
    console.error("Drive video upload error:", e);
    const message = e instanceof Error ? e.message : "Failed to upload video";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
