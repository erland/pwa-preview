ALTER TABLE oauth_refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_rotated_at_idx ON oauth_refresh_tokens(rotated_at);
