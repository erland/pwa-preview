# Coolify deployment – pwa-preview

## Compose model

Use `compose.coolify.yaml` for production deployments in Coolify. It starts only the pwa-preview application, pulls a pre-built image from GitHub Container Registry (GHCR), and assumes PostgreSQL is provided separately. The application builds `DATABASE_URL` at runtime from `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` when an explicit `DATABASE_URL` is not provided.

Coolify does not build the application image. Publishing a GitHub Release triggers `.github/workflows/release-image.yml`, which builds the Docker image on GitHub-hosted runners and pushes it to `ghcr.io/erland/pwa-preview`.

The ordinary `compose.yaml` is intended for local development and includes its own PostgreSQL container.

Recommended production database model:

```text
shared PostgreSQL instance
└── database: pwa_preview
    └── user: pwa_preview
```

The PostgreSQL server/cluster may be shared with other services, but pwa-preview should use its own database and database user. The application migrations then own only that database.

## Hosts

The host names are configuration, not hard-coded application values.

Example control plane:

```text
CONTROL_PLANE_HOST=pwa-preview.apps.isaksson.info
```

Example preview plane:

```text
PREVIEW_DOMAIN_SUFFIX=previewapp.apphome.one
```

This produces preview hosts under:

```text
*.previewapp.apphome.one
```

Only these host classes are accepted by the application. Unknown hosts return 404. The control-plane session cookie is host-only and therefore is not sent to preview hosts.

By default, pwa-preview requires the preview suffix to use a different registrable domain from the control plane. This is the recommended security model for untrusted preview content. For a single-user or otherwise explicitly trusted deployment, `ALLOW_SAME_SITE_PREVIEWS=true` can override this check. For example:

```text
CONTROL_PLANE_HOST=pwa-preview.apphome.one
CONTROL_PLANE_REGISTRABLE_DOMAIN=apphome.one
PREVIEW_DOMAIN_SUFFIX=preview.apphome.one
ALLOW_SAME_SITE_PREVIEWS=true
```

This override weakens site isolation and should be removed before allowing untrusted users to deploy preview content.

## DNS and TLS

Create DNS records for both the preview base host and wildcard host, pointing at the Coolify/Traefik ingress. With `PREVIEW_DOMAIN_SUFFIX=preview.apphome.one` this is:

```text
A/AAAA  preview.apphome.one    -> Coolify server
A/AAAA  *.preview.apphome.one  -> Coolify server
```

Do not enter `https://*.preview.apphome.one` in Coolify's ordinary Domains field. Keep that field for the concrete control-plane URL, for example `https://pwa-preview.apps.isaksson.info`.

`compose.coolify.yaml` carries the wildcard preview router as Traefik labels. It matches hosts below `PREVIEW_DOMAIN_SUFFIX`, forwards them to port 3000, and requests TLS through a Traefik certificate resolver named `desec`.

The server's Traefik proxy must therefore have a `desec` DNS-01 resolver configured. The deSEC API token belongs in the Traefik proxy environment, not in the pwa-preview application container.

Example Traefik static configuration additions:

```yaml
environment:
  - DESEC_TOKEN=<deSEC token>

command:
  - '--certificatesresolvers.desec.acme.email=<email>'
  - '--certificatesresolvers.desec.acme.storage=/traefik/acme-desec.json'
  - '--certificatesresolvers.desec.acme.dnschallenge.provider=desec'
```

Keep Coolify's existing certificate resolver configuration as-is; the `desec` resolver is additional. Restart the proxy after changing its static configuration.

For `PREVIEW_DOMAIN_SUFFIX=preview.apphome.one`, the compose labels request a certificate covering:

```text
preview.apphome.one
*.preview.apphome.one
```

DNS-01 is required for the wildcard certificate. TLS terminates at Traefik; the application listens on port 3000 over plain HTTP inside the deployment network.

## Persistent services

Mount a persistent volume at:

```text
/data
```

Use PostgreSQL 17 or later for metadata. The recommended Coolify setup reuses a shared PostgreSQL instance but gives pwa-preview its own database and user. Set the Coolify `DB_*` variables for that database; pwa-preview reads them at runtime and constructs its own `DATABASE_URL`. `compose.coolify.yaml` does not interpolate database credentials and does not start PostgreSQL itself.

This v1 architecture assumes one active pwa-preview application instance because `/data` is local persistent storage.

## Required environment variables

```text
CONTROL_PLANE_HOST=pwa-preview.apps.isaksson.info
PREVIEW_DOMAIN_SUFFIX=previewapp.apphome.one
DB_HOST=<shared-postgres-host>
DB_USER=pwa_preview
DB_PASSWORD=<password>
DB_NAME=pwa_preview
DATA_ROOT=/data
SESSION_SECRET=<at least 32 random characters>
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS=user@example.com
ALLOW_SAME_SITE_PREVIEWS=false
MIGRATE_ON_START=true
```

The GitHub OAuth callback is derived from the configured control host:

