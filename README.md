# pwa-preview

Temporary HTTPS previews for pre-built static web applications and PWAs.

`pwa-preview` accepts pre-built static artifacts, publishes temporary HTTPS preview URLs, supports update on the same URL, and expires/removes previews automatically. It does not build or execute user application code.

## Requirements

- Node.js 22
- npm
- Docker / Docker Compose for the local PostgreSQL service

## Development

```bash
npm ci
npm run dev
```

Health endpoints:

- `GET /health`
- `GET /ready`

## Configuration

Copy `.env.example` when running outside Docker Compose. Startup validates all drift- and security-sensitive settings, including hosts, database URL, session/OAuth secrets, preview TTLs, artifact limits, and URL-fetch limits. Secret values and `DATABASE_URL` are deliberately excluded from the startup configuration summary.

The v1 defaults are 5/30/1440 minutes for minimum/default/maximum TTL, 100 MiB compressed artifact size, 500 MiB extracted size, 20,000 files, path length 1024, a 30 second URL-fetch timeout, and 5 redirects.

## Verification

```bash
npm run check
docker build -t pwa-preview:local .
```

## Local stack

```bash
docker compose up --build
```

The application is available on `http://localhost:3000` and PostgreSQL is kept internal to the Compose network.

## Architecture

The service separates an authenticated control plane from wildcard-hosted preview origins. Metadata uses PostgreSQL and preview files use an `ObjectStore` abstraction backed by a persistent local volume in v1.

## Database

PostgreSQL 17 stores users, external identities, allowlist entries, preview metadata, and migration state.

Apply migrations locally with:

```bash
npm run db:migrate:dev
```

The CI workflow runs integration tests against a real PostgreSQL 17 service via `TEST_DATABASE_URL`. The ordinary `npm test` suite skips those database integration tests when no test database is configured.

## Authentication (Step 4)

The control plane uses GitHub OAuth. A verified GitHub email must match an enabled allowlist entry before a local user/session is created. External identity is keyed by `provider + provider_subject`; email is metadata and policy input, not the permanent identity key.

Routes:

- `GET /auth/login/github`
- `GET /auth/callback/github`
- `POST /auth/logout`
- `GET /api/me` (authenticated)

The session cookie is `Secure`, `HttpOnly`, `SameSite=Lax` and deliberately host-only (no `Domain` attribute), so it is never shared with preview origins.


## Local storage (Step 5)

Preview files use an `ObjectStore` abstraction. The v1 implementation, `LocalVolumeObjectStore`, stores data below `DATA_ROOT` using separate `previews/`, `staging/`, and `tmp/` roots. Storage keys are generated server-side with 128 bits of randomness and are validated before they can influence filesystem paths. `DATA_ROOT=/` is rejected.

Docker Compose mounts a persistent `preview-data` volume at `/data`. Artifact extraction and publish/update semantics are intentionally deferred to later steps; Step 5 only establishes safe storage primitives.


## Artifact ingestion (Step 6)

`ArchiveImporter` supports ZIP and `tar.gz` artifacts. Every artifact is detected by signature, extracted into a server-created staging area, validated against configured compressed/extracted size, file-count and path-length limits, and normalized so the resulting site root contains `index.html`.

Archive entries with traversal, absolute paths, symlinks, hardlinks or special-file types are rejected. Extraction never targets a live preview directory.

## Step 7: preview creation and serving

Authenticated users can create a preview by posting one ZIP or tar.gz artifact to `POST /api/previews` as multipart form data. Optional fields are `lifetimeMinutes` and `name`.

The service generates a cryptographically random `p-<128-bit>` preview id, stores metadata as `CREATING`, imports through the safe archive pipeline, publishes to `/data/previews/<id>/current`, records checksum/size/file metadata and transitions to `READY`. Failed imports transition to `FAILED` and do not expose partial content.

Requests to `https://<preview-id>.<PREVIEW_DOMAIN_SUFFIX>` are resolved from the Host header only when the id matches the strict preview-id format. READY, unexpired previews are served with MIME handling, SPA fallback, no directory listing and baseline security headers.

## URL artifact import (Step 8)

`POST /api/previews` also accepts JSON with `sourceUrl`, optional `lifetimeMinutes`, and optional `name`. URL import is HTTPS-only and applies SSRF protection before every connection and every redirect. Loopback, private, link-local, metadata-style and other non-public targets are rejected; credentials and non-443 explicit ports are rejected; redirects, timeout, and response size are bounded. Signed query strings are never intentionally logged by the URL importer.


## Lifecycle API (Step 9)

Authenticated owner-scoped endpoints:

- `GET /api/previews`
- `GET /api/previews/:id`
- `POST /api/previews/:id/extend` with `{ "lifetimeMinutes": 30 }`
- `DELETE /api/previews/:id`

Management operations intentionally return `404` when the preview is not owned by the current user, so the API does not disclose whether another user's preview exists. Delete is idempotent for the owner.

## Atomic preview update

`PUT /api/previews/:id/content` replaces the content of an existing preview without changing its preview ID or hostname. It accepts the same two source forms as create: multipart artifact upload or JSON with `sourceUrl`.

