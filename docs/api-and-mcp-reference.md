# API and MCP reference

## Authentication

Browser/REST management uses the secure host-only session created by GitHub OAuth. MCP supports OAuth 2.0 Authorization Code with PKCE for interactive clients such as ChatGPT, and personal Bearer tokens remain available for scripts and troubleshooting.

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

Token plaintext is returned only when issued. PostgreSQL stores only its SHA-256 hash. The web UI exposes controls to issue, copy and revoke these tokens.

### MCP OAuth

OAuth discovery:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`

OAuth endpoints:

- `POST /register` — dynamic client registration for public PKCE clients
- `GET /authorize` — authorization code flow; reuses the existing GitHub login and allowlist
- `POST /token` — authorization-code and refresh-token grants

The required scope is `mcp`. PKCE `S256` is mandatory. Access tokens are short-lived MCP bearer tokens and refresh tokens are rotated when used.

For ChatGPT, configure the MCP server URL as:

```text
https://<CONTROL_PLANE_HOST>/mcp
```

ChatGPT can discover the OAuth authorization server from the MCP 401 response and protected-resource metadata.

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
