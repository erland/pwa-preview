# Full E2E verification

The release-blocking E2E suite is run with:

```bash
TEST_DATABASE_URL=postgres://... npm run test:e2e
```

The command deliberately fails if `TEST_DATABASE_URL` is missing, so a skipped database suite cannot be mistaken for a successful E2E run.

## Browser/API flow

The test exercises the real Fastify application, secure session handling, PostgreSQL repositories, archive importer, local persistent storage and preview serving:

```text
GitHub OAuth boundary stub
-> allowlisted login
-> create ZIP upload
-> open index.html
-> validate SPA fallback
-> validate manifest.webmanifest
-> validate JS and service worker
-> update with a new ZIP
-> verify the same preview URL now serves the new version
-> extend TTL
-> delete
-> preview returns 404
```

Only the external GitHub API is stubbed. OAuth state/session/callback handling and local user mapping are real.

## MCP flow

The test uses a real local HTTP listener for `/mcp`, a real MCP bearer token persisted in PostgreSQL, and the real MCP transport/tools:

```text
allowlisted local user
-> issue MCP token
-> authenticate Bearer token
-> preview_create(sourceUrl)
-> preview_list
-> preview_get
-> preview_update(sourceUrl)
-> verify same preview URL serves updated content
-> preview_extend
-> preview_delete
```

The external HTTPS artifact host is stubbed at `UrlArtifactSource.fetch`; archive ingestion, publication, metadata, authorization and MCP transport are real. SSRF behavior remains covered separately by the security regression suite.

## Restart/expiry flow

The test creates and publishes a preview, closes the Fastify instance, starts a new instance against the same PostgreSQL database and data directory, verifies the preview still works, advances expiry in the database, runs the real cleanup job, and verifies the preview is removed.

## CI

GitHub Actions runs `npm run test:e2e` in the PostgreSQL integration job after migrations/integration tests. Agent Workspace does not currently provide `TEST_DATABASE_URL`, so the E2E file is compiled there but skipped during its generic `npm test` verification.
