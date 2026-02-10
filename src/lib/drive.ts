import { google, drive_v3 } from "googleapis";

let driveClient: drive_v3.Drive | null = null;

export function isDriveConfigured(): boolean {
  return !!(
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  let credentials: { client_email: string; private_key: string };

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, "utf-8"));
  } else {
    throw new Error("Google Drive credentials not configured");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

export async function ensureFolder(
  parentId: string,
  name: string
): Promise<string> {
  const drive = getDriveClient();

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
  folderId: string,
  fileName: string,
  dataUrl: string
): Promise<{ ok: boolean; fileId?: string; webViewLink?: string; error?: string }> {
  try {
    const drive = getDriveClient();

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
  folderId: string,
  pageToken?: string
): Promise<{ ok: boolean; files?: DriveFileInfo[]; nextPageToken?: string; error?: string }> {
  try {
    const drive = getDriveClient();

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

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10MB

export async function downloadImage(
  fileId: string
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const drive = getDriveClient();

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

/** List subfolders within a parent folder */
export async function listFolders(
  parentId: string
): Promise<{ ok: boolean; folders?: { id: string; name: string }[]; error?: string }> {
  try {
    const drive = getDriveClient();

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