```text
https://<CONTROL_PLANE_HOST>/auth/callback/github
```

For the example above this becomes:

```text
https://pwa-preview.apps.isaksson.info/auth/callback/github
```

Register the exact deployed callback URL in the GitHub OAuth application.

## Coolify environment

At minimum configure these values in Coolify rather than committing them to the compose file:

```text
PWA_PREVIEW_VERSION=1.0.0
CONTROL_PLANE_HOST=...
PREVIEW_DOMAIN_SUFFIX=...
DB_HOST=<shared-postgres-host>
DB_USER=pwa_preview
DB_PASSWORD=<password>
DB_NAME=pwa_preview
SESSION_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS=user@example.com
ALLOW_SAME_SITE_PREVIEWS=false
```

`PWA_PREVIEW_GITHUB_ALLOWLIST_EMAILS` is optional. If it is set to a non-empty comma-separated list, startup synchronizes that list as the authoritative enabled GitHub-scoped allowlist. If it is omitted or empty, startup leaves the database allowlist untouched.

`ALLOW_SAME_SITE_PREVIEWS` defaults to `false`. Set it to `true` only when you explicitly accept the weaker isolation of hosting the control plane and preview content below the same registrable domain.

`PWA_PREVIEW_VERSION` selects the GHCR image tag. For deterministic deployments, use an immutable release version such as `1.0.0` rather than `latest`.

Then deploy with `compose.coolify.yaml`. Keep the database values as normal Production runtime variables in Coolify; they do not need to be marked as build variables. The Compose file intentionally has no published host port; Coolify/Traefik routes to the exposed internal port 3000.

## Database migrations

For a simple single-instance Coolify deployment, keep `MIGRATE_ON_START=true`. The application then applies pending migrations before startup, so a fresh database gets the required tables before startup logic runs.

If migrations are instead run as a controlled pre-deploy step with `npm run db:migrate`, set `MIGRATE_ON_START=false` only after that pre-deploy step is configured and guaranteed to run before the application starts.

Migrations are transactional and tracked in `schema_migrations`.

## Health checks

Liveness:

```text
GET /health
```

Readiness:

```text
GET /ready
```

`/ready` returns 200 only when PostgreSQL responds and `/data` is readable and writable. Configure Coolify health checks against `/ready`.

## Graceful shutdown

The process handles SIGTERM and SIGINT, stops accepting new requests, clears background timers, closes Fastify, and then closes the PostgreSQL pool. A 15 second forced-shutdown guard prevents indefinite hangs.

## Reverse-proxy verification checklist

After deploy, verify:

1. `https://pwa-preview.apps.isaksson.info/health` returns 200.
2. `https://pwa-preview.apps.isaksson.info/ready` returns 200.
3. GitHub OAuth redirects back to the exact control-plane callback.
4. `Set-Cookie` for `pwa_preview_session` has `Secure`, `HttpOnly`, suitable `SameSite`, and no `Domain` attribute.
5. `/api/*`, `/auth/*`, UI and `/mcp` are usable on the control host.
6. Two different random `p-...<PREVIEW_DOMAIN_SUFFIX>` hosts route to the same service without adding proxy rules.
7. The wildcard certificate is valid for both random preview hosts.
8. An unknown or invalid preview host returns 404 and never exposes the control-plane UI/API.
9. A completely unrelated Host header returns 404.

## Coolify runtime notes

The production image runs as the non-root `node` user. `/data` is created and owned by that user in the image and must remain writable when mounted persistently.

Do not scale this v1 container to multiple active replicas while using local `/data`. Multi-instance deployment requires shared object storage and distributed coordination as described in the architecture document.


## Release image publishing

Publishing a GitHub Release builds and pushes a multi-architecture image for `linux/amd64` and `linux/arm64`.

For a release tagged `v1.2.3`, GHCR receives version aliases including:

```text
ghcr.io/erland/pwa-preview:v1.2.3
ghcr.io/erland/pwa-preview:1.2.3
ghcr.io/erland/pwa-preview:1.2
ghcr.io/erland/pwa-preview:1
ghcr.io/erland/pwa-preview:latest
```

`latest` is only updated for non-prerelease releases. Coolify should normally pin `PWA_PREVIEW_VERSION` to the exact release version. After publishing a new release, change that variable (or otherwise trigger the desired Coolify redeploy) so Coolify pulls the already-built image.


## Wildcard routing ownership

The responsibilities are intentionally split:

```text
DNS provider
  -> *.PREVIEW_DOMAIN_SUFFIX resolves to the Coolify server

Coolify / Traefik
  -> HostRegexp wildcard router from compose.coolify.yaml
  -> DNS-01 certificate through resolver "desec"
  -> forwards to pwa-preview:3000

pwa-preview
  -> validates Host again against PREVIEW_DOMAIN_SUFFIX
  -> resolves the preview ID
  -> serves only READY, unexpired static content
```

This means new preview hostnames require no per-preview DNS or Coolify configuration.
