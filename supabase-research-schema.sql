-- Research tool schema for PostPilot
-- Run this in the Supabase SQL Editor (separate from supabase-schema.sql)

-- Saved research ideas (trends and post formats discovered via /api/research)
CREATE TABLE research_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  niche TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('trend', 'format')),
  title TEXT NOT NULL,
  payload JSONB NOT NULL,             -- the researched trend/format details
  draft JSONB,                        -- adapted post draft, if generated
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'drafted', 'used', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, company_id) REFERENCES companies(user_id, id) ON DELETE CASCADE
);
ALTER TABLE research_ideas ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_research_ideas_company ON research_ideas(user_id, company_id, created_at DESC);
