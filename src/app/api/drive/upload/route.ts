import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, uploadImage } from "@/lib/drive";
import { getImages } from "@/lib/images";

export const dynamic = "force-dynamic";

interface UploadBody {
  companyId: string;
  companyName: string;
  folderName?: string;
  targetFolderId?: string; // upload directly to a specific Drive folder
  imageKey?: string;      // single-image upload
  fileName?: string;      // single-image upload
  images?: { key: string; fileName: string }[]; // bulk upload (kept for import modal)
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();

    const drive = await getDriveClient(userId);

    const body = (await request.json()) as UploadBody;

    if (!body.companyId || !body.companyName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Build list of images to upload
    let imageList: { key: string; fileName: string }[];
    if (body.imageKey && body.fileName) {
      imageList = [{ key: body.imageKey, fileName: body.fileName }];
    } else if (Array.isArray(body.images) && body.images.length > 0) {
      imageList = body.images;
    } else {
      return NextResponse.json({ error: "No images to upload" }, { status: 400 });
    }

    // Read all images from server storage
    const storedImages = await getImages(userId, body.companyId);

    // Determine target folder: explicit ID, or auto-create Company/Theme structure
    const companyFolderId = body.targetFolderId || await (async () => {
      const { ensureFolder } = await import("@/lib/drive");
      const cid = await ensureFolder(drive, "root", body.companyName);
      return body.folderName ? await ensureFolder(drive, cid, body.folderName) : cid;
    })();

    console.log("[Drive upload] Target folder ID:", companyFolderId, "| from targetFolderId:", body.targetFolderId);

    let uploaded = 0;
    const errors: string[] = [];
    let lastFileLink: string | undefined;

    // Upload sequentially to avoid rate limits
    for (const img of imageList) {
      const dataUrl = storedImages[img.key];
      if (!dataUrl) {
        errors.push(`Image "${img.key}" not found`);
        continue;
      }

      const result = await uploadImage(drive, companyFolderId, img.fileName, dataUrl);
      console.log("[Drive upload] Result:", JSON.stringify({ ok: result.ok, fileId: result.fileId, webViewLink: result.webViewLink, error: result.error }));
      if (result.ok && result.fileId) {
        uploaded++;
        lastFileLink = `https://drive.google.com/file/d/${result.fileId}/view`;

        // Verify the file actually landed in the right folder
        try {
          const verify = await drive.files.get({
            fileId: result.fileId,
            fields: "id, name, parents",
            supportsAllDrives: true,
          });
          console.log("[Drive upload] File parents:", JSON.stringify(verify.data.parents), "| expected:", companyFolderId);
        } catch (verifyErr) {
          console.log("[Drive upload] Could not verify file location:", verifyErr);
        }
      } else {
        errors.push(`Failed to upload "${img.fileName}": ${result.error}`);
      }
    }

    const folderLink = `https://drive.google.com/drive/folders/${companyFolderId}`;

    return NextResponse.json({
      ok: true,
      uploaded,
      total: imageList.length,
      folderLink,
      fileLink: lastFileLink,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
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
