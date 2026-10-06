# OpenAI plugin distribution

PWA Preview publishes one complete portable Agent Plugins package that is also the author-supplied ZIP for Marketplace/public submission.

## Package layout

`pwa-preview-plugin-<version>.zip` contains:

```text
pwa-preview/
├── plugin.json
├── mcp.json
├── assets/
│   ├── logo.png
│   └── composer-icon.png
└── skills/
    └── pwa-preview/
        └── SKILL.md
```

The public upload contains no `.app.json`, no non-null `apps` declaration and no `.codex-plugin/` update overlay. The Developer Portal can create the ChatGPT App binding from the remote MCP configuration during submission.

## MCP integration

`mcp.json` points at `https://pwa-preview.apphome.one/mcp`. The remote server uses PWA Preview OAuth and user ownership rules for preview lifecycle operations.

## Marketplace metadata

`plugin.json` includes listing metadata, public website/support/privacy/terms URLs, icons, five positive and three negative review cases, `commerce: false`, and country targeting limited to Sweden (`SE`).

## Build

```bash
PWA_PREVIEW_MCP_URL=https://pwa-preview.apphome.one/mcp \
  npm run plugin:build -- --version 1.0.0 --target marketplace
```

The generated directory is `build/plugin-marketplace/pwa-preview/`. The `desktop` target remains available for portable direct-MCP use and produces the same complete structure.

## Release

A GitHub Release publishes the Docker image and `pwa-preview-plugin-<version>.zip`. No OAuth credential, bearer token, signed artifact URL, session secret, database credential or other secret may be embedded in the package.

## Public submission

Portal-only work remains separate: verified publisher identity, MCP→ChatGPT App conversion, reviewer access for the OAuth-protected flow, demo recording, final review-case execution, legal/policy attestations and submit-for-review.
