# Coolify deployment – pwa-preview

## Hosts

Control plane:

```text
pwa-preview.apps.isaksson.info
```

Preview plane:

```text
*.previewapp.apphome.one
```

Only these host classes are accepted by the application. Unknown hosts return 404. The control-plane session cookie is host-only and therefore is not sent to preview hosts.

## DNS and TLS

Create a wildcard DNS record for `*.previewapp.apphome.one` pointing at the Coolify/Traefik ingress. Configure the reverse proxy with both `pwa-preview.apps.isaksson.info` and `*.previewapp.apphome.one` on the same application service.

The wildcard certificate must be issued with a DNS-01 challenge. HTTP-01 cannot issue a wildcard certificate. Configure the DNS-provider credentials in Coolify/Traefik, not in the pwa-preview container.

The application listens on port 3000 over plain HTTP inside the deployment network. TLS terminates at Coolify/Traefik.

## Persistent services

Mount a persistent volume at:

```text
/data
```

Use PostgreSQL 17 or later for metadata. This v1 architecture assumes one active pwa-preview application instance because `/data` is local persistent storage.

## Required environment variables

```text
CONTROL_PLANE_HOST=pwa-preview.apps.isaksson.info
PREVIEW_DOMAIN_SUFFIX=previewapp.apphome.one
DATABASE_URL=postgres://...
DATA_ROOT=/data
SESSION_SECRET=<at least 32 random characters>
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
MIGRATE_ON_START=false
```

The GitHub OAuth callback is:

```text
https://pwa-preview.apps.isaksson.info/auth/callback/github
```

Register that exact callback URL in the GitHub OAuth application.

## Database migrations

For production, use controlled pre-deploy migrations:

```text
npm run db:migrate
```

Set `MIGRATE_ON_START=false` for the application process. Local development may keep the default `true`.

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
6. Two different random `p-...previewapp.apphome.one` hosts route to the same service without adding proxy rules.
7. The wildcard certificate is valid for both random preview hosts.
8. An unknown or invalid preview host returns 404 and never exposes the control-plane UI/API.
9. A completely unrelated Host header returns 404.

## Coolify runtime notes

The production image runs as the non-root `node` user. `/data` is created and owned by that user in the image and must remain writable when mounted persistently.

Do not scale this v1 container to multiple active replicas while using local `/data`. Multi-instance deployment requires shared object storage and distributed coordination as described in the architecture document.
