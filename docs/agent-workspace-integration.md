# Agent Workspace integration

The v1 integration uses a signed Agent Workspace artifact URL plus the authenticated pwa-preview MCP/API. No service-to-service owner delegation is used.

## Flow

1. Build the static application in Agent Workspace.
2. Publish the static output directory with `project_build`.
3. Request a temporary HTTPS link with `artifact_download_link`.
4. Call pwa-preview `preview_create` with `sourceUrl` and optional `lifetimeMinutes`/`name`.
5. Keep the returned preview URL. Updating the preview uses `preview_update` with a new signed artifact URL and the same preview id.
6. Delete the preview with `preview_delete` when it is no longer needed.

The signed artifact URL authorizes download of the artifact only. It is not pwa-preview authorization. The MCP Bearer token/session still determines the local user and therefore the owner.

## Artifact requirements

The Agent Workspace build output must be a static site archive accepted by pwa-preview (ZIP or tar.gz). It must contain `index.html` at archive root or beneath exactly one common top-level directory. No backend process is transferred or executed by pwa-preview.

## Smoke verification

Given two freshly generated signed links (v1 and v2):

```bash
AGENT_WORKSPACE_ARTIFACT_URL_V1='https://…' \
AGENT_WORKSPACE_ARTIFACT_URL_V2='https://…' \
npm run test:agent-workspace
```

The smoke test uses the real URL downloader, SSRF validation, archive importer, local volume ObjectStore and PreviewService. It verifies create from v1, update on the same preview id from v2, and delete.

## ChatGPT/MCP sequence

```text
Agent Workspace project_build
→ artifact_download_link
→ pwa-preview preview_create(sourceUrl)
→ preview_get/list
→ Agent Workspace new build
→ artifact_download_link
→ pwa-preview preview_update(previewId, sourceUrl)
→ preview_delete
```

Direct Agent Workspace → pwa-preview delegation is deliberately deferred until a verifiable delegation token model is designed.

## Verification status

The integration was verified with real Agent Workspace build artifacts and real `artifact_download_link` URLs. Agent Workspace's URL-import successfully downloaded and unpacked an artifact through the signed link, confirming the handoff URL itself.

A live pwa-preview smoke was also attempted from an Agent Workspace execution sandbox. That exposed and fixed a Node 22 `https.request` custom-lookup compatibility issue (`lookup` must handle `options.all`). After that fix, the sandbox reached the outbound TLS connection but the connection was reset by the execution environment. Because the sandbox egress behavior is outside pwa-preview, the permanent smoke test remains opt-in and should be run from the deployed pwa-preview environment with two fresh signed URLs.

The release verification therefore has two layers:

1. automated unit/security/E2E coverage for URL import, archive import, create/update/delete, and owner scope;
2. `npm run test:agent-workspace` in the deployed environment using fresh Agent Workspace artifact links.
