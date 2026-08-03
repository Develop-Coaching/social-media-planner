export type Platform = "instagram" | "facebook" | "linkedin";

export type ScheduledPostStatus =
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface ScheduledPost {
  id: string;
  user_id: string;
  company_id: string;
  saved_content_id: string | null;
  item_id: string | null;
  content_type: string;
  caption: string;
  image_keys: string[];
  media_urls: string[];
  upload_paths: string[];
  video_url: string | null;
  platforms: Platform[];
  scheduled_at: string;
  status: ScheduledPostStatus;
  platform_post_ids: Record<string, string>;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

// Resolved media handed to a platform adapter (signed URLs ready to fetch).
export interface PublishPayload {
  caption: string;
  imageUrls: string[];
  videoUrl: string | null;
  isReel: boolean;
  // An IG reel container from a previous tick that is still processing.
  // When set, the IG adapter resumes polling it instead of creating a new one.
  igContainerId?: string;
}

export interface PublishResult {
  success: boolean;
  platform: Platform;
  externalId?: string;
  externalUrl?: string;
  error?: string;
  // IG reel container still processing when the poll window closed. The tick
  // stores it on the row so the next tick resumes the same container instead
  // of re-uploading; waiting is not a failed attempt.
  pendingContainerId?: string;
}
