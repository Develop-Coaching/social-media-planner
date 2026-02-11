import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getDriveClient, DriveAuthError, ensureFolder } from "@/lib/drive";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const drive = await getDriveClient(userId);

    const { parentFolderId, name } = (await request.json()) as {
      parentFolderId?: string;
      name?: string;
    };

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }

    const parentId = parentFolderId || "root";
    const folderId = await ensureFolder(drive, parentId, name.trim());

    return NextResponse.json({ ok: true, folderId, name: name.trim() });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: (e as AuthError & { status: number }).status });
    }
    console.error("Drive create-folder error:", e);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
