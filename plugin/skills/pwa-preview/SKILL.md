---
name: pwa-preview
description: Use PWA Preview when the user wants to publish, inspect, update, extend, or remove an already-built static web application or PWA as a temporary HTTPS preview.
---

# PWA Preview workflow

PWA Preview hosts already-built static web applications and PWAs. It does not build source code or run application backends.

Use the PWA Preview MCP tools for preview lifecycle operations.

## Create a preview

When the user has an HTTPS URL for a supported static artifact, use `preview_create`.

If an Agent Workspace build flow is available and the user is developing a static web app there, the preferred handoff is:

1. Build the static application in Agent Workspace.
2. Obtain a temporary HTTPS artifact download URL.
3. Call `preview_create` with that URL.
4. Return the resulting preview URL to the user.

## Update during iteration

When the user is iterating on the same application, prefer `preview_update` on the existing preview instead of creating a new preview. This preserves the preview ID and URL.

For an Agent Workspace iteration:

1. Build the new version.
2. Obtain a fresh artifact download URL.
3. Call `preview_update` for the existing preview ID.
4. Confirm that the same preview URL now serves the new version.

## Lifecycle

Use `preview_list` and `preview_get` to inspect previews, `preview_extend` to extend their lifetime, and `preview_delete` when the preview is no longer needed.

Do not treat an artifact download URL as PWA Preview authorization. PWA Preview authentication and ownership remain enforced by the MCP connection.
