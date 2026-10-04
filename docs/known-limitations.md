# Known v1 limitations

- **Single active application instance.** Local `/data` is not shared object storage and lifecycle locking is in-process where required.
- **Public preview rendering.** Anyone who knows the unguessable preview URL can load it. There is no per-preview viewer authentication in v1.
- **GitHub-only interactive login.** The architecture is provider-neutral, but GitHub is the implemented OAuth provider.
- **Allowlist administration is operator-managed SQL.** No dedicated admin UI/API is included in v1.
- **MCP artifact transport is URL-based.** `preview_create` and `preview_update` use `sourceUrl`; generic direct MCP file transport is not defined.
- **No direct Agent Workspace delegation.** Agent Workspace artifacts are handed off by signed URL; pwa-preview authorization still comes from the user's session/MCP token.
- **Local storage is deliberate in the near term.** `LocalPreviewStorage` is filesystem-oriented and the service assumes one active application instance with persistent `/data`. Remote/shared storage such as S3/R2/MinIO would require a new storage contract plus distributed lifecycle/concurrency design; it is intentionally not abstracted prematurely.
- **No strict CSP for preview content.** Static previews are intentionally flexible and receive baseline hardening headers only.
- **Deployment-specific TLS/DNS cannot be proven in generic CI.** Wildcard DNS, DNS-01 certificate issuance, OAuth callback and reverse-proxy routing must be verified in the actual Coolify environment.
- **Agent Workspace live signed-URL smoke depends on outbound HTTPS from the deployed pwa-preview host.** The signed URL handoff itself has been verified; the permanent smoke command is intended for the deployed environment.
