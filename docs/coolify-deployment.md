# Coolify deployment – pwa-preview

## Compose model

Use `compose.coolify.yaml` for production deployments in Coolify. It starts only the pwa-preview application and assumes PostgreSQL is provided separately through `DATABASE_URL`.

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

## DNS and TLS

Create a wildcard DNS record for `*.<PREVIEW_DOMAIN_SUFFIX>` pointing at the Coolify/Traefik ingress. Configure the reverse proxy with both `<CONTROL_PLANE_HOST>` and `*.<PREVIEW_DOMAIN_SUFFIX>` on the same application service.

The wildcard certificate must be issued with a DNS-01 challenge. HTTP-01 cannot issue a wildcard certificate. Configure the DNS-provider credentials in Coolify/Traefik, not in the pwa-preview container.

The application listens on port 3000 over plain HTTP inside the deployment network. TLS terminates at Coolify/Traefik.

## Persistent services

Mount a persistent volume at:

```text
/data
```

Use PostgreSQL 17 or later for metadata. The recommended Coolify setup reuses a shared PostgreSQL instance but gives pwa-preview its own database and user. Set `DATABASE_URL` to that database; `compose.coolify.yaml` does not start PostgreSQL itself.

This v1 architecture assumes one active pwa-preview application instance because `/data` is local persistent storage.

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
CONTROL_PLANE_HOST=...
PREVIEW_DOMAIN_SUFFIX=...
DATABASE_URL=postgres://pwa_preview:<password>@<shared-postgres-host>:5432/pwa_preview
SESSION_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Then deploy with `compose.coolify.yaml`. It intentionally has no published host port; Coolify/Traefik routes to the exposed internal port 3000.

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
