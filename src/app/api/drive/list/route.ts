import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isDriveConfigured, listImages, listFolders, ensureFolder } from "@/lib/drive";

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    if (!isDriveConfigured()) {
      return NextResponse.json({ error: "Google Drive is not configured" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const companyName = searchParams.get("companyName");
    const folder = searchParams.get("folder");
    const pageToken = searchParams.get("pageToken") || undefined;
    const mode = searchParams.get("mode"); // "folders" to list folders instead of images

    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;

    if (mode === "folders") {
      // List subfolders of root or company folder
      if (companyName) {
        const companyFolderId = await ensureFolder(rootFolderId, companyName);
        const result = await listFolders(companyFolderId);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
        return NextResponse.json({ folders: result.folders });
      }
      const result = await listFolders(rootFolderId);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ folders: result.folders });
    }

    // List images in the target folder
    let targetFolderId = rootFolderId;
    if (companyName) {
      targetFolderId = await ensureFolder(rootFolderId, companyName);
      if (folder) {
        targetFolderId = await ensureFolder(targetFolderId, folder);
      }
    }

    const result = await listImages(targetFolderId, pageToken);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      files: result.files,
      nextPageToken: result.nextPageToken,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Drive list error:", e);
    return NextResponse.json(
      { error: "Failed to list Drive files" },
      { status: 500 }
    );
  }
}
