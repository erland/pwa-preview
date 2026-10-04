# OpenAI plugin distribution

PWA Preview ships a portable Agent Plugins 1.0 package for ChatGPT/Codex clients that can connect to the existing remote MCP server.

The package contains:

```text
pwa-preview/
├── plugin.json
├── mcp.json
└── skills/
    └── pwa-preview/
        └── SKILL.md
```

The plugin does not contain or deploy the PWA Preview service. It declares the existing Streamable HTTP MCP endpoint and adds workflow guidance for creating and updating temporary previews.

## Source files

The repository keeps templates under `plugin/`:

- `plugin/plugin.template.json` — portable plugin manifest.
- `plugin/mcp.template.json` — remote MCP declaration.
- `plugin/skills/pwa-preview/SKILL.md` — workflow guidance, including the Agent Workspace artifact handoff.

Generated package files are written below `build/plugin/pwa-preview/` and are not committed.

## Build locally

Use a semantic version and optionally override the MCP endpoint:

```bash
PWA_PREVIEW_MCP_URL=https://pwa-preview.apphome.one/mcp \
  npm run plugin:build -- --version 1.0.0
```

If `PWA_PREVIEW_MCP_URL` is omitted, the build defaults to:

```text
https://pwa-preview.apphome.one/mcp
```

The build validates:

- strict semantic versioning;
- HTTPS for the MCP endpoint;
- generated JSON syntax;
- plugin identity and version;
- OpenAI short-description length;
- that the generated MCP URL matches the configured value.

## GitHub Actions

CI builds a test package with a non-production example MCP endpoint and verifies the generated manifest, MCP configuration, and skill.

When a GitHub Release is published, the release workflow:

1. derives the plugin version from the release tag, stripping a leading `v`;
2. builds the portable plugin package;
3. packages the top-level `pwa-preview/` directory as `pwa-preview-plugin-<version>.zip`;
4. inspects the archive and parses both generated JSON files;
5. uploads the ZIP as an asset on the same GitHub Release.

The Docker image release remains unchanged and is published in parallel.

## Configuration

The release workflow reads the repository or environment variable:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PWA_PREVIEW_MCP_URL` | Remote Streamable HTTP MCP endpoint written to `mcp.json` | `https://pwa-preview.apphome.one/mcp` |

This value is public by design because it is embedded in the distributable plugin ZIP. Use a GitHub Actions variable rather than a secret.

Authentication credentials, OAuth secrets, bearer tokens, and other private values must never be embedded in the plugin package.

## Why there is no .app.json

A ChatGPT-created plugin export may contain `.app.json` with an account/workspace-specific App binding. The portable package intentionally does not use that file. It connects through the documented remote MCP endpoint in `mcp.json`, so the same release artifact can be installed independently of the account that built it.

## Skill behavior

The included skill teaches the host to:

- use PWA Preview only for already-built static web apps/PWAs;
- use `preview_create` for a new artifact;
- prefer `preview_update` while iterating on the same app so the preview URL stays stable;
- use an Agent Workspace artifact download URL as the handoff when that build flow is available;
- keep PWA Preview authorization separate from the artifact download credential.
