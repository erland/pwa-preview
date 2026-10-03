# Security model

## Trust boundaries

`pwa-preview` receives already-built static artifacts. It does not execute user build scripts or application backend code.

Artifacts, source URLs, archive entry names, Host headers and request paths are treated as untrusted input.

## Authentication and authorization

- GitHub login requires a verified email and active allowlist match.
- Stable external identity is `(provider, provider_subject)`.
- Browser sessions use `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookies.
- MCP Bearer tokens map to the same local `User` model and are rechecked against the allowlist.
- Preview management is strictly owner-scoped.
- Cross-user lookup returns the same not-found behavior as a nonexistent preview.

## Control plane vs preview plane

Only two host classes are accepted:

- exact `CONTROL_PLANE_HOST` for UI/API/auth/MCP,
- valid preview IDs below `PREVIEW_DOMAIN_SUFFIX` for static preview content.

Unknown hosts return 404. The control-plane cookie has no `Domain` attribute and is therefore not sent to preview subdomains.

## Artifact archives

ZIP and tar.gz entries are validated before writing. The importer rejects:

- absolute paths,
- traversal,
- symlinks,
- hardlinks,
- devices/FIFOs/other special files,
- excessive compressed/extracted size,
- excessive file count,
- excessive path length.

Extraction only targets server-created staging storage. A live preview is changed only after successful validation.

## URL import and SSRF

URL import is HTTPS-only. It rejects credentials and non-443 explicit ports, resolves DNS before connection, blocks non-public targets, revalidates redirects, and bounds redirects, timeout and response size. Connection targets are pinned to validated DNS results to reduce DNS rebinding exposure.

## Static serving

The preview host is validated before resolving storage. Request paths are safely resolved beneath the preview root. Missing clean SPA routes may fall back to `index.html`; explicit missing assets return 404. Directory listing is disabled.

Baseline response headers include:

```text
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
```

No strict CSP is imposed in v1 because previews may contain arbitrary static application code.

## Lifecycle safety

Create/import occurs in staging. Update uses an atomic same-filesystem swap and retains a rollback backup until metadata update commits. Cleanup/reconciliation are idempotent and repair interrupted lifecycle states after restart.

## Verification

Release gates include unit tests, PostgreSQL integration tests, security regressions, full E2E, production image build and deployed-environment checks for wildcard TLS and Agent Workspace signed-URL handoff.
