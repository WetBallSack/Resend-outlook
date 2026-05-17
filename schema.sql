-- Supabase SQL Schema for Email Client

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Emails Table
CREATE TABLE IF NOT EXISTS emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id VARCHAR(255) NOT NULL, -- Used to group emails together (could be References header or inferred)
  message_id VARCHAR(255) UNIQUE NOT NULL, -- The specific Message-ID of this email
  in_reply_to VARCHAR(255), -- The Message-ID this email replies to
  from_address VARCHAR(255) NOT NULL,
  to_address VARCHAR(255) NOT NULL,
  subject TEXT,
  html_body TEXT,
  text_body TEXT,
  folder VARCHAR(50) DEFAULT 'inbox', -- 'inbox' or 'sent'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster thread lookups
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
-- Optionally, add a folder index if that gets large
CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder);

-- Define Row Level Security (RLS) if authenticated users are implemented, 
-- but for a personal client app with server-side proxying we can disable RLS 
-- or set it up purely for a server service role key.
-- Since we use Server endpoints to read/write, we can bypass RLS via Service Role Key 
-- or just not strictly enforce it if we assume a secure backend setup.

-- A view to fetch distinct threads with their latest email snippet and timestamp
CREATE OR REPLACE VIEW email_threads AS
SELECT
    thread_id,
    MAX(created_at) as last_updated,
    (SELECT subject FROM emails e2 WHERE e2.thread_id = e.thread_id ORDER BY created_at DESC LIMIT 1) as subject,
    COUNT(id) as message_count
FROM emails e
GROUP BY thread_id;
