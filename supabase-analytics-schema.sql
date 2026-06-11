-- Analytics schema for PostPilot
-- Run this in the Supabase SQL Editor (separate from supabase-schema.sql)

-- Post metrics synced from platform APIs by /api/analytics/sync.
-- Keyed by (platform, platform_post_id) so re-syncs upsert in place.
CREATE TABLE post_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,                -- instagram | facebook | linkedin
  platform_post_id TEXT NOT NULL,
  company_id TEXT,                       -- optional link to a company
  posted_at TIMESTAMPTZ,
  content_snippet TEXT NOT NULL DEFAULT '',
  content_type TEXT,                     -- image | video | carousel | text
  permalink TEXT,
  reach INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  video_views INTEGER NOT NULL DEFAULT 0,
  engagement_rate REAL NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_post_id)
);
ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_post_metrics_posted ON post_metrics(posted_at DESC);
CREATE INDEX idx_post_metrics_platform ON post_metrics(platform, posted_at DESC);
