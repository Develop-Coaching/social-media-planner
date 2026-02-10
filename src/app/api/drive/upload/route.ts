import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { isDriveConfigured, ensureFolder, uploadImage } from "@/lib/drive";
import { getImages } from "@/lib/images";

interface UploadBody {
  companyId: string;
  companyName: string;
  folderName?: string;
  images: { key: string; fileName: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    if (!isDriveConfigured()) {
      return NextResponse.json({ error: "Google Drive is not configured" }, { status: 400 });
    }

    const body = (await request.json()) as UploadBody;

    if (!body.companyId || !body.companyName || !Array.isArray(body.images) || body.images.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;

    // Create folder structure: RootFolder / CompanyName / [FolderName]
    const companyFolderId = await ensureFolder(rootFolderId, body.companyName);
    const targetFolderId = body.folderName
      ? await ensureFolder(companyFolderId, body.folderName)
      : companyFolderId;

    // Read all images from server storage
    const storedImages = await getImages(userId, body.companyId);

    let uploaded = 0;
    let folderLink = "";
    const errors: string[] = [];

    // Upload sequentially to avoid rate limits
    for (const img of body.images) {
      const dataUrl = storedImages[img.key];
      if (!dataUrl) {
        errors.push(`Image "${img.key}" not found`);
        continue;
      }

      const result = await uploadImage(targetFolderId, img.fileName, dataUrl);
      if (result.ok) {
        uploaded++;
        if (!folderLink && result.webViewLink) {
          // Extract folder link from file link
          folderLink = `https://drive.google.com/drive/folders/${targetFolderId}`;
        }
      } else {
        errors.push(`Failed to upload "${img.fileName}": ${result.error}`);
      }
    }

    if (!folderLink) {
      folderLink = `https://drive.google.com/drive/folders/${targetFolderId}`;
    }

    return NextResponse.json({
      ok: true,
      uploaded,
      total: body.images.length,
      folderLink,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("Drive upload error:", e);
    return NextResponse.json(
      { error: "Failed to upload to Google Drive" },
      { status: 500 }
    );
  }
}
