-- Supabase schema for PostPilot
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Also create a Storage bucket called "content-images" (private) in the Storage section

-- 1. Users table (replaces data/users.json)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 2. Companies table (replaces data/{userId}/companies.json)
CREATE TABLE companies (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  logo TEXT,
  brand_colors TEXT[],
  character TEXT,
  slack_webhook_url TEXT,
  slack_editor_webhook_url TEXT,
  slack_bot_token TEXT,
  slack_channel_id TEXT,
  font_family TEXT,
  PRIMARY KEY (user_id, id)
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- 3. Memory files (replaces data/{userId}/memory-{companyId}.json)
CREATE TABLE memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE memory_files ENABLE ROW LEVEL SECURITY;

-- 4. Saved content (replaces data/{userId}/saved-content-{companyId}.json)
CREATE TABLE saved_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  theme JSONB NOT NULL,
  content JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active',
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE saved_content ENABLE ROW LEVEL SECURITY;

-- 5. Custom tones (replaces data/{userId}/custom-tones-{companyId}.json)
CREATE TABLE custom_tones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE custom_tones ENABLE ROW LEVEL SECURITY;

-- 6. Images metadata (replaces data/{userId}/images-{companyId}.json)
-- Actual image data lives in Supabase Storage bucket "content-images"
CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  key TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  saved_content_id UUID REFERENCES saved_content(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE,
  UNIQUE (user_id, company_id, saved_content_id, key)
);
ALTER TABLE images ENABLE ROW LEVEL SECURITY;

-- 7. Drive tokens (replaces data/{userId}/drive-tokens.json)
CREATE TABLE drive_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  email TEXT NOT NULL
);
ALTER TABLE drive_tokens ENABLE ROW LEVEL SECURITY;

-- 8. Characters (multiple characters per company, with optional reference images)
-- Character images stored in Storage bucket "content-images" at {userId}/{companyId}/characters/{characterId}.{ext}
CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_storage_path TEXT,
  image_mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

-- 9. Content presets (custom quick-preset templates per company)
CREATE TABLE content_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  label TEXT NOT NULL,
  counts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE content_presets ENABLE ROW LEVEL SECURITY;

-- Migration: Add project-scoped images and auto-deletion support
-- Run these ALTER statements if tables already exist:
--
-- ALTER TABLE saved_content ADD COLUMN completed_at TIMESTAMPTZ;
-- ALTER TABLE images ADD COLUMN saved_content_id UUID REFERENCES saved_content(id) ON DELETE CASCADE;
-- ALTER TABLE images DROP CONSTRAINT IF EXISTS images_user_id_company_id_key_key;
-- ALTER TABLE images ADD CONSTRAINT images_user_company_sc_key_unique
--   UNIQUE(user_id, company_id, saved_content_id, key);

-- 10. Invites table (magic link invitations)
CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by TEXT
);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- 11. Onboarding responses
CREATE TABLE onboarding_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  responses JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;

-- 12. User credits (balance in cents)
CREATE TABLE user_credits (
  user_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_topped_up_cents INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

-- 13. Usage logs (every API call tracked)
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- 14. Payment history (Stripe transactions)
CREATE TABLE payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

-- Migration: Add columns to existing tables for new features
-- ALTER TABLE companies ADD COLUMN website TEXT;
-- ALTER TABLE companies ADD COLUMN social_platforms TEXT[];
-- ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;
-- ALTER TABLE users ADD COLUMN email TEXT;

-- 15. Company assignments (agents assigned to client companies)
CREATE TABLE company_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_owner_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  agent_user_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (company_owner_id, company_id)
    REFERENCES companies(user_id, id) ON DELETE CASCADE,
  UNIQUE (company_owner_id, company_id, agent_user_id)
);
ALTER TABLE company_assignments ENABLE ROW LEVEL SECURITY;

-- Indexes for common query patterns
CREATE INDEX idx_companies_user ON companies(user_id);
CREATE INDEX idx_memory_files_company ON memory_files(user_id, company_id);
CREATE INDEX idx_saved_content_company ON saved_content(user_id, company_id);
CREATE INDEX idx_custom_tones_company ON custom_tones(user_id, company_id);
CREATE INDEX idx_images_company ON images(user_id, company_id);
CREATE INDEX idx_characters_company ON characters(user_id, company_id);
CREATE INDEX idx_content_presets_company ON content_presets(user_id, company_id);
CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id, created_at DESC);
CREATE INDEX idx_payment_history_user ON payment_history(user_id, created_at DESC);
CREATE INDEX idx_company_assignments_agent ON company_assignments(agent_user_id);

-- Migration: role rename (user -> client) and company_assignments
-- Run these on existing databases:
--
-- UPDATE users SET role = 'client' WHERE role = 'user';
-- UPDATE invites SET role = 'client' WHERE role = 'user' AND used_at IS NULL;
-- ALTER TABLE users ALTER COLUMN role SET DEFAULT 'client';
-- ALTER TABLE invites ALTER COLUMN role SET DEFAULT 'client';
-- CREATE TABLE company_assignments ( ... ); -- see above
-- CREATE INDEX idx_company_assignments_agent ON company_assignments(agent_user_id);

-- 16. Scheduled posts (persisted publish queue, published by /api/cron/publish-tick)
CREATE TABLE scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  saved_content_id UUID REFERENCES saved_content(id) ON DELETE SET NULL,
  item_id TEXT,                                  -- calendar item key, e.g. "post-0"
  content_type TEXT NOT NULL DEFAULT 'post',     -- post | reel | carousel | article | quote | youtube
  caption TEXT NOT NULL DEFAULT '',
  image_keys TEXT[] NOT NULL DEFAULT '{}',       -- images-table keys, signed at publish time
  media_urls TEXT[] NOT NULL DEFAULT '{}',       -- already-public image URLs
  video_url TEXT,
  platforms TEXT[] NOT NULL,                     -- instagram | facebook | linkedin
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','publishing','published','failed','cancelled')),
  platform_post_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_scheduled_posts_company ON scheduled_posts(user_id, company_id);
CREATE INDEX idx_scheduled_posts_due ON scheduled_posts(status, scheduled_at);

-- Migration: Enable RLS on all tables (run on existing databases)
-- The app uses the service role key which bypasses RLS, so no policies are needed.
-- This blocks all access via the anon/public key (deny-by-default).
--
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memory_files ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE saved_content ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE custom_tones ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE images ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE drive_tokens ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE content_presets ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE company_assignments ENABLE ROW LEVEL SECURITY;
