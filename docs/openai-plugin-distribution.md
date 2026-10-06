# OpenAI plugin distribution

PWA Preview ships two release package targets: a ChatGPT update package for the already registered ChatGPT app, and a portable direct-MCP package for desktop/other compatible clients.

## ChatGPT update package

The primary GitHub release artifact is intended to be uploaded as a new version of the existing ChatGPT app. It matches the structure exported by ChatGPT and has no extra top-level directory:

```text
.app.json
.codex-plugin/
└── plugin.json
```

The package preserves two stable identities:

- the registered ChatGPT App ID from `PWA_PREVIEW_CHATGPT_APP_ID`;
- the plugin name used by the ChatGPT export, normally `dev-<app-id-suffix>`.

By default the build derives the plugin name from the App ID. If the exported plugin uses a different stable name, set `PWA_PREVIEW_CHATGPT_PLUGIN_NAME` to that exact `dev-...` value.

For the current registered PWA Preview app, the known identities are:

```text
App ID: asdk_app_6ac265341f288191837343c13cc52e94
Plugin name: dev-6ac265341f288191837343c13cc52e94
```

The ChatGPT UI creates its own `asdk_app_v_...` Version ID when a new app version is uploaded. That Version ID must not be embedded in the release ZIP.

Build locally with:

```bash
PWA_PREVIEW_CHATGPT_APP_ID=asdk_app_example \
  npm run plugin:build -- --version 1.3.1 --target chatgpt
```

Generated files are written directly under `build/plugin-chatgpt/`.

## Desktop / portable MCP package

The separate desktop package keeps the Agent Plugins 1.0 direct-MCP structure:

```text
pwa-preview/
├── plugin.json
├── mcp.json
└── skills/
    └── pwa-preview/
        └── SKILL.md
```

It declares the existing Streamable HTTP MCP endpoint and adds workflow guidance for creating and updating temporary previews.

Build locally with:

```bash
PWA_PREVIEW_MCP_URL=https://pwa-preview.apphome.one/mcp \
  npm run plugin:build -- --version 1.3.1 --target desktop
```

The generated package is written under `build/plugin-desktop/pwa-preview/`.

## Source files

The repository keeps templates under `plugin/`:

- `plugin/chatgpt-update.template.json` — ChatGPT update manifest matching the exported app metadata.
- `plugin/app.template.json` — ChatGPT app binding.
- `plugin/plugin.template.json` — portable Agent Plugins manifest.
- `plugin/mcp.template.json` — remote MCP declaration.
- `plugin/skills/pwa-preview/SKILL.md` — workflow guidance, including the Agent Workspace artifact handoff.

## GitHub Actions

CI builds and validates both package targets.

When a GitHub Release is published, the release workflow:

1. derives the plugin version from the release tag, stripping a leading `v`;
2. requires `PWA_PREVIEW_CHATGPT_APP_ID`;
3. builds the ChatGPT update package and the desktop MCP package;
4. creates `pwa-preview-plugin-<version>.zip` with `.app.json` and `.codex-plugin/` directly at the ZIP root;
5. creates `pwa-preview-plugin-desktop-<version>.zip` with the portable `pwa-preview/` top-level directory;
6. inspects both archives before attaching them to the GitHub Release.

The Docker image release remains unchanged and is published in parallel.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PWA_PREVIEW_CHATGPT_APP_ID` | Stable registered ChatGPT App ID used by the update ZIP | none; required for release |
| `PWA_PREVIEW_CHATGPT_PLUGIN_NAME` | Stable exported `dev-...` plugin name | derived from App ID |
| `PWA_PREVIEW_MCP_URL` | Remote Streamable HTTP MCP endpoint written to the desktop package | `https://pwa-preview.apphome.one/mcp` |

These values are public identifiers/configuration embedded in release artifacts, so use GitHub Actions variables rather than secrets.

Authentication credentials, OAuth secrets, bearer tokens, signed artifact URLs, and other private values must never be embedded in either plugin package.

## Updating the ChatGPT app

After the app has been registered once:

1. keep `PWA_PREVIEW_CHATGPT_APP_ID` stable;
2. publish a new GitHub Release;
3. download `pwa-preview-plugin-<version>.zip`;
4. upload that ZIP as a new version of the existing ChatGPT app.

The portable desktop ZIP is not the update artifact for the registered ChatGPT app.

## Skill behavior

The portable package skill teaches the host to:

- use PWA Preview only for already-built static web apps/PWAs;
- use `preview_create` for a new artifact;
- prefer `preview_update` while iterating on the same app so the preview URL stays stable;
- use an Agent Workspace artifact download URL as the handoff when that build flow is available;
- keep PWA Preview authorization separate from the artifact download credential.
