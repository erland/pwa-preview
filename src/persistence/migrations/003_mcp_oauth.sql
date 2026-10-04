CREATE TABLE oauth_clients (
  client_id text PRIMARY KEY,
  redirect_uris jsonb NOT NULL,
  client_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_authorization_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_authorization_codes_expiry_idx ON oauth_authorization_codes(expires_at);

CREATE TABLE oauth_refresh_tokens (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_refresh_tokens_expiry_idx ON oauth_refresh_tokens(expires_at);
