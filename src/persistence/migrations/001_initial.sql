CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identities_provider_subject_uk UNIQUE (provider, provider_subject),
  CONSTRAINT external_identities_provider_nonempty CHECK (length(trim(provider)) > 0),
  CONSTRAINT external_identities_subject_nonempty CHECK (length(trim(provider_subject)) > 0)
);

CREATE TABLE allowlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text,
  email text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allowlist_entries_email_nonempty CHECK (length(trim(email)) > 0)
);

CREATE UNIQUE INDEX allowlist_entries_identity_uk
  ON allowlist_entries (coalesce(provider, ''), lower(email));

CREATE TYPE preview_status AS ENUM (
  'CREATING',
  'READY',
  'FAILED',
  'DELETING',
  'DELETED',
  'EXPIRED'
);

CREATE TYPE preview_source_type AS ENUM ('UPLOAD', 'URL');

CREATE TABLE previews (
  id text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text,
  status preview_status NOT NULL,
  hostname text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  compressed_size_bytes bigint,
  extracted_size_bytes bigint,
  file_count integer,
  source_sha256 text,
  source_type preview_source_type NOT NULL,
  last_error_code text,
  CONSTRAINT previews_id_format CHECK (id ~ '^p-[a-z0-9-]{10,}$'),
  CONSTRAINT previews_expiry_after_create CHECK (expires_at > created_at),
  CONSTRAINT previews_compressed_size_nonnegative CHECK (compressed_size_bytes IS NULL OR compressed_size_bytes >= 0),
  CONSTRAINT previews_extracted_size_nonnegative CHECK (extracted_size_bytes IS NULL OR extracted_size_bytes >= 0),
  CONSTRAINT previews_file_count_nonnegative CHECK (file_count IS NULL OR file_count >= 0)
);

CREATE INDEX previews_owner_created_idx ON previews (owner_user_id, created_at DESC);
CREATE INDEX previews_expiry_status_idx ON previews (expires_at, status);
