# API and MCP reference

## Authentication

Browser/REST management uses the secure host-only session created by GitHub OAuth. MCP uses a personal Bearer token issued by an authenticated browser session.

Preview rendering itself is public in v1 via the unguessable preview hostname; management is authenticated.

## REST API

### User/session

- `GET /auth/login/github`
- `GET /auth/callback/github`
- `POST /auth/logout`
- `GET /api/me`

### Preview lifecycle

- `POST /api/previews`
  - multipart ZIP/tar.gz upload, or
  - JSON `{ "sourceUrl": "https://...", "lifetimeMinutes": 30, "name": "Demo" }`
- `GET /api/previews`
- `GET /api/previews/:id`
- `PUT /api/previews/:id/content`
  - multipart artifact upload, or
  - JSON `{ "sourceUrl": "https://..." }`
- `POST /api/previews/:id/extend`
  - JSON `{ "lifetimeMinutes": 30 }`
- `DELETE /api/previews/:id`

All management operations derive the owner from server-side auth context. Clients never submit `ownerUserId`.

### MCP token management

- `POST /api/mcp-tokens`
- `DELETE /api/mcp-tokens`

Token plaintext is returned only when issued. PostgreSQL stores only its SHA-256 hash.

## MCP

Endpoint:

```text
POST /mcp
Authorization: Bearer <personal token>
```

Tools:

- `preview_create`
- `preview_list`
- `preview_get`
- `preview_update`
- `preview_extend`
- `preview_delete`

`preview_create` and `preview_update` use HTTPS `sourceUrl` as the portable artifact transport. The same `PreviewService` and owner-scope rules are used by REST and MCP.

## Preview URL

A ready preview is exposed as:

```text
https://<preview-id>.<PREVIEW_DOMAIN_SUFFIX>
```

The hostname is generated server-side from a cryptographically random preview ID.
