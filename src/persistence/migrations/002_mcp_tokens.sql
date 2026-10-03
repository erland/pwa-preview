CREATE TABLE mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT mcp_tokens_expiry_after_create CHECK (expires_at > created_at)
);

CREATE INDEX mcp_tokens_user_idx ON mcp_tokens (user_id, created_at DESC);
CREATE INDEX mcp_tokens_active_idx ON mcp_tokens (token_hash, expires_at) WHERE revoked_at IS NULL;