Updates are owner-scoped. The new artifact is fetched/imported and fully validated in staging first. The local-volume store then prepares a replacement using an atomic rename on the same filesystem while retaining the previous `current` directory as a rollback backup. The backup is removed only after preview metadata has been successfully updated; if metadata update fails, the filesystem swap is rolled back. Invalid artifacts never touch the active site.

Because v1 is intentionally single-active-instance, updates for the same preview ID are serialized in-process to prevent concurrent swaps from racing.

## Background cleanup and reconciliation

The service runs two idempotent background maintenance loops in the single-active-instance v1 deployment:

- cleanup claims expired `READY` previews in small batches, marks them `EXPIRED`, removes storage, then marks them `DELETED`;
- reconciliation completes interrupted `DELETING` operations, marks stale `CREATING` previews as `FAILED`, removes orphan preview directories and stale staging directories.

Both jobs also run once at startup so a process restart heals interrupted lifecycle work before relying on the periodic schedule.

## Web UI

Control plane serves a React/Vite UI on `/`. Unauthenticated users are offered GitHub login. Authenticated users can list, create, open, update, extend, and delete their own previews. The UI is responsive down to phone widths and uses the same authenticated REST API as other clients.

For local UI development, run `npm run dev:ui`. Production `npm run build` builds both the React UI and Node backend into `dist/`.

## MCP

The remote MCP endpoint is `POST /mcp` (Streamable HTTP). It requires a personal Bearer token tied to a local user. An authenticated browser session can issue a token with `POST /api/mcp-tokens` and revoke all active tokens with `DELETE /api/mcp-tokens`. Tokens are stored only as SHA-256 hashes, expire by default after 90 days, and are revalidated against the active allowlist on every MCP request.

Tools: `preview_create`, `preview_list`, `preview_get`, `preview_update`, `preview_extend`, `preview_delete`. MCP create/update use HTTPS `sourceUrl`; tools never accept `ownerUserId`.


## Production deployment

Production deployment is designed for Coolify/Traefik. Use `compose.coolify.yaml` for production; it pulls `ghcr.io/erland/pwa-preview:<version>`, starts only pwa-preview, keeps `/data` persistent, and expects an external/shared PostgreSQL database through `DATABASE_URL`. The ordinary `compose.yaml` remains the self-contained local-development stack with PostgreSQL included.

Publishing a GitHub Release builds and pushes the production image on GitHub Actions for both `linux/amd64` and `linux/arm64`, so Coolify does not spend server resources compiling or building the image. Set `PWA_PREVIEW_VERSION` in Coolify to the desired release tag/version.

Both the control-plane hostname and preview wildcard suffix are configurable through `CONTROL_PLANE_HOST` and `PREVIEW_DOMAIN_SUFFIX`; the application does not depend on specific DNS names.

See [`docs/coolify-deployment.md`](docs/coolify-deployment.md) for shared PostgreSQL, DNS/TLS, migration, health-check and verification instructions.

### Release security regression suite

`npm run test:security` runs the release-blocking security regressions for archive attacks and limits, static path traversal, cookie isolation, allowlist denial, and (when `TEST_DATABASE_URL` is present) cross-user persistence operations. GitHub Actions runs this suite in addition to the normal test suite.

## Full E2E

`npm run test:e2e` runs the release-blocking PostgreSQL-backed end-to-end flows when `TEST_DATABASE_URL` is set. It covers the browser/API lifecycle, the authenticated MCP lifecycle, and restart/expiry cleanup. GitHub and the external artifact host are stubbed at their external boundaries; PostgreSQL, migrations, filesystem storage, preview serving, session auth, MCP bearer auth and lifecycle services are real.

## Step 17 - Agent Workspace integration

The supported v1 handoff is `project_build -> artifact_download_link -> preview_create(sourceUrl)`. A signed Agent Workspace artifact URL is only an artifact download credential; pwa-preview management remains authenticated and owner-scoped. See `docs/agent-workspace-integration.md` and run the live integration smoke with `npm run test:agent-workspace` using two fresh signed artifact URLs.

The Agent Workspace handoff has been exercised with real build artifacts and signed download links. The signed link itself was verified by Agent Workspace URL-import. A sandbox live-smoke uncovered and fixed Node 22 custom DNS lookup handling; the remaining outbound TLS reset is environment-specific, so the full signed-URL smoke is intended to run from the deployed pwa-preview host.


## v1 documentation

- [`docs/configuration-reference.md`](docs/configuration-reference.md) — complete environment configuration
- [`docs/github-oauth-and-allowlist.md`](docs/github-oauth-and-allowlist.md) — OAuth setup and v1 allowlist administration
- [`docs/coolify-deployment.md`](docs/coolify-deployment.md) — Coolify, DNS, TLS and health checks
- [`docs/backup-and-restore.md`](docs/backup-and-restore.md) — PostgreSQL and `/data` recovery
- [`docs/api-and-mcp-reference.md`](docs/api-and-mcp-reference.md) — REST and MCP surfaces
- [`docs/security-model.md`](docs/security-model.md) — trust boundaries and mitigations
- [`docs/known-limitations.md`](docs/known-limitations.md) — deliberate v1 constraints
- [`docs/e2e-verification.md`](docs/e2e-verification.md) — release-blocking E2E coverage
- [`docs/agent-workspace-integration.md`](docs/agent-workspace-integration.md) — Agent Workspace handoff
- [`docs/release-checklist.md`](docs/release-checklist.md) — final release gates
