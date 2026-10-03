# Configuration reference

`pwa-preview` reads configuration from environment variables at startup and rejects invalid security-sensitive values.

## Required core settings

| Variable | Purpose | Production guidance |
|---|---|---|
| `CONTROL_PLANE_HOST` | Exact hostname for UI, REST, auth and MCP | `pwa-preview.apps.isaksson.info` |
| `CONTROL_PLANE_REGISTRABLE_DOMAIN` | Registrerbar domän som kontrollplanet tillhör | `isaksson.info` |
| `PREVIEW_DOMAIN_SUFFIX` | Suffix below which preview IDs are served; must be outside the control-plane registrable domain | `previewapp.apphome.one` |
| `DATABASE_URL` | PostgreSQL connection string | Secret; do not log |
| `DATA_ROOT` | Persistent filesystem root | `/data`; filesystem root `/` is rejected |
| `SESSION_SECRET` | Secure-session secret | At least 32 characters; random per environment |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | From GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Secret |

`CONTROL_PLANE_HOST` must belong to `CONTROL_PLANE_REGISTRABLE_DOMAIN`. `PREVIEW_DOMAIN_SUFFIX` is rejected at startup if it is the same domain or a subdomain of that registrable control-plane domain. This keeps arbitrary preview JavaScript outside the control-plane cookie/site boundary.

## Listener

- `PORT` defaults to `3000`.
- `HOST` defaults to `0.0.0.0`.
- TLS is terminated by Coolify/Traefik, not by the application.

## Preview lifetime

- `TTL_MIN_MINUTES`: default `5`
- `TTL_DEFAULT_MINUTES`: default `30`
- `TTL_MAX_MINUTES`: default `1440` (24 hours)

The configured minimum must be positive, default must lie within min/max, and max must not be below min.

## Artifact limits

- `MAX_COMPRESSED_BYTES`: default `104857600` (100 MiB)
- `MAX_EXTRACTED_BYTES`: default `524288000` (500 MiB)
- `MAX_FILE_COUNT`: default `20000`
- `MAX_PATH_LENGTH`: default `1024`
- `MAX_ACTIVE_PREVIEWS_PER_USER`: default `20`
- `MAX_CONCURRENT_IMPORTS_PER_USER`: default `2`
- `MAX_STORAGE_BYTES_PER_USER`: default `2147483648` (2 GiB)
- `MAX_STORAGE_BYTES_TOTAL`: default `21474836480` (20 GiB)

Archive limits are enforced during import before content reaches a live preview. The per-user active-preview quota counts `CREATING` and `READY` previews. The per-user import concurrency limit applies across REST and MCP within the single active application process; excess operations fail fast. Storage quotas are calculated from the extracted size of `READY` previews. New previews and updates are checked before publication; updates charge only the positive size increase over the content they replace. Quota checks are serialized process-wide, matching the v1 single-active-instance deployment model.

## URL import

- `URL_FETCH_TIMEOUT_MS`: default `30000`
- `MAX_REDIRECTS`: default `5`

URL imports are HTTPS-only, reject URL credentials and non-443 explicit ports, and validate resolved/redirect targets against the SSRF policy.

## Background maintenance

- `CLEANUP_INTERVAL_MS`: default `60000`
- `RECONCILIATION_INTERVAL_MS`: default `600000`
- `STALE_OPERATION_MINUTES`: default `30`
- `STALE_STAGING_MINUTES`: default `60`

## Migrations

- `MIGRATE_ON_START`: default `true`

For production, prefer `MIGRATE_ON_START=false` and execute `npm run db:migrate` as a controlled pre-deploy step.

## Logging

The startup configuration summary deliberately excludes `DATABASE_URL`, `SESSION_SECRET`, OAuth secrets and signed artifact URLs.
