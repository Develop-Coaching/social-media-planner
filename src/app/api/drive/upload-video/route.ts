import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, ensureFolder } from "@/lib/drive";
import { getDriveTokens, refreshAccessToken } from "@/lib/drive-tokens";

export const dynamic = "force-dynamic";

const MAX_VIDEO_SIZE = 900 * 1024 * 1024; // 900MB

/**
 * Creates a Google Drive resumable upload session.
 * Returns the upload URL so the client can upload directly to Google,
 * bypassing Vercel's serverless body size limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const drive = await getDriveClient(userId);

    const body = await request.json();
    const {
      fileName,
      mimeType,
      fileSize,
      companyName,
      folderName,
      targetFolderId: explicitFolderId,
    } = body as {
      fileName: string;
      mimeType: string;
      fileSize: number;
      companyName: string;
      folderName?: string;
      targetFolderId?: string;
    };

    // Capture the request origin so Google returns proper CORS headers
    const origin = request.headers.get("origin") || request.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";

    if (!fileName || !mimeType || !companyName) {
      return NextResponse.json(
        { error: "Missing fileName, mimeType, or companyName" },
        { status: 400 }
      );
    }

    if (!mimeType.startsWith("video/")) {
      return NextResponse.json({ error: "File must be a video" }, { status: 400 });
    }

    if (fileSize && fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB, max 500MB)` },
        { status: 400 }
      );
    }

    // Resolve target folder
    let folderId: string;
    if (explicitFolderId) {
      folderId = explicitFolderId;
    } else {
      const companyFolderId = await ensureFolder(drive, "root", companyName);
      folderId = folderName
        ? await ensureFolder(drive, companyFolderId, folderName)
        : companyFolderId;
    }

    // Get a fresh access token for the resumable upload session
    let tokens = await getDriveTokens(userId);
    if (!tokens) {
      throw new DriveAuthError("not_authenticated");
    }
    if (tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(userId);
      if (!refreshed) throw new DriveAuthError("not_authenticated");
      tokens = refreshed;
    }

    // Create resumable upload session with Google Drive
    // The origin param tells Google to return CORS headers for the upload URL
    const uploadParams = new URLSearchParams({
      uploadType: "resumable",
      supportsAllDrives: "true",
      fields: "id,name,webViewLink",
      ...(origin ? { origin } : {}),
    });
    const initRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?${uploadParams}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          ...(fileSize ? { "X-Upload-Content-Length": String(fileSize) } : {}),
          "X-Upload-Content-Type": mimeType,
        },
        body: JSON.stringify({
          name: fileName,
          parents: [folderId],
        }),
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error("Drive resumable init failed:", initRes.status, errText);
      return NextResponse.json(
        { error: `Google Drive error: ${initRes.status}` },
        { status: 502 }
      );
    }

    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Google Drive did not return an upload URL" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, uploadUrl, folderId });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: (e as AuthError & { status: number }).status });
    }
    console.error("Drive video upload init error:", e);
    const message = e instanceof Error ? e.message : "Failed to initiate upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
