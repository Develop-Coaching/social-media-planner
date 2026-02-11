import { google, drive_v3 } from "googleapis";
import { getDriveTokens, refreshAccessToken } from "@/lib/drive-tokens";

/** Check if OAuth client ID is configured (server-side only) */
export function isDriveEnabled(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID;
}

/** Get a Drive client for a specific user using their OAuth tokens */
export async function getDriveClient(userId: string): Promise<drive_v3.Drive> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured");
  }

  let tokens = await getDriveTokens(userId);
  if (!tokens) {
    throw new DriveAuthError("not_authenticated");
  }

  // Auto-refresh if expired (with 5-minute buffer)
  if (tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(userId);
    if (!refreshed) {
      throw new DriveAuthError("not_authenticated");
    }
    tokens = refreshed;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  return google.drive({ version: "v3", auth: oauth2 });
}

export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveAuthError";
  }
}

export async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  // Check if folder already exists
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return folder.data.id!;
}

export async function uploadImage(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  dataUrl: string
): Promise<{ ok: boolean; fileId?: string; webViewLink?: string; error?: string }> {
  try {
    // Parse data URL: data:image/png;base64,<data>
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { ok: false, error: "Invalid data URL format" };
    }
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    const file = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: stream,
      },
      fields: "id, webViewLink",
    });

    return {
      ok: true,
      fileId: file.data.id!,
      webViewLink: file.data.webViewLink || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
}

export async function listImages(
  drive: drive_v3.Drive,
  folderId: string,
  pageToken?: string
): Promise<{ ok: boolean; files?: DriveFileInfo[]; nextPageToken?: string; error?: string }> {
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink, modifiedTime, size)",
      pageSize: 20,
      pageToken: pageToken || undefined,
      orderBy: "modifiedTime desc",
    });

    const files: DriveFileInfo[] = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      thumbnailLink: f.thumbnailLink || undefined,
      webViewLink: f.webViewLink || undefined,
      modifiedTime: f.modifiedTime || undefined,
      size: f.size || undefined,
    }));

    return {
      ok: true,
      files,
      nextPageToken: res.data.nextPageToken || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list files",
    };
  }
}

export async function listVideos(
  drive: drive_v3.Drive,
  folderId: string,
  pageToken?: string
): Promise<{ ok: boolean; files?: DriveFileInfo[]; nextPageToken?: string; error?: string }> {
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink, modifiedTime, size)",
      pageSize: 20,
      pageToken: pageToken || undefined,
      orderBy: "modifiedTime desc",
    });

    const files: DriveFileInfo[] = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      thumbnailLink: f.thumbnailLink || undefined,
      webViewLink: f.webViewLink || undefined,
      modifiedTime: f.modifiedTime || undefined,
      size: f.size || undefined,
    }));

    return {
      ok: true,
      files,
      nextPageToken: res.data.nextPageToken || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list files",
    };
  }
}

/** List files shared with the user, filtered by mimeType category */
export async function listSharedFiles(
  drive: drive_v3.Drive,
  mimeCategory: "image" | "video",
  pageToken?: string
): Promise<{ ok: boolean; files?: DriveFileInfo[]; nextPageToken?: string; error?: string }> {
  try {
    const res = await drive.files.list({
      q: `sharedWithMe = true and mimeType contains '${mimeCategory}/' and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, thumbnailLink, webViewLink, modifiedTime, size)",
      pageSize: 20,
      pageToken: pageToken || undefined,
      orderBy: "modifiedTime desc",
    });

    const files: DriveFileInfo[] = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      thumbnailLink: f.thumbnailLink || undefined,
      webViewLink: f.webViewLink || undefined,
      modifiedTime: f.modifiedTime || undefined,
      size: f.size || undefined,
    }));

    return {
      ok: true,
      files,
      nextPageToken: res.data.nextPageToken || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list files",
    };
  }
}

/** Upload a raw buffer (e.g. video file) to a Drive folder */
export async function uploadFile(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ ok: boolean; fileId?: string; webViewLink?: string; error?: string }> {
  try {
    const { Readable } = await import("stream");
    const stream = Readable.from(buffer);

    const file = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: stream,
      },
      fields: "id, webViewLink",
    });

    return {
      ok: true,
      fileId: file.data.id!,
      webViewLink: file.data.webViewLink || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10MB

export async function downloadImage(
  drive: drive_v3.Drive,
  fileId: string
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    // Check file size first
    const meta = await drive.files.get({
      fileId,
      fields: "size, mimeType",
    });
    const size = parseInt(meta.data.size || "0", 10);
    if (size > MAX_DOWNLOAD_SIZE) {
      return { ok: false, error: `File too large (${Math.round(size / 1024 / 1024)}MB, max 10MB)` };
    }

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);
    const base64 = buffer.toString("base64");
    const mimeType = meta.data.mimeType || "image/png";

    return {
      ok: true,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Download failed",
    };
  }
}

/** List folders shared with the user */
export async function listSharedFolders(
  drive: drive_v3.Drive,
  pageToken?: string
): Promise<{ ok: boolean; folders?: { id: string; name: string }[]; nextPageToken?: string; error?: string }> {
  try {
    const res = await drive.files.list({
      q: `sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 100,
      pageToken: pageToken || undefined,
      orderBy: "name",
    });

    const folders = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));

    return { ok: true, folders, nextPageToken: res.data.nextPageToken || undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list shared folders",
    };
  }
}

/** List subfolders within a parent folder */
export async function listFolders(
  drive: drive_v3.Drive,
  parentId: string
): Promise<{ ok: boolean; folders?: { id: string; name: string }[]; error?: string }> {
  try {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 100,
      orderBy: "name",
    });

    const folders = (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));

    return { ok: true, folders };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list folders",
    };
  }
}
