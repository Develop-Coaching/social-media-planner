import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, listImages, listFolders, ensureFolder } from "@/lib/drive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const drive = await getDriveClient(userId);

    const { searchParams } = new URL(request.url);
    const companyName = searchParams.get("companyName");
    const folder = searchParams.get("folder");
    const pageToken = searchParams.get("pageToken") || undefined;
    const mode = searchParams.get("mode"); // "folders" to list folders instead of images

    // Use "root" as the base — user's My Drive
    const rootFolderId = "root";

    if (mode === "folders") {
      // List subfolders of root or company folder
      if (companyName) {
        const companyFolderId = await ensureFolder(drive, rootFolderId, companyName);
        const result = await listFolders(drive, companyFolderId);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
        return NextResponse.json({ folders: result.folders });
      }
      const result = await listFolders(drive, rootFolderId);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ folders: result.folders });
    }

    // List images in the target folder
    let targetFolderId = rootFolderId;
    if (companyName) {
      targetFolderId = await ensureFolder(drive, rootFolderId, companyName);
      if (folder) {
        targetFolderId = await ensureFolder(drive, targetFolderId, folder);
      }
    }

    const result = await listImages(drive, targetFolderId, pageToken);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      files: result.files,
      nextPageToken: result.nextPageToken,
    });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
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
