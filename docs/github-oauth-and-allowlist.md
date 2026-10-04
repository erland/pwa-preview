# GitHub OAuth and allowlist administration

## GitHub OAuth

Create a GitHub OAuth application whose callback URL exactly matches:

```text
https://<CONTROL_PLANE_HOST>/auth/callback/github
```

For the planned production host:

```text
https://pwa-preview.apps.isaksson.info/auth/callback/github
```

The application requests `read:user user:email`. Login succeeds only when GitHub provides a verified email address and that email matches an enabled allowlist entry.

Identity persistence is keyed by `(provider, provider_subject)`. Email is policy input and metadata, not the durable user identity key.

## Allowlist model

Entries are stored in `allowlist_entries` with:

- optional provider scope (`github` or null for provider-neutral matching),
- email,
- enabled flag,
- timestamps.

Matching is case-insensitive for email.

## v1 administration

There is no dedicated allowlist administration UI/API in v1.

For Coolify and other environment-driven deployments, the preferred bootstrap/sync mechanism is:

```text
PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS=user@example.com,second@example.com
```

When this variable is present and non-empty at application startup, pwa-preview treats it as the authoritative set of enabled **GitHub-scoped** allowlist entries:

- listed addresses are inserted or re-enabled idempotently,
- GitHub-scoped addresses omitted from the configured list are disabled,
- matching is case-insensitive and configured addresses are normalized to lowercase,
- provider-neutral entries (`provider IS NULL`) are not modified.

If the variable is missing or empty, startup does **not** modify `allowlist_entries`. This makes it safe to leave the feature unused and avoids interpreting an accidentally empty Coolify variable as "disable everyone".

Direct PostgreSQL administration remains available when environment-driven sync is not desired.

Add a GitHub-scoped address:

```sql
INSERT INTO allowlist_entries(provider, email, enabled)
VALUES ('github', 'user@example.com', true)
ON CONFLICT ((coalesce(provider, '')), lower(email))
DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
```

Add a provider-neutral address:

```sql
INSERT INTO allowlist_entries(provider, email, enabled)
VALUES (NULL, 'user@example.com', true)
ON CONFLICT ((coalesce(provider, '')), lower(email))
DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
```

Disable access:

```sql
UPDATE allowlist_entries
SET enabled = false, updated_at = now()
WHERE lower(email) = lower('user@example.com')
  AND coalesce(provider, '') = 'github';
```

Disabling an allowlist entry prevents future GitHub login and causes both existing browser sessions and MCP Bearer-token authentication for that identity to fail on subsequent authenticated requests. A browser session that no longer passes the allowlist check is deleted immediately.

Operators should use a database account/process appropriate for their environment and should not expose these statements as unauthenticated application endpoints.
